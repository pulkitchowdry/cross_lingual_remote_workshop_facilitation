from app.models import nllb


def test_translate_requires_auth(client):
    response = client.post("/translate", json={"text": "hi", "sourceLanguage": "en", "targetLanguage": "es"})
    assert response.status_code == 401


def test_translate_rejects_unsupported_language(client, auth_headers):
    response = client.post(
        "/translate",
        json={"text": "hi", "sourceLanguage": "en", "targetLanguage": "fr"},
        headers=auth_headers,
    )
    assert response.status_code == 400


def test_translate_returns_nllb_provider(client, auth_headers, monkeypatch):
    monkeypatch.setattr(nllb, "translate", lambda text, source, target: "hola")
    response = client.post(
        "/translate",
        json={"text": "hello", "sourceLanguage": "en", "targetLanguage": "es"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json() == {"text": "hola", "provider": "nllb"}


def test_translate_failure_returns_502(client, auth_headers, monkeypatch):
    def _raise(*_args, **_kwargs):
        raise RuntimeError("model not loaded")

    monkeypatch.setattr(nllb, "translate", _raise)
    response = client.post(
        "/translate",
        json={"text": "hello", "sourceLanguage": "en", "targetLanguage": "es"},
        headers=auth_headers,
    )
    assert response.status_code == 502
