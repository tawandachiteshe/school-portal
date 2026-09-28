from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, Request

from app.auth import sessions
from app.db import DbDep
from app.models import User, WebSession


@dataclass
class CurrentUser:
    user: User
    session: WebSession

    @property
    def roles(self) -> set[str]:
        return {r.role for r in self.user.roles}


async def current_user(request: Request, db: DbDep) -> CurrentUser:
    resolved = await sessions.resolve(db, request.cookies.get(sessions.COOKIE))
    if resolved is None:
        raise HTTPException(401, "Not signed in")
    session, user = resolved
    return CurrentUser(user=user, session=session)


CurrentUserDep = Annotated[CurrentUser, Depends(current_user)]


def require_role(*roles: str):
    async def dep(cu: CurrentUserDep) -> CurrentUser:
        if not cu.roles & set(roles):
            raise HTTPException(403, "You don't have access to this page")
        return cu

    return dep
