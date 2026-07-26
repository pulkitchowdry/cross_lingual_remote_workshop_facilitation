"""`app/models/{nllb,whisper,piper}.py` lazily construct a model singleton on
first use. `@functools.lru_cache` looked like the obvious tool for that, but
it only serializes its own cache dict reads/writes — not the wrapped call —
so concurrent first callers (e.g. an unauthenticated /health poll landing
next to a real request on cold start) would each construct their own full
model in parallel. These tests prove the double-checked-locking singletons
that replaced `lru_cache` actually collapse concurrent first callers into a
single construction, using a slow, call-counting stub in place of the real
(heavyweight) constructor.
"""

import threading
import time
from concurrent.futures import ThreadPoolExecutor

from app.models import nllb, piper, whisper


def _reset(module, **instances):
    for name, value in instances.items():
        setattr(module, name, value)


def _slow_counter(delay=0.05):
    calls = []
    lock = threading.Lock()

    def constructor(*args, **kwargs):
        with lock:
            calls.append((args, kwargs))
        time.sleep(delay)
        return object()

    return constructor, calls


def test_nllb_translator_constructed_once_under_concurrency(monkeypatch):
    _reset(nllb, _translator_instance=None, _tokenizer_instance=None)
    constructor, calls = _slow_counter()
    monkeypatch.setattr(nllb.ctranslate2, "Translator", constructor)

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: nllb._translator(), range(8)))

    assert len(calls) == 1
    assert len({id(result) for result in results}) == 1


def test_nllb_tokenizer_constructed_once_under_concurrency(monkeypatch):
    _reset(nllb, _translator_instance=None, _tokenizer_instance=None)
    constructor, calls = _slow_counter()
    monkeypatch.setattr(nllb.AutoTokenizer, "from_pretrained", constructor)

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: nllb._tokenizer(), range(8)))

    assert len(calls) == 1
    assert len({id(result) for result in results}) == 1


def test_whisper_model_constructed_once_under_concurrency(monkeypatch):
    _reset(whisper, _model_instance=None)
    constructor, calls = _slow_counter()
    monkeypatch.setattr(whisper, "WhisperModel", constructor)

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: whisper._model(), range(8)))

    assert len(calls) == 1
    assert len({id(result) for result in results}) == 1


def test_piper_voice_constructed_once_per_language_under_concurrency(monkeypatch):
    piper._voices.clear()
    constructor, calls = _slow_counter()
    monkeypatch.setattr(piper.PiperVoice, "load", staticmethod(constructor))

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: piper._voice("en"), range(8)))

    assert len(calls) == 1
    assert len({id(result) for result in results}) == 1

    # A different language is its own singleton, not blocked by "en" already
    # being cached — the lock only guards a single language's cold start.
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda _: piper._voice("es"), range(8)))
    assert len(calls) == 2
