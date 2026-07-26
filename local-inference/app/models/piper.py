"""Text-to-speech via Piper, one voice model per supported language. Piper's
Mandarin voice is noticeably weaker than its English/Spanish voices — see
languages.py and local-inference/README.md's "Known limitations"."""

import io
import threading
import wave

from piper import PiperVoice

from app.config import settings
from app.languages import PIPER_VOICE

# Double-checked locking, not `@lru_cache`: `lru_cache` only serializes its own
# cache dict reads/writes, not the wrapped call — concurrent first callers (e.g.
# an unauthenticated /health poll landing next to a real request on cold start)
# would each construct their own PiperVoice in parallel for the same language,
# multiplying memory right when the container is least able to afford it. A
# single lock guarding the dict is fine here: it's only ever held around a
# one-time-per-language load, never around synthesize()'s hot path.
_voice_lock = threading.Lock()
_voices: dict[str, PiperVoice] = {}


def _voice(language: str) -> PiperVoice:
    voice = _voices.get(language)
    if voice is None:
        with _voice_lock:
            voice = _voices.get(language)
            if voice is None:
                voice_name = PIPER_VOICE[language]
                voice = PiperVoice.load(
                    f"{settings.model_root}/piper/{voice_name}.onnx",
                    config_path=f"{settings.model_root}/piper/{voice_name}.onnx.json",
                )
                _voices[language] = voice
    return voice


def is_loaded() -> bool:
    return all(language in _voices for language in PIPER_VOICE)


def synthesize(text: str, language: str) -> bytes:
    voice = _voice(language)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        voice.synthesize(text, wav_file)
    return buffer.getvalue()
