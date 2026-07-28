"""Speech-to-text via faster-whisper (CTranslate2-based Whisper), CPU/int8.
One-shot transcription per request, matching the Next.js side's chunked
buffering design (docs/TRANSLATION_ARCHITECTURE.md Part 5) — this service has
no notion of streaming or segment timing, only "these bytes -> this text"."""

import io
import re
import threading

from faster_whisper import WhisperModel

from app.config import settings
from app.languages import WHISPER_CODE

# Double-checked locking, not `@lru_cache`: `lru_cache` only serializes its own
# cache dict reads/writes, not the wrapped call — concurrent first callers (e.g.
# an unauthenticated /health poll landing next to a real request on cold start)
# would each construct their own full WhisperModel in parallel, multiplying
# memory right when the container is least able to afford it.
_model_lock = threading.Lock()
_model_instance: WhisperModel | None = None

# Whisper hallucinates stock phrases ("Thank you for watching", "Subtitles by ...")
# when fed silence or background noise — a well-known failure mode of the model
# itself, not a bug in how it's called. `vad_filter=True` (Silero VAD) below stops
# most of it by only ever handing Whisper audio it thinks contains speech;
# `NO_SPEECH_THRESHOLD` is a second, defense-in-depth check against faster-whisper's
# own per-segment `no_speech_prob` for whatever borderline audio still gets through.
NO_SPEECH_THRESHOLD = 0.6

# Second, independent defense layer: faster-whisper's own `no_speech_prob` is
# a poor signal for this specific failure mode. On silence/background noise
# Whisper doesn't just hallucinate low-confidence garbage — it frequently
# hallucinates stock filler phrases with HIGH confidence (low no_speech_prob),
# because to the model these look like plausible, fluent speech. "You" (and
# its close cousins) are the single most common of these — see e.g.
# openai/whisper#679. NO_SPEECH_THRESHOLD alone doesn't catch them, so this
# blocks a segment's text from surviving on its own when the *entire*
# finalized segment (not a substring — a real utterance containing "you"
# mid-sentence is unaffected) is exactly one of these known hallucinations.
HALLUCINATED_PHRASES = {
    "you",
    "thank you",
    "thanks for watching",
    "thank you for watching",
    "please subscribe",
    "bye",
    "bye bye",
}


def _model() -> WhisperModel:
    global _model_instance
    if _model_instance is None:
        with _model_lock:
            if _model_instance is None:
                _model_instance = WhisperModel(
                    f"{settings.model_root}/whisper-small",
                    device="cpu",
                    compute_type="int8",
                    cpu_threads=settings.inference_threads,
                )
    return _model_instance


def is_loaded() -> bool:
    return _model_instance is not None


def transcribe(audio_bytes: bytes, expected_language: str) -> str:
    segments, _info = _model().transcribe(
        io.BytesIO(audio_bytes),
        language=WHISPER_CODE[expected_language],
        beam_size=5,
        vad_filter=True,
    )
    return " ".join(
        segment.text.strip()
        for segment in segments
        if segment.no_speech_prob < NO_SPEECH_THRESHOLD and not _is_hallucinated(segment.text)
    ).strip()


def _is_hallucinated(text: str) -> bool:
    normalized = re.sub(r"[^\w\s]", "", text).strip().lower()
    return normalized in HALLUCINATED_PHRASES
