from app.models import piper
from app.routers.tts import MAX_TEXT_LENGTH


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


# Regression test: this endpoint synthesizes already-*translated* text (never
# re-capped at 3000 after translation — see the MAX_TEXT_LENGTH comment in
# tts.py), which routinely runs longer than the original 3000-char caption/chat
# input a translation was derived from. Text in this range used to 422 here even
# though Piper (no process-wide lock during synthesis, unlike NLLB's translate())
# could speak it fine.
def test_synthesize_accepts_text_longer_than_the_original_input_cap(client, auth_headers, monkeypatch):
    monkeypatch.setattr(piper, "synthesize", lambda text, language: b"RIFF....WAVEfmt ")
    text = "a" * 4000
    assert len(text) > 3000
    response = client.post(
        "/tts/synthesize",
        json={"text": text, "language": "en"},
        headers=auth_headers,
    )
    assert response.status_code == 200


def test_synthesize_still_rejects_text_past_its_own_ceiling(client, auth_headers):
    response = client.post(
        "/tts/synthesize",
        json={"text": "a" * (MAX_TEXT_LENGTH + 1), "language": "en"},
        headers=auth_headers,
    )
    assert response.status_code == 422
