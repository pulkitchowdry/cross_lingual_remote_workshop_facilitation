import io

from app.models import whisper


def test_transcribe_requires_auth(client):
    response = client.post(
        "/stt/transcribe",
        files={"audio": ("clip.wav", io.BytesIO(b"fake-audio"), "audio/wav")},
        data={"expectedLanguage": "en"},
    )
    assert response.status_code == 401


def test_transcribe_returns_text(client, auth_headers, monkeypatch):
    monkeypatch.setattr(whisper, "transcribe", lambda audio_bytes, expected_language: "hello world")
    response = client.post(
        "/stt/transcribe",
        files={"audio": ("clip.wav", io.BytesIO(b"fake-audio"), "audio/wav")},
        data={"expectedLanguage": "en"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json() == {"text": "hello world"}


def test_transcribe_empty_audio_short_circuits(client, auth_headers, monkeypatch):
    called = []
    monkeypatch.setattr(whisper, "transcribe", lambda *args: called.append(args))
    response = client.post(
        "/stt/transcribe",
        files={"audio": ("clip.wav", io.BytesIO(b""), "audio/wav")},
        data={"expectedLanguage": "en"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json() == {"text": ""}
    assert called == []
