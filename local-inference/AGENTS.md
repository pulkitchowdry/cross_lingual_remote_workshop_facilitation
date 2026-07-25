# local-inference/ — conventions for this service

Read `local-inference/README.md` first for *why* this service exists, its
endpoint contract, and its documented limitations. This file is about *how*
to extend it consistently.

## Structure

- `app/routers/{translate,stt,tts}.py` — one FastAPI router per capability,
  each a thin HTTP wrapper: validate input, call the matching `app/models/`
  singleton, map exceptions to HTTP errors. Keep routers thin — model logic
  belongs in `app/models/`, not inlined here.
- `app/models/{nllb,piper,whisper}.py` — one module per model, each holding a
  lazily-loaded singleton (`is_loaded()` reports whether it's been
  initialized — this is what `/health` reports). Tests mock these singletons
  rather than loading real weights (see "Testing" below), so keep the
  singleton/`is_loaded()` shape if you add a new model — it's what makes that
  mocking possible.
- `app/auth.py` — every inference route requires
  `dependencies=[Depends(require_secret)]`. `/health` deliberately does not
  (Railway's healthcheck hits it directly, unauthenticated, and Docker
  Compose's healthcheck does the same locally). New routes should follow
  whichever pattern matches: internal-only → require_secret, healthcheck-only
  → no auth.
- `app/config.py` — env-driven `Settings` via `pydantic-settings`. Add new env
  vars here, not as ad hoc `os.environ` reads elsewhere, so they show up in
  one place.

## Adding a new inference route or language

1. Add the model/logic under `app/models/` if it's new capability, or extend
   the existing singleton if it's a new language for NLLB/Piper/Whisper.
2. Add or extend a router in `app/routers/`, gated by `require_secret` unless
   it's a healthcheck.
3. Register the router in `app/main.py` (`app.include_router(...)`) if it's
   new.
4. Update the endpoint table in `README.md` and add a route/model test (see
   below) — this suite is the only thing that runs in CI-equivalent form for
   this package, there's no separate integration environment.
5. If it needs new model weights, add the download to
   `scripts/download_models.sh` — weights are baked into the Docker image at
   build time (see that script's comment for why), not fetched at runtime.

## Testing

```sh
cd local-inference
pip install -r requirements.txt -r requirements-dev.txt
pytest
```

Tests mock the model singletons (see `tests/conftest.py`) instead of loading
real weights, so this suite runs without Docker or downloaded models and
should stay that way — don't add a test that requires real model weights to
pass; that belongs as a manual smoke test against a built image instead (see
README's `curl` examples).

This suite runs standalone (`cd local-inference && pytest`), not as part of
the root `npm test` — there's no shared CI wiring the two together yet.
