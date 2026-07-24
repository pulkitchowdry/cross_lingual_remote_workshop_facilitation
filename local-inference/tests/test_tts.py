from app.models import piper


def test_synthesize_requires_auth(client):
    response = client.post("/tts/synthesize", json={"text": "hi", "language": "en"})
    assert response.status_code == 401


def test_synthesize_returns_audio(client, auth_headers, monkeypatch):
    monkeypatch.setattr(piper, "synthesize", lambda text, language: b"RIFF....WAVEfmt ")
    response = client.post(
        "/tts/synthesize",
        json={"text": "hello", "language": "en"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.headers["x-tts-provider"] == "piper"
    assert response.content == b"RIFF....WAVEfmt "
