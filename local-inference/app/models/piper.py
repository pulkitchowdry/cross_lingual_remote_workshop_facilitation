"""Text-to-speech via Piper, one voice model per supported language. Piper's
Mandarin voice is noticeably weaker than its English/Spanish voices — see
languages.py and local-inference/README.md's "Known limitations"."""

import io
import wave
from functools import lru_cache

from piper import PiperVoice

from app.config import settings
from app.languages import PIPER_VOICE


@lru_cache(maxsize=None)
def _voice(language: str) -> PiperVoice:
    voice_name = PIPER_VOICE[language]
    return PiperVoice.load(
        f"{settings.model_root}/piper/{voice_name}.onnx",
        config_path=f"{settings.model_root}/piper/{voice_name}.onnx.json",
    )


def is_loaded() -> bool:
    try:
        for language in PIPER_VOICE:
            _voice(language)
        return True
    except Exception:
        return False


def synthesize(text: str, language: str) -> bytes:
    voice = _voice(language)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        voice.synthesize(text, wav_file)
    return buffer.getvalue()
