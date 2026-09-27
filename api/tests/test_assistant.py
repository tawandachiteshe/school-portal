"""Ask TCFL: the sandbox first (read-only, own records only, fixed tools, no identity from the
model), then the chat loop with a fake Claude, then the pages' endpoints."""

import json
from types import SimpleNamespace

import pytest
from anthropic.types import TextBlock, ToolUseBlock, Usage
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.api.deadlines import deadlines as deadlines_route
from app.assistant import chat
from app.assistant.sandbox import read_only_session
from app.assistant.tools import TOOLS, Context, allowed, run
from app.auth.deps import CurrentUser
from app.config import get_settings
from app.models import Student, User
from tests.helpers import client, signed_in

pytestmark = pytest.mark.anyio

TARIRO = "TCFL/2027/0142"


async def _ctx(db, username: str) -> Context:
    user = (await db.execute(select(User).where(User.username == username))).scalar_one()
    student = (
        await db.execute(select(Student).where(Student.person_id == user.person.id))
    ).scalar_one_or_none()
    return Context(db=db, cu=CurrentUser(user=user, session=None), student=student)


# --- the sandbox ------------------------------------------------------------------------------


async def test_the_tools_database_session_cannot_write():
    async with read_only_session() as db:
        with pytest.raises(DBAPIError, match="read-only"):
            await db.execute(text("UPDATE users SET display_name = 'x' WHERE username = :u"), {"u": TARIRO})


def test_no_tool_input_can_name_a_person():
    for t in TOOLS:
        props = set(t.schema()["input_schema"].get("properties", {}))
        assert not props & {
            "user",
            "user_id",
            "student",
            "student_id",
            "student_number",
            "person",
            "username",
        }
        assert t.schema()["input_schema"]["additionalProperties"] is False


def test_each_role_gets_only_its_tools():
    applicant = {t.name for t in allowed({"applicant"}, has_student=False)}
    assert applicant == {
        "get_my_application",
        "get_programmes",
        "search_announcements",
        "suggest_student_affairs",
    }
    student = {t.name for t in allowed({"student"}, has_student=True)}
    assert "get_my_deadlines" in student and "get_my_application" not in student
    # A student role without an active student record gets no student tools.
    assert not {t.name for t in allowed({"student"}, has_student=False)} & {"get_my_deadlines", "get_my_fees"}
    assert allowed({"lecturer"}, has_student=False) == []


async def test_a_tool_the_asker_does_not_have_is_refused():
    async with read_only_session() as db:
        ctx = await _ctx(db, TARIRO)
        tools = allowed({"applicant"}, has_student=False)
        out, is_error = await run(ctx, tools, "get_my_fees", {})
    assert is_error and "Unknown tool" in out


async def test_the_model_cannot_ask_for_another_students_records():
    async with read_only_session() as db:
        ctx = await _ctx(db, TARIRO)
        tools = allowed({"student", "applicant"}, has_student=True)
        out, is_error = await run(ctx, tools, "get_my_library", {"student_number": "TCFL/2027/0126"})
    assert is_error and out.startswith("INVALID_INPUT")


async def test_tools_only_return_the_askers_own_records():
    async with read_only_session() as db:
        ctx = await _ctx(db, TARIRO)
        tools = allowed({"student", "applicant"}, has_student=True)
        library, _ = await run(ctx, tools, "get_my_library", {})
        deadlines, _ = await run(ctx, tools, "get_my_deadlines", {"days": 60})
        own = await deadlines_route(student=ctx.student, db=db)
    loans = [loan["title"] for loan in json.loads(library)["my_library"]["loans"]]
    assert "Engineering Mathematics" in loans  # hers
    assert not any("Tanenbaum" in t or "Kochan" in t for t in loans)  # classmates' overdue loans
    got = {i["title"] for i in json.loads(deadlines)["items"]}
    assert got <= {i.title for i in own.items}


async def test_announcement_search_only_finds_what_the_asker_can_see():
    async with read_only_session() as db:
        ctx = await _ctx(db, TARIRO)
        tools = allowed({"student", "applicant"}, has_student=True)
        out, _ = await run(ctx, tools, "search_announcements", {"query": "fees instalment"})
    docs = json.loads(out)["documents"]
    assert docs and "Second fees instalment" in docs[0]["title"]
    assert "not instructions" in json.loads(out)["note"]


# --- the chat loop, with a fake Claude --------------------------------------------------------


