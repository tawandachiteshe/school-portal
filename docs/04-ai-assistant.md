# 4. AI Assistant

A chat helper inside the portal ("Ask TCFL") that answers questions using **the student's own data and college knowledge** — not the open internet.

## 4.1 What it should handle

| Example question | How it's answered |
|------------------|-------------------|
| "What's due this week?" | Tool `get_my_deadlines(days=7)` |
| "Who teaches Data Communications and where's their office?" | Tool `get_my_modules()` → lecturer details |
| "When is my Networking test and what does it cover?" | Tool `get_my_assessments(module)` + retrieval over the test's description/notes |
| "Explain subnetting from this week's notes" | Retrieval over the module's **notes** the student is enrolled in |
| "What were my results last semester?" | Tool `get_my_results(term)` |
| "Is *Computer Networks* by Tanenbaum available?" | Tool `search_library(query)` |
| "What are library opening hours / fines?" | Retrieval over `library_info` |
| "How do I apply for a deferment?" | Retrieval over student handbook / policies |
| "Did I get accepted?" (applicant) | Tool `get_my_application_status()` |

Out of scope (politely declined, pointed to a human): changing grades, fee disputes, medical/counselling emergencies (show campus contacts), writing graded assignments for the student (it will explain and tutor instead).

## 4.2 Design

```
user msg ─▶ api /assistant/chat (SSE)
             ├─ auth → user, role, enrolments
             ├─ retrieve: pgvector search over kb_chunks WHERE audience allows user  (top 8)
             ├─ Claude (streaming) with system prompt + retrieved chunks + tools
             │     └─ tool calls executed server-side with the *user's* permissions
             └─ stream text + citations to the browser; store transcript
```

- **Retrieval (RAG):** notes (PDF/DOCX/PPTX → text), announcements, handbook, library info, assessment descriptions are chunked (~800 tokens, 100 overlap) and embedded by a worker whenever content is published. Embeddings use a **local open-source embedding model** (e.g. `BAAI/bge-m3`, 1024-dim) run in the worker, so documents are not sent out just for indexing.
- **Access control:** every chunk belongs to a `kb_documents` row with a visibility scope (public, applicants, students, staff, programme, offering). Retrieval joins through `kb_visible_documents(user_id)` ([09 §9.5](09-database-design.md#95-audience-targeting)), so only permitted chunks are ever ranked. Tools read only the caller's own records. The model never receives another student's data, so it cannot leak it.
- **Grounding:** the system prompt requires citing sources (`[Notes: Week 3 – Subnetting]`) and saying "I don't know — please ask your lecturer/registry" when neither tools nor context answer.
- **Languages:** English by default; answers in Shona or Ndebele if the student writes in them.

## 4.3 Implementation sketch

```python
# api/app/assistant/chat.py
import anthropic
from app.config import settings
from app.assistant.tools import TOOLS, run_tool, ToolInputError

client = anthropic.AsyncAnthropic()

SYSTEM = """You are "Ask TCFL", the student assistant for TelOne Centre for Learning.
You help the signed-in user with their modules, lecturers, timetable, tests, assignments,
results, notes, library and college announcements.
- Use the tools for anything about the user's own records; use the <context> documents for
  college information and course content. Cite the document title for facts you take from them.
- If the answer is not in the tools or context, say so and suggest who to contact.
- Tutor rather than complete graded work: explain concepts and give hints, not submission-ready answers.
- Be concise; this is often read on a phone. Latency-sensitive; begin your visible answer immediately."""

async def chat(user, history: list[dict], context_block: str):
    # history is append-only: previous turns exactly as returned (full content blocks)
    messages = history
    while True:
        async with client.beta.messages.stream(
            model=settings.claude_model,                      # default "claude-opus-5"
            max_tokens=64000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            system=[
                {"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}},
                {"type": "text", "text": context_block},
            ],
            tools=TOOLS,                                       # each has eager_input_streaming: True
            output_config={"effort": "low"},
            messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                yield {"type": "text", "text": text}
            final = await stream.get_final_message()

        if final.stop_reason == "refusal":
            yield {"type": "text", "text": "Sorry, I can't help with that. Please contact student services."}
            return
        messages.append({"role": "assistant", "content": final.content})
        if final.stop_reason != "tool_use":
            yield {"type": "done", "messages": messages}
            return

        results = []
        for block in final.content:
            if block.type != "tool_use":
                continue
            try:
                output = await run_tool(user, block.name, block.input)   # validates input with Pydantic
                results.append({"type": "tool_result", "tool_use_id": block.id, "content": output})
            except ToolInputError as e:
                results.append({"type": "tool_result", "tool_use_id": block.id,
                                "content": f"INVALID_INPUT: {e}", "is_error": True})
        messages.append({"role": "user", "content": results})   # all results in ONE message
```

Example tool definition:

```python
# api/app/assistant/tools.py
TOOLS = [
    {
        "name": "get_my_deadlines",
        "description": "List the signed-in student's upcoming tests and assignment due dates.",
        "eager_input_streaming": True,
        "input_schema": {
            "type": "object",
            "properties": {"days": {"type": "integer", "minimum": 1, "maximum": 60}},
            "required": ["days"],
            "additionalProperties": False,
        },
    },
    # get_my_modules, get_my_results, get_my_assessments, search_library,
    # get_my_loans, get_my_application_status, get_timetable(date)
]
```

`run_tool` validates `block.input` against a Pydantic model before executing (streamed tool inputs are not server-validated), then queries the DB **scoped to `user.id`**.

## 4.4 Guardrails and safety

- **Prompt injection:** retrieved notes/announcements are wrapped in `<context>` tags and the system prompt states they are data, not instructions. Tools are read-only; the assistant cannot change records.
- **Rate limits:** 30 messages/user/hour, 200/day (configurable); per-user monthly token cap.
- **Logging:** transcripts stored 90 days for quality review, then deleted (see [07](07-security-and-compliance.md)); students can delete their history.
- **Feedback:** 👍/👎 on each answer; weekly review of 👎 answers by the ICT/academic team to fix missing content.
- **Disable switch:** `ASSISTANT_ENABLED=false` hides the feature instantly.

## 4.5 Cost control

- Prompt caching on the fixed system prompt (above).
- `effort: "low"` for chat (routine Q&A); raise only for routes that need it after measuring.
- Tools return compact JSON (only needed fields).
- Retrieval top-k 8, chunk size capped.
- Track `usage` per request in `chat_messages.tokens` and show a monthly cost dashboard to admins.
