"""Ask TCFL (design/AskStart, AskChat, AskHandoff, DeskAsk) and the Student Affairs inbox for the
questions students send on. The assistant itself is sandboxed: see app/assistant/__init__.py."""

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.assistant import chat
from app.assistant.sandbox import read_only_session
from app.assistant.tools import Context, Source, allowed
from app.auth.deps import CurrentUser, require_role
from app.config import get_settings
from app.db import get_db, get_sessionmaker
from app.models import AskQuestion, ChatMessage, ChatSession, SmsOutbox, Student, User
from app.services import clock

router = APIRouter(prefix="/assistant", tags=["assistant"])
staff_router = APIRouter(prefix="/staff/ask-questions", tags=["assistant"])
log = logging.getLogger("tcfl.assistant")
asker = require_role("student", "applicant")
student_affairs = require_role("student_affairs", "admin")

NOT_SET_UP = (
    "Ask TCFL isn't set up yet, so it can't answer questions. You can send your question to Student "
    "Affairs instead."
)

# design/AskStart "Other students often ask".
SUGGESTIONS = {
    "student": [
        "What happens if I'm sick on a test day?",
        "How much is the second fees instalment?",
        "When do I go on industrial attachment?",
        "Can I renew an overdue library book?",
    ],
    "applicant": [
        "What are the entry requirements for my programme?",
        "What happens after I submit my application?",
        "When do applications close?",
    ],
}


def _mask(e164: str) -> str:
    return f"{e164[:4]} {e164[4:6]} ••• {e164[-4:]}"


def _enabled() -> None:
    if not get_settings().assistant_enabled:
        raise HTTPException(404, "Ask TCFL is switched off")


async def _student(db: AsyncSession, user: User) -> Student | None:
    if not user.person:
        return None
    s = (await db.execute(select(Student).where(Student.person_id == user.person.id))).scalar_one_or_none()
    return s if s and s.status == "active" else None


# --- start page -----------------------------------------------------------------------------


class SentQuestion(BaseModel):
    reference: str
    question: str
    created_at: datetime
    reply: str | None
    replied_at: datetime | None


class AssistantHome(BaseModel):
    configured: bool  # False: answers say it isn't set up yet
    suggestions: list[str]
    sent: list[SentQuestion]  # questions sent to Student Affairs, newest first, with any reply


@router.get("", dependencies=[Depends(_enabled)])
async def assistant_home(
    cu: CurrentUser = Depends(asker), db: AsyncSession = Depends(get_db)
) -> AssistantHome:
    sent = (
        (
            await db.execute(
                select(AskQuestion)
                .where(AskQuestion.user_id == cu.user.id)
                .order_by(AskQuestion.created_at.desc())
                .limit(10)
            )
        )
        .scalars()
        .all()
    )
    kind = "student" if await _student(db, cu.user) else "applicant"
    return AssistantHome(
        configured=bool(get_settings().anthropic_api_key),
        suggestions=SUGGESTIONS[kind],
        sent=[
            SentQuestion(
                reference=q.reference,
                question=q.question,
                created_at=q.created_at,
                reply=q.reply,
                replied_at=q.replied_at,
            )
            for q in sent
        ],
    )


# --- asking ---------------------------------------------------------------------------------


class AskIn(BaseModel):
    question: str = Field(min_length=2, max_length=1000)
    session_id: uuid.UUID | None = None  # continue a conversation; omit to start one


class AnswerSource(BaseModel):
    label: str
    href: str | None


class AnswerOut(BaseModel):
    message_id: int
    session_id: uuid.UUID
    text: str
    sources: list[AnswerSource]
    handoff: bool  # offer "Send your question to Student Affairs"


class AskEvent(BaseModel):
    """One Server-Sent Event from POST /assistant/ask: `status` while tools run ("Looking at your
    deadlines…"), then `answer` or `error`."""

    type: Literal["status", "answer", "error"]
    status: str | None = None
    answer: AnswerOut | None = None
    error: str | None = None


async def _rate_limit(db: AsyncSession, user_id: uuid.UUID) -> None:
    s = get_settings()
    now = clock.now()

    async def count(since: datetime) -> int:
        return (
            await db.scalar(
                select(func.count())
                .select_from(ChatMessage)
                .join(ChatSession, ChatSession.id == ChatMessage.session_id)
                .where(
                    ChatSession.user_id == user_id, ChatMessage.role == "user", ChatMessage.created_at > since
                )
            )
            or 0
        )

    if await count(now - timedelta(hours=1)) >= s.assistant_per_hour:
        raise HTTPException(429, "You've asked a lot of questions this hour. Try again later.")
    if await count(now - timedelta(days=1)) >= s.assistant_per_day:
        raise HTTPException(429, "You've reached today's limit for Ask TCFL. Try again tomorrow.")


def _sse(event: AskEvent) -> str:
    return f"data: {event.model_dump_json(exclude_none=True)}\n\n"