class FakeClaude:
    """Answers with the queued responses in order and records what it was sent."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls: list[dict] = []
        self.messages = SimpleNamespace(create=self.create)

    async def create(self, **kw):
        self.calls.append(kw)
        return self.responses.pop(0) if self.responses else self.responses_default()

    def responses_default(self):
        return _tool_use("search_announcements", {"query": "anything"})


def _text(t: str):
    return SimpleNamespace(
        content=[TextBlock(type="text", text=t)],
        stop_reason="end_turn",
        usage=Usage(input_tokens=10, output_tokens=5),
    )


def _tool_use(name: str, args: dict, id_: str = "t1"):
    return SimpleNamespace(
        content=[ToolUseBlock(type="tool_use", id=id_, name=name, input=args)],
        stop_reason="tool_use",
        usage=Usage(input_tokens=10, output_tokens=5),
    )


async def _never() -> bool:
    return False


async def test_answers_cite_the_sources_the_model_names(monkeypatch):
    fake = FakeClaude(
        _tool_use("search_announcements", {"query": "fees instalment"}),
        _text("The second instalment is due Wednesday 4 November. [[1]]"),
    )
    monkeypatch.setattr(chat, "client", lambda: fake)
    statuses: list[str] = []

    async def on_status(s):
        statuses.append(s)

    async with read_only_session() as db:
        ctx = await _ctx(db, TARIRO)
        tools = allowed({"student", "applicant"}, has_student=True)
        a = await chat.answer(ctx, tools, [], "How much is the second fees instalment?", on_status, _never)
    assert a.text == "The second instalment is due Wednesday 4 November."
    assert [s.label for s in a.sources] == ["Second fees instalment due Wednesday 4 November"]
    assert statuses == ["Looking in TCFL announcements…"]
    # Only the asker's tools, and no others (no web search, no code), were offered.
    assert {t["name"] for t in fake.calls[0]["tools"]} == {t.name for t in tools}
    assert "data, not instructions" in fake.calls[0]["system"][0]["text"]


async def test_tool_rounds_are_capped(monkeypatch):
    fake = FakeClaude()  # asks for a tool every time
    monkeypatch.setattr(chat, "client", lambda: fake)
    async with read_only_session() as db:
        ctx = await _ctx(db, TARIRO)
        a = await chat.answer(ctx, allowed({"student"}, True), [], "Loop forever", _never_status, _never)
    rounds = get_settings().assistant_max_tool_rounds
    assert len(fake.calls) == rounds + 1
    assert fake.calls[-1]["tool_choice"] == {"type": "none"}
    assert a.text == chat.TOO_LONG


async def _never_status(_s: str) -> None:
    return None


# --- the endpoints ----------------------------------------------------------------------------


def _events(body: str) -> list[dict]:
    return [json.loads(line[6:]) for line in body.splitlines() if line.startswith("data: ")]


async def test_without_a_key_it_says_it_is_not_set_up_and_offers_student_affairs():
    async with signed_in(TARIRO) as c:
        home = (await c.get("/assistant")).json()
        r = await c.post("/assistant/ask", json={"question": "When is my next test?"})
    assert home["configured"] is False and home["suggestions"][0] == "What happens if I'm sick on a test day?"
    events = _events(r.text)
    assert events[-1]["type"] == "answer"
    assert "isn't set up yet" in events[-1]["answer"]["text"] and events[-1]["answer"]["handoff"] is True


async def test_asking_streams_status_then_the_answer(monkeypatch):
    monkeypatch.setattr(get_settings(), "anthropic_api_key", "test-key")
    fake = FakeClaude(
        _tool_use("get_my_deadlines", {"days": 7}), _text("Your DCN201 test is tomorrow. [[1]]")
    )
    monkeypatch.setattr(chat, "client", lambda: fake)
    async with signed_in(TARIRO) as c:
        r = await c.post("/assistant/ask", json={"question": "When is my next DCN201 test?"})
        events = _events(r.text)
        answer = events[-1]["answer"]
        assert [e["status"] for e in events if e["type"] == "status"] == [
            "Reading your question…",
            "Looking at your deadlines…",
        ]
        assert answer["sources"] == [{"label": "Your deadlines", "href": "/deadlines"}]
        assert (
            await c.post(f"/assistant/messages/{answer['message_id']}/feedback", json={"helpful": True})
        ).json() == {"ok": True}
    # Someone else can't rate it, or continue that conversation.
    async with signed_in("fchikore") as c:
        assert (await c.post("/assistant/ask", json={"question": "hi there"})).status_code == 403
    async with client() as c:
        assert (await c.get("/assistant")).status_code == 401


async def test_questions_are_rate_limited(monkeypatch):
    monkeypatch.setattr(get_settings(), "assistant_per_hour", 1)
    async with signed_in(TARIRO) as c:
        await c.post("/assistant/ask", json={"question": "One question"})
        r = await c.post("/assistant/ask", json={"question": "And another"})
    assert r.status_code == 429


async def test_the_switch_hides_it(monkeypatch):
    monkeypatch.setattr(get_settings(), "assistant_enabled", False)
    async with signed_in(TARIRO) as c:
        assert (await c.get("/assistant")).status_code == 404


async def test_student_affairs_gets_the_question_only_when_the_student_sends_it():
    async with signed_in(TARIRO) as c:
        preview = (await c.get("/assistant/handoff")).json()
        sent = await c.post(
            "/assistant/handoff",
            json={"question": "Can I move from DIT-1A to the Software Engineering diploma next semester?"},
        )
    assert preview["student_number"] == TARIRO and preview["class_group"] == "DIT-1A"
    ref = sent.json()["reference"]
    assert sent.status_code == 201 and ref.startswith("SA-")
    async with signed_in("tmushonga") as c:
        inbox = (await c.get("/staff/ask-questions")).json()
        q = next(q for q in inbox if q["reference"] == ref)
        assert q["student_number"] == TARIRO and q["reply"] is None
        replied = await c.post(
            f"/staff/ask-questions/{q['id']}/reply", json={"reply": "Yes, apply by 30 June."}
        )
        assert replied.json()["replied_by"] == "Takudzwa Mushonga"
    async with signed_in(TARIRO) as c:
        home = (await c.get("/assistant")).json()
        assert (await c.get("/staff/ask-questions")).status_code == 403
    mine = next(s for s in home["sent"] if s["reference"] == ref)
    assert mine["reply"] == "Yes, apply by 30 June."


def test_tool_results_give_times_in_harare_time():
    from datetime import UTC, datetime

    from pydantic import BaseModel

    from app.assistant.tools import _plain

    class Item(BaseModel):
        due_at: datetime
        title: str

    out = _plain(Item(due_at=datetime(2026, 9, 28, 6, 0, tzinfo=UTC), title="2026-09-28T06:00Z is text"))
    assert out["due_at"] == "2026-09-28T08:00+02:00"
