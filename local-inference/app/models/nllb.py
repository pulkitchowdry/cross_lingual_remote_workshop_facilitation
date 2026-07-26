"""NLLB-200-distilled-600M translation via a CTranslate2 int8 conversion
(`pulkitchowdry/nllb-600m-ct2-int8`). The CT2 conversion carries only the
translation weights, not a tokenizer, so the tokenizer is loaded separately
from the base NLLB repo (tokenizer artifacts only — see
scripts/download_models.sh, which skips the ~2.4GB PyTorch weights)."""

import threading

import ctranslate2
from transformers import AutoTokenizer

from app.config import settings
from app.languages import FLORES_CODE

# `translate()` runs on FastAPI's request threadpool (routers/translate.py's handler is
# a plain `def`, auto-offloaded by Starlette) against the single tokenizer singleton
# below. Guards the set-src_lang-then-encode step, since two concurrent
# requests with different source languages would otherwise race on that shared mutable
# `.src_lang` attribute and silently tokenize one request's text with the other's
# source-language token.
_tokenizer_lock = threading.Lock()

# Double-checked locking, not `@lru_cache`: `lru_cache` only serializes its own
# cache dict reads/writes, not the wrapped call — concurrent first callers (e.g.
# an unauthenticated /health poll landing next to a real request on cold start)
# would each construct their own full Translator/tokenizer in parallel, multiplying
# memory right when the container is least able to afford it.
_translator_lock = threading.Lock()
_translator_instance: ctranslate2.Translator | None = None

_tokenizer_instance_lock = threading.Lock()
_tokenizer_instance = None


def _translator() -> ctranslate2.Translator:
    global _translator_instance
    if _translator_instance is None:
        with _translator_lock:
            if _translator_instance is None:
                _translator_instance = ctranslate2.Translator(
                    f"{settings.model_root}/nllb",
                    device="cpu",
                    inter_threads=settings.inference_threads,
                    intra_threads=settings.inference_threads,
                )
    return _translator_instance


def _tokenizer():
    global _tokenizer_instance
    if _tokenizer_instance is None:
        with _tokenizer_instance_lock:
            if _tokenizer_instance is None:
                _tokenizer_instance = AutoTokenizer.from_pretrained(f"{settings.model_root}/nllb-tokenizer")
    return _tokenizer_instance


def is_loaded() -> bool:
    return _translator_instance is not None and _tokenizer_instance is not None


def translate(text: str, source_language: str, target_language: str) -> str:
    tokenizer = _tokenizer()
    with _tokenizer_lock:
        tokenizer.src_lang = FLORES_CODE[source_language]
        source_tokens = tokenizer.convert_ids_to_tokens(tokenizer.encode(text))

    # `_translator().translate_batch` and the id/decode calls below only depend on
    # `source_tokens` (already a plain local list) and vocabulary lookups that don't
    # depend on `.src_lang` — safe to run outside the lock.
    target_prefix = [FLORES_CODE[target_language]]
    # ctranslate2.Translator.translate_batch defaults to max_input_length=1024 and
    # max_decoding_length=256 tokens, silently truncating anything longer instead of
    # raising — a routine multi-sentence caption or chat message (this service's own
    # /translate route accepts up to MAX_TEXT_LENGTH=3000 characters) can easily need
    # more than 256 output tokens, especially translating into a token-denser target
    # language. Both are raised well above what a 3000-character input could plausibly
    # need on either side, so a normal request is never silently cut off.
    results = _translator().translate_batch(
        [source_tokens],
        target_prefix=[target_prefix],
        max_input_length=4096,
        max_decoding_length=4096,
    )

    output_tokens = results[0].hypotheses[0][1:]  # drop the forced target-language prefix token
    output_ids = tokenizer.convert_tokens_to_ids(output_tokens)
    return tokenizer.decode(output_ids, skip_special_tokens=True).strip()
