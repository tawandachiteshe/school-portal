"""The Student Affairs inbox (no design) for questions students send on from Ask TCFL
(design/AskHandoff "Send to Student Affairs"). A reply is texted to the student and shown in Ask TCFL."""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.auth.deps import CurrentUser, require_role
from app.db import DbDep
from app.models import AskQuestion, SmsOutbox, User
from app.services import clock
from app.services.students import active_student

router = APIRouter(prefix="/staff/ask-questions", tags=["assistant"])
student_affairs = require_role("student_affairs", "admin")
StudentAffairsDep = Annotated[CurrentUser, Depends(student_affairs)]


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


@router.get("")
async def ask_questions_inbox(_: StudentAffairsDep, db: DbDep) -> list[InboxQuestion]:
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
        s = await active_student(db, u)
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


@router.post("/{question_id}/reply")
async def reply_to_question(
    question_id: uuid.UUID,
    body: AskReplyIn,
    cu: StudentAffairsDep,
    db: DbDep,
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
    s = await active_student(db, asker_user) if asker_user else None
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
