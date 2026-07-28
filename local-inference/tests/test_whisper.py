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


def test_transcribe_drops_confident_hallucinated_filler(monkeypatch):
    """"You" (and similar stock filler) is Whisper's most common hallucination on
    silence/background noise, and — unlike "Thank you for watching" above — it's
    typically emitted with a LOW no_speech_prob, i.e. the model is confident about
    it. The no_speech_prob check alone lets this through; the text-based
    HALLUCINATED_PHRASES check is the second, independent layer that catches it.
    A real segment merely containing "you" mid-sentence must survive untouched.
    """

    class _FakeModel:
        def transcribe(self, _audio, **_kwargs):
            segments = [
                SimpleNamespace(text=" You", no_speech_prob=0.05),
                SimpleNamespace(text="Thank you.", no_speech_prob=0.1),
                SimpleNamespace(text=" I think you understand", no_speech_prob=0.1),
            ]
            return segments, SimpleNamespace()

    monkeypatch.setattr(whisper, "_model", lambda: _FakeModel())

    text = whisper.transcribe(b"fake-audio", "en")

    assert text == "I think you understand"
