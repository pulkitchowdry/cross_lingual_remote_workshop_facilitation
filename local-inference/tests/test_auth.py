import pytest
from fastapi import HTTPException

from app.auth import require_secret
from app.config import settings

# Matches conftest.py's `configured_secret` autouse fixture, which sets
# `settings.local_inference_secret` to this same value for every test in this
# directory.
CONFIGURED_SECRET = "test-secret"


def test_require_secret_accepts_correct_token():
    # Should not raise.
    require_secret(f"Bearer {CONFIGURED_SECRET}")


def test_require_secret_rejects_shorter_token_without_short_circuiting():
    """A provided secret shorter than the configured one must still be rejected as
    an ordinary 401 -- not treated specially -- now that require_secret no longer
    checks `len(provided) != len(expected)` before comparing (see auth.py's own doc
    comment: that raw-length short-circuit leaked the expected secret's length via
    response timing, the exact pattern src/lib/session-security.ts's secureCompare
    was rewritten to avoid)."""
    with pytest.raises(HTTPException) as exc_info:
        require_secret("Bearer short")
    assert exc_info.value.status_code == 401


def test_require_secret_rejects_longer_token_without_short_circuiting():
    with pytest.raises(HTTPException) as exc_info:
        require_secret(f"Bearer {CONFIGURED_SECRET}-with-a-lot-of-extra-padding-characters")
    assert exc_info.value.status_code == 401


def test_require_secret_rejects_wrong_token_of_same_length():
    wrong = "x" * len(CONFIGURED_SECRET)
    assert wrong != CONFIGURED_SECRET
    with pytest.raises(HTTPException) as exc_info:
        require_secret(f"Bearer {wrong}")
    assert exc_info.value.status_code == 401


def test_require_secret_rejects_missing_header():
    with pytest.raises(HTTPException) as exc_info:
        require_secret(None)
    assert exc_info.value.status_code == 401


def test_require_secret_rejects_missing_bearer_prefix():
    with pytest.raises(HTTPException) as exc_info:
        require_secret(CONFIGURED_SECRET)
    assert exc_info.value.status_code == 401


def test_require_secret_503s_when_service_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "local_inference_secret", "")
    with pytest.raises(HTTPException) as exc_info:
        require_secret(f"Bearer {CONFIGURED_SECRET}")
    assert exc_info.value.status_code == 503