@router.post(
    "/ask",
    dependencies=[Depends(_enabled)],
    response_model=AskEvent,
    responses={200: {"description": "text/event-stream of AskEvent", "model": AskEvent}},
)
async def ask(
    body: AskIn, request: Request, cu: CurrentUser = Depends(asker), db: AsyncSession = Depends(get_db)
) -> StreamingResponse:
    await _rate_limit(db, cu.user.id)
    if body.session_id:
        session = await db.get(ChatSession, body.session_id)
        if session is None or session.user_id != cu.user.id:
            raise HTTPException(404, "Conversation not found")
    else:
        session = ChatSession(user_id=cu.user.id, title=body.question[:80])
        db.add(session)
        await db.flush()
    history_rows = (
        (
            await db.execute(
                select(ChatMessage)
                .where(ChatMessage.session_id == session.id)
                .order_by(ChatMessage.id.desc())
                .limit(8)
            )
        )
        .scalars()
        .all()
    )
    history = [{"role": m.role, "content": m.content.get("text", "")} for m in reversed(history_rows)]
    db.add(
        ChatMessage(
            session_id=session.id,
            role="user",
            content={"text": body.question},
            text_preview=body.question[:200],
        )
    )
    session.last_message_at = clock.now()
    await db.commit()
    session_id, user_id, web_session = session.id, cu.user.id, cu.session

    async def save(a: chat.Answer | None, text_: str, sources: list[Source], handoff: bool) -> AnswerOut:
        async with get_sessionmaker()() as w:
            m = ChatMessage(
                session_id=session_id,
                role="assistant",
                content={
                    "text": text_,
                    "sources": [{"label": s.label, "href": s.href} for s in sources],
                    "handoff": handoff,
                    "tools": a.tools_used if a else [],
                },
                text_preview=text_[:200],
                model=a.model if a else None,
                input_tokens=a.input_tokens if a else None,
                output_tokens=a.output_tokens if a else None,
                cache_read_tokens=a.cache_read_tokens if a else None,
            )
            w.add(m)
            await w.execute(
                text("UPDATE chat_sessions SET last_message_at = now() WHERE id = :id"), {"id": session_id}
            )
            await w.commit()
            return AnswerOut(
                message_id=m.id,
                session_id=session_id,
                text=text_,
                sources=[AnswerSource(label=s.label, href=s.href) for s in sources],
                handoff=handoff,
            )

    async def stream() -> AsyncIterator[str]:
        if not get_settings().anthropic_api_key:
            yield _sse(AskEvent(type="answer", answer=await save(None, NOT_SET_UP, [], True)))
            return
        statuses: asyncio.Queue[str] = asyncio.Queue()
        try:
            async with read_only_session() as ro:
                user = (
                    await ro.execute(select(User).where(User.id == user_id).options(selectinload(User.roles)))
                ).scalar_one()
                student = await _student(ro, user)
                roles = {r.role for r in user.roles}
                ctx = Context(db=ro, cu=CurrentUser(user=user, session=web_session), student=student)
                tools = allowed(roles, student is not None)
                yield _sse(AskEvent(type="status", status="Reading your question…"))
                task = asyncio.create_task(
                    chat.answer(
                        ctx,
                        tools,
                        history,
                        body.question,
                        on_status=statuses.put,
                        cancelled=request.is_disconnected,
                    )
                )
                # Send each status as it happens ("Looking at your deadlines…"), then the answer.
                try:
                    while not task.done():
                        getter = asyncio.create_task(statuses.get())
                        await asyncio.wait({task, getter}, return_when=asyncio.FIRST_COMPLETED)
                        if getter.done():
                            yield _sse(AskEvent(type="status", status=getter.result()))
                        else:
                            getter.cancel()
                finally:
                    task.cancel()  # "Stop answering": the browser closed the stream
                result = task.result()
            if result is None:
                return  # stopped
            yield _sse(
                AskEvent(
                    type="answer", answer=await save(result, result.text, result.sources, result.handoff)
                )
            )
        except Exception:
            log.exception("Ask TCFL failed")
            yield _sse(
                AskEvent(type="error", error="Ask TCFL couldn't answer just now. Try again in a minute.")
            )

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


class AnswerFeedbackIn(BaseModel):
    helpful: bool


class AnswerFeedbackOut(BaseModel):
    ok: bool


@router.post("/messages/{message_id}/feedback", dependencies=[Depends(_enabled)])
async def answer_feedback(
    message_id: int, body: AnswerFeedbackIn, cu: CurrentUser = Depends(asker), db: AsyncSession = Depends(get_db)
) -> AnswerFeedbackOut:
    m = (
        await db.execute(
            select(ChatMessage)
            .join(ChatSession, ChatSession.id == ChatMessage.session_id)
            .where(
                ChatMessage.id == message_id,
                ChatSession.user_id == cu.user.id,
                ChatMessage.role == "assistant",
            )
        )
    ).scalar_one_or_none()
    if m is None:
        raise HTTPException(404, "Answer not found")
    m.feedback = 1 if body.helpful else -1
    await db.commit()
    return AnswerFeedbackOut(ok=True)


