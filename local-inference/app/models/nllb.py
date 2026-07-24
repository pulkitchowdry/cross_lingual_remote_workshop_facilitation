"""NLLB-200-distilled-600M translation via a CTranslate2 int8 conversion
(`pulkitchowdry/nllb-600m-ct2-int8`). The CT2 conversion carries only the
translation weights, not a tokenizer, so the tokenizer is loaded separately
from the base NLLB repo (tokenizer artifacts only — see
scripts/download_models.sh, which skips the ~2.4GB PyTorch weights)."""

from functools import lru_cache

import ctranslate2
from transformers import AutoTokenizer

from app.config import settings
from app.languages import FLORES_CODE


@lru_cache(maxsize=1)
def _translator() -> ctranslate2.Translator:
    return ctranslate2.Translator(
        f"{settings.model_root}/nllb",
        device="cpu",
        inter_threads=settings.inference_threads,
        intra_threads=settings.inference_threads,
    )


@lru_cache(maxsize=1)
def _tokenizer():
    return AutoTokenizer.from_pretrained(f"{settings.model_root}/nllb-tokenizer")


def is_loaded() -> bool:
    try:
        _translator()
        _tokenizer()
        return True
    except Exception:
        return False


def translate(text: str, source_language: str, target_language: str) -> str:
    tokenizer = _tokenizer()
    tokenizer.src_lang = FLORES_CODE[source_language]
    source_tokens = tokenizer.convert_ids_to_tokens(tokenizer.encode(text))

    target_prefix = [FLORES_CODE[target_language]]
    results = _translator().translate_batch([source_tokens], target_prefix=[target_prefix])

    output_tokens = results[0].hypotheses[0][1:]  # drop the forced target-language prefix token
    output_ids = tokenizer.convert_tokens_to_ids(output_tokens)
    return tokenizer.decode(output_ids, skip_special_tokens=True).strip()
