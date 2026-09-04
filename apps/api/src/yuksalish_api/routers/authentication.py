from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncConnection

from yuksalish_api.auth import AuthenticatedUser, issue_access_token, require_user
from yuksalish_api.auth_schemas import (
    AuthenticationResponse,
    InvitationAcceptRequest,
    InvitationCreateRequest,
    InvitationResponse,
    LoginRequest,
    PasswordResetCompleteRequest,
    PasswordResetCreateRequest,
    PasswordResetResponse,
    RefreshRequest,
    SessionSummaryResponse,
    TotpConfirmRequest,
    TotpDisableRequest,
    TotpSetupResponse,
    TotpStatusResponse,
)
from yuksalish_api.auth_service import (
    AuthResult,
    AuthServiceError,
    accept_invitation,
    begin_totp_setup,
    complete_password_reset,
    confirm_totp_setup,
    create_invitation,
    create_password_reset,
    disable_totp,
    list_user_sessions,
    login_with_password,
    refresh_session,
    revoke_session,
    totp_enabled,
)
from yuksalish_api.database import get_connection
from yuksalish_api.repository import find_active_user_by_username, person_from_record
from yuksalish_api.workspace_schemas import (
    DevelopmentSessionRequest,
    PersonResponse,
    SessionResponse,
)

router = APIRouter(prefix="/auth", tags=["authentication"])


def _translate(error: AuthServiceError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=error.detail)


async def _response(connection: AsyncConnection, result: AuthResult) -> AuthenticationResponse:
    response = AuthenticationResponse(
        access_token=result.access_token,
        refresh_token=result.refresh_token,
        expires_in=result.expires_in,
        user=person_from_record(result.user),
    )
    # Request-scoped yield dependencies finalize after the HTTP response is sent.
    # Make the new/rotated session visible before a client can use its token.
    await connection.commit()
    return response


@router.post("/development-session", response_model=SessionResponse)
async def development_session(
    payload: DevelopmentSessionRequest,
    request: Request,
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> SessionResponse:
    settings = request.app.state.settings
    if settings.environment not in {"development", "test"}:
        raise HTTPException(status_code=404, detail="Development session is disabled")
    user = await find_active_user_by_username(connection, payload.username)
    if user is None:
        raise HTTPException(status_code=404, detail="User was not found")
    return SessionResponse(
        access_token=issue_access_token(user["id"], settings.auth_signing_key),
        user=person_from_record(user),
    )


@router.post("/login", response_model=AuthenticationResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> AuthenticationResponse:
    try:
        return await _response(
            connection,
            await login_with_password(
                connection,
                payload.username,
                payload.password,
                payload.totp_code,
                payload.device_label,
                request.app.state.settings,
            ),
        )
    except AuthServiceError as error:
        raise _translate(error) from error


@router.post("/refresh", response_model=AuthenticationResponse)
async def refresh(
    payload: RefreshRequest,
    request: Request,
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> AuthenticationResponse:
    try:
        return await _response(
            connection,
            await refresh_session(connection, payload.refresh_token, request.app.state.settings),
        )
    except AuthServiceError as error:
        raise _translate(error) from error


@router.get("/me", response_model=PersonResponse)
async def me(
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
) -> PersonResponse:
    return person_from_record(
        {
            "id": current_user.id,
            "username": current_user.username,
            "full_name": current_user.full_name,
            "position_id": current_user.position_id,
            "job_title": current_user.job_title,
            "role": current_user.role,
        }
    )


@router.post("/invitations", response_model=InvitationResponse, status_code=201)
async def invite_user(
    payload: InvitationCreateRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> InvitationResponse:
    try:
        invitation = await create_invitation(
            connection, current_user, payload, request.app.state.settings
        )
    except AuthServiceError as error:
        raise _translate(error) from error
    return InvitationResponse.model_validate(invitation)


@router.post("/invitations/accept", response_model=AuthenticationResponse)
async def activate_invitation(
    payload: InvitationAcceptRequest,
    request: Request,
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> AuthenticationResponse:
    try:
        return await _response(
            connection,
            await accept_invitation(
                connection,
                payload.invite_token,
                payload.password,
                payload.device_label,
                request.app.state.settings,
            ),
        )
    except AuthServiceError as error:
        raise _translate(error) from error


@router.post("/password-resets", response_model=PasswordResetResponse, status_code=201)
async def issue_password_reset(
    payload: PasswordResetCreateRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> PasswordResetResponse:
    try:
        reset = await create_password_reset(
            connection, current_user, payload, request.app.state.settings
        )
    except AuthServiceError as error:
        raise _translate(error) from error
    return PasswordResetResponse.model_validate(reset)


@router.post("/password-resets/complete", response_model=AuthenticationResponse)
async def reset_password(
    payload: PasswordResetCompleteRequest,
    request: Request,
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> AuthenticationResponse:
    try:
        result = await complete_password_reset(
            connection,
            payload.reset_token,
            payload.password,
            payload.device_label,
            request.app.state.settings,
        )
    except AuthServiceError as error:
        raise _translate(error) from error
    return await _response(connection, result)


@router.get("/totp", response_model=TotpStatusResponse)
async def get_totp_status(
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TotpStatusResponse:
    return TotpStatusResponse(enabled=await totp_enabled(connection, current_user.id))


@router.post("/totp/setup", response_model=TotpSetupResponse)
async def setup_totp(
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TotpSetupResponse:
    try:
        setup = await begin_totp_setup(connection, current_user, request.app.state.settings)
    except AuthServiceError as error:
        raise _translate(error) from error
    return TotpSetupResponse.model_validate(setup)


@router.post("/totp/confirm", response_model=TotpStatusResponse)
async def confirm_totp(
    payload: TotpConfirmRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> TotpStatusResponse:
    try:
        await confirm_totp_setup(connection, current_user, payload.code, request.app.state.settings)
    except AuthServiceError as error:
        raise _translate(error) from error
    return TotpStatusResponse(enabled=True)


@router.delete("/totp", status_code=status.HTTP_204_NO_CONTENT)
async def remove_totp(
    payload: TotpDisableRequest,
    request: Request,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> Response:
    try:
        await disable_totp(
            connection,
            current_user,
            payload.password,
            payload.code,
            request.app.state.settings,
        )
    except AuthServiceError as error:
        raise _translate(error) from error
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/sessions", response_model=list[SessionSummaryResponse])
async def sessions(
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> list[SessionSummaryResponse]:
    records = await list_user_sessions(connection, current_user)
    return [SessionSummaryResponse.model_validate(record) for record in records]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_session(
    session_id: UUID,
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> Response:
    try:
        await revoke_session(connection, current_user, session_id)
    except AuthServiceError as error:
        raise _translate(error) from error
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    current_user: Annotated[AuthenticatedUser, Depends(require_user)],
    connection: Annotated[AsyncConnection, Depends(get_connection)],
) -> Response:
    if current_user.session_id is not None:
        await revoke_session(connection, current_user, current_user.session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
