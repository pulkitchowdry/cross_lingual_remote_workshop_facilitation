import hashlib
import hmac

from fastapi import Header, HTTPException

from app.config import settings


def require_secret(authorization: str | None = Header(default=None)) -> None:
    """Bearer-token auth for the inference routes, mirroring the constant-time
    comparison the Next.js app already uses for its own shared secrets
    (`secureCompare` in `src/lib/session-security.ts`).

    Compares fixed-length SHA-256 digests of the provided/expected secrets rather
    than the raw strings, so `hmac.compare_digest` always receives equal-length
    buffers regardless of how the inputs differ in length — no separate raw-length
    short-circuit needed, which would otherwise leak the expected secret's length
    (and, via repeated timing measurements, potentially more) to an attacker
    probing this endpoint.
    """
    if not settings.local_inference_secret:
        raise HTTPException(status_code=503, detail="Service has no LOCAL_INFERENCE_SECRET configured.")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token.")
    provided = authorization.removeprefix("Bearer ")
    expected = settings.local_inference_secret
    provided_digest = hashlib.sha256(provided.encode()).digest()
    expected_digest = hashlib.sha256(expected.encode()).digest()
    if not hmac.compare_digest(provided_digest, expected_digest):
        raise HTTPException(status_code=401, detail="Invalid bearer token.")
