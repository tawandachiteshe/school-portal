from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Reads from environment / .env (see docs/06 §6.2 and docs/10 §10.7)."""

    # api/.env (if present) overrides the root .env when running outside Docker.
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    app_env: str = "development"
    app_url: str = "http://localhost:5173"
    secret_key: str = "dev-only-change-me"

    database_url: str = "postgresql+psycopg://portal:change-me@localhost:5432/portal"
    redis_url: str = "redis://localhost:6379/0"

    oidc_issuer: str = "http://localhost:9100/application/o/tcfl-portal/"
    oidc_internal_base_url: str = ""
    oidc_client_id: str = "tcfl-portal"
    oidc_client_secret: str = ""
    oidc_redirect_uri: str = "http://localhost:5173/api/auth/callback"

    session_max_age: int = 1_209_600  # 14 days
    session_encryption_key: str = ""  # base64, 32 bytes; derived from secret_key when empty (dev only)
    # Sign in as a seeded user without Authentik. Never enabled in production.
    dev_login: bool = True
    # Authentik's generic SMS provider posts codes to /api/internal/sms with this bearer token.
    sms_webhook_secret: str = "dev-sms-webhook-secret"
    # Authentik admin API (docs/10 §10.4): the portal adds accepted applicants to portal-students
    # and resets passwords after an SMS code. Development: the bootstrap token works.
    authentik_api_url: str = "http://localhost:9000/auth/api/v3/"
    authentik_api_token: str = ""
    authentik_dev_password: str = "tcfl-dev-2027"  # app/authentik_dev.py

    s3_endpoint: str = "http://localhost:8333"
    s3_access_key: str = ""
    s3_secret_key: str = ""
    s3_region: str = "us-east-1"
    s3_bucket_documents: str = "applicant-documents"
    s3_bucket_content: str = "course-content"

    timezone: str = "Africa/Harare"
    # Library policy (design/LibraryDesk, Library). Confirm with the librarian.
    library_loan_days: int = 14
    library_max_renewals: int = 2
    library_location: str = "Block A"
    # ISO weekday → "HH:MM-HH:MM". design/Library and LibraryDesk: open until 20:00 on weekdays.
    library_hours: dict[int, str] = {
        1: "08:00-20:00",
        2: "08:00-20:00",
        3: "08:00-20:00",
        4: "08:00-20:00",
        5: "08:00-20:00",
    }
    library_hold_days: int = 3  # a ready reservation is kept this long at the desk

    # Unknowns in the designs ([LIKE THIS]); shown only once the college confirms them.
    fees_payment_options: str = ""  # design/Fees "How to pay"
    results_remark_days: int = 14  # design/Results: published 16 July, re-mark until 30 July
    results_notice: str = "These results are provisional until confirmed by HEXCO."

    # Admissions (design/Status, OfferReceived). Confirm with admissions.
    admissions_decision_working_days: int = 14  # "Decision expected by Fri 30 October" after 12 October
    offer_accept_days: int = 25  # decided 19 October, accept by 13 November
    registration_time: str = "08:00"  # "Register on Monday 1 February, 08:00"
    registration_location: str = "Block A"
    application_fee_usd: str = "20.00"
    # Mobile money (design/Payment "[PAYMENT PROVIDER]"): "" means none in production and the
    # development simulator elsewhere; "dev" forces the simulator. A real gateway plugs in here.
    payment_provider: str = ""
    payment_prompt_seconds: int = 60  # design/PayWaiting "Prompt expires in 0:48"
    # design/PayOffice: unknowns until Accounts confirm them; bank transfer is offered once set.
    bank_account_name: str = "TelOne Centre for Learning"
    bank_name: str = ""
    bank_account_number: str = ""
    bank_branch: str = ""
    accounts_office: str = "Block A, weekdays"  # design/Payment "Cash at the Accounts Office"
    bank_confirm_working_days: int = 2
    admissions_contact: str = (
        ""  # design/ReviewNotEligible "Contact the Admissions Office": phone or email, once confirmed
    )

    ocr_llm_mode: str = "fallback"  # off | fallback | always
    ocr_min_confidence: float = 0.80
    anthropic_api_key: str = ""
    ocr_claude_model: str = "claude-sonnet-5"
    # Phone handoff (docs/10 §10.10): a link works for 15 minutes; a claimed phone for 2 hours.
    handoff_claim_minutes: int = 15
    handoff_session_hours: int = 2
    document_max_mb: int = 5
    document_retention: str = ""  # design/IdDesktop "[RETENTION PERIOD]": shown once the college sets it
    claude_model: str = "claude-opus-5"
    assistant_enabled: bool = True

    @property
    def is_prod(self) -> bool:
        return self.app_env == "production"

    @property
    def dev_login_enabled(self) -> bool:
        return self.dev_login and not self.is_prod


@lru_cache
def get_settings() -> Settings:
    return Settings()
