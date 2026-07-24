import hmac

from fastapi import Header, HTTPException

from app.config import settings


def require_secret(authorization: str | None = Header(default=None)) -> None:
    """Bearer-token auth for the inference routes, mirroring the constant-time
    comparison the Next.js app already uses for its own shared secrets
    (`secureCompare` in `src/lib/session-security.ts`)."""
    if not settings.local_inference_secret:
        raise HTTPException(status_code=503, detail="Service has no LOCAL_INFERENCE_SECRET configured.")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token.")
    provided = authorization.removeprefix("Bearer ")
    expected = settings.local_inference_secret
    if len(provided) != len(expected) or not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=401, detail="Invalid bearer token.")
