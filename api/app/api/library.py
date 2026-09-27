import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_db
from app.models import LibraryLoan, Student
from app.services import clock
from app.services.students import current_student

router = APIRouter(prefix="/library", tags=["library"])


class RenewOut(BaseModel):
    id: uuid.UUID
    due_at: datetime
    renewals_left: int


@router.post("/loans/{loan_id}/renew")
async def renew(
    loan_id: uuid.UUID, student: Student = Depends(current_student), db: AsyncSession = Depends(get_db)
) -> RenewOut:
    s = get_settings()
    loan = await db.get(LibraryLoan, loan_id)
    if loan is None or loan.person_id != student.person_id or loan.returned_at is not None:
        raise HTTPException(404, "This loan isn't on your account.")
    now = clock.now()
    if loan.due_at < now:
        raise HTTPException(
            409, "Overdue books can't be renewed online. Return it to the desk, or ask there."
        )
    if loan.renewals >= s.library_max_renewals:
        raise HTTPException(409, "You've used all your renewals for this book. Return it to the desk.")
    loan.due_at = now + timedelta(days=s.library_loan_days)
    loan.renewals += 1
    await db.commit()
    return RenewOut(id=loan.id, due_at=loan.due_at, renewals_left=s.library_max_renewals - loan.renewals)
