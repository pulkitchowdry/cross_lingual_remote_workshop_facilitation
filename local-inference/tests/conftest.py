import pytest
from fastapi.testclient import TestClient

from app.config import settings

TEST_SECRET = "test-secret"


@pytest.fixture(autouse=True)
def configured_secret(monkeypatch):
    monkeypatch.setattr(settings, "local_inference_secret", TEST_SECRET)


@pytest.fixture
def client():
    from app.main import app

    return TestClient(app)


@pytest.fixture
def auth_headers():
    return {"Authorization": f"Bearer {TEST_SECRET}"}
