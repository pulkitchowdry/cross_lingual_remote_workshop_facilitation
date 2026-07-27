from types import SimpleNamespace

from app.models import whisper


def test_transcribe_enables_vad_and_drops_high_no_speech_segments(monkeypatch):
    """Whisper hallucinates stock phrases ("Thank you for watching", subtitle
    credits, etc.) on silence/background noise — `vad_filter` and the
    `no_speech_prob` check in `whisper.transcribe` exist to suppress exactly
    that. Confirms both are actually wired up: vad_filter is requested from
    faster-whisper, and a segment faster-whisper itself flags as likely
    silence gets dropped rather than joined into the returned text.
    """
    captured_kwargs = {}

    class _FakeModel:
        def transcribe(self, _audio, **kwargs):
            captured_kwargs.update(kwargs)
            segments = [
                SimpleNamespace(text=" hello ", no_speech_prob=0.1),
                SimpleNamespace(text="Thank you for watching", no_speech_prob=0.95),
                SimpleNamespace(text=" world", no_speech_prob=0.4),
            ]
            return segments, SimpleNamespace()

    monkeypatch.setattr(whisper, "_model", lambda: _FakeModel())

    text = whisper.transcribe(b"fake-audio", "en")

    assert text == "hello world"
    assert captured_kwargs["vad_filter"] is True