# --- handing a question to Student Affairs (only when the student presses the button) ------------


class AskHandoffIn(BaseModel):
    question: str = Field(min_length=3, max_length=2000)
    session_id: uuid.UUID | None = None


class AskHandoffOut(BaseModel):
    reference: str  # "SA-0311-027"
    sms_to: str | None  # "+263 77 ••• 4521": where the reply is texted


class AskHandoffPreview(BaseModel):
    """What Student Affairs will see about the sender (design/AskHandoff)."""

    name: str
    student_number: str | None
    class_group: str | None
    sms_to: str | None


@router.get("/handoff", dependencies=[Depends(_enabled)])
async def handoff_preview(
    cu: CurrentUser = Depends(asker), db: AsyncSession = Depends(get_db)
) -> AskHandoffPreview:
    s = await _student(db, cu.user)
    return AskHandoffPreview(
        name=cu.user.display_name or "",
        student_number=s.student_number if s else None,
        class_group=s.class_group if s else None,
        sms_to=_mask(cu.user.phone) if cu.user.phone else None,
    )


@router.post("/handoff", status_code=201, dependencies=[Depends(_enabled)])
async def send_to_student_affairs(
    body: AskHandoffIn, cu: CurrentUser = Depends(asker), db: AsyncSession = Depends(get_db)
) -> AskHandoffOut:
    if body.session_id:
        session = await db.get(ChatSession, body.session_id)
        if session is None or session.user_id != cu.user.id:
            raise HTTPException(404, "Conversation not found")
    today_count = await db.scalar(
        select(func.count())
        .select_from(AskQuestion)
        .where(AskQuestion.user_id == cu.user.id, AskQuestion.created_at > clock.now() - timedelta(days=1))
    )
    if (today_count or 0) >= 10:
        raise HTTPException(429, "You've sent 10 questions today. Visit Student Affairs in Block A.")
    n = await db.scalar(text("SELECT nextval('ask_question_seq')"))
    reference = f"SA-{clock.today():%m%d}-{n % 1000:03d}"
    db.add(
        AskQuestion(
            reference=reference, user_id=cu.user.id, chat_session_id=body.session_id, question=body.question
        )
    )
    await db.commit()
    return AskHandoffOut(reference=reference, sms_to=_mask(cu.user.phone) if cu.user.phone else None)


# --- Student Affairs inbox ------------------------------------------------------------------


class InboxQuestion(BaseModel):
    id: uuid.UUID
    reference: str
    name: str
    student_number: str | None
    class_group: str | None
    question: str
    created_at: datetime
    reply: str | None
    replied_at: datetime | None
    replied_by: str | None


@staff_router.get("")
async def ask_questions_inbox(
    _: CurrentUser = Depends(student_affairs), db: AsyncSession = Depends(get_db)
) -> list[InboxQuestion]:
    rows = (
        await db.execute(
            select(AskQuestion, User)
            .join(User, User.id == AskQuestion.user_id)
            .order_by(AskQuestion.replied_at.is_not(None), AskQuestion.created_at.desc())
            .limit(200)
        )
    ).all()
    out = []
    for q, u in rows:
        s = await _student(db, u)
        by = await db.get(User, q.replied_by) if q.replied_by else None
        out.append(
            InboxQuestion(
                id=q.id,
                reference=q.reference,
                name=u.display_name or u.username or "",
                student_number=s.student_number if s else None,
                class_group=s.class_group if s else None,
                question=q.question,
                created_at=q.created_at,
                reply=q.reply,
                replied_at=q.replied_at,
                replied_by=by.display_name if by else None,
            )
        )
    return out


class AskReplyIn(BaseModel):
    reply: str = Field(min_length=2, max_length=2000)


@staff_router.post("/{question_id}/reply")
async def reply_to_question(
    question_id: uuid.UUID,
    body: AskReplyIn,
    cu: CurrentUser = Depends(student_affairs),
    db: AsyncSession = Depends(get_db),
) -> InboxQuestion:
    q = await db.get(AskQuestion, question_id)
    if q is None:
        raise HTTPException(404, "Question not found")
    q.reply, q.replied_by, q.replied_at = body.reply, cu.user.id, clock.now()
    asker_user = await db.get(User, q.user_id)
    if asker_user and asker_user.phone:
        db.add(
            SmsOutbox(
                to_phone=asker_user.phone,
                body=f"TCFL Student Affairs replied to {q.reference}. Read it in Ask TCFL on the portal.",
                purpose="ask_reply",
            )
        )
    await db.commit()
    s = await _student(db, asker_user) if asker_user else None
    return InboxQuestion(
        id=q.id,
        reference=q.reference,
        name=asker_user.display_name if asker_user else "",
        student_number=s.student_number if s else None,
        class_group=s.class_group if s else None,
        question=q.question,
        created_at=q.created_at,
        reply=q.reply,
        replied_at=q.replied_at,
        replied_by=cu.user.display_name,
    )
