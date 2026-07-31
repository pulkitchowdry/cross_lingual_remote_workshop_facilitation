# Local-inference service

A standalone FastAPI service that runs translation (NLLB), speech-to-text
(faster-whisper), and text-to-speech (Piper) entirely on this server, with no
external API calls at inference time. This is the "self-hosted local-inference
tier" from `docs/TRANSLATION_ARCHITECTURE.md` Part 5 — the Next.js app tries
this service first for every translation/caption/voice request, falling back
to Claude/Deepgram/ElevenLabs only if this service is unreachable (and only if
the requesting session hasn't opted into strict-privacy mode, which disables
that fallback entirely).

## Why this is a separate package

This is the first Python component in the repo. It needs a long-lived process
holding three CPU models (NLLB-600M-int8, faster-whisper-small, three Piper
voices — roughly 1-1.5GB combined) in memory and a different runtime (Python,
not Node), so it deploys as its own Railway service rather than as part of
the main app's service. Unlike the LiveKit caption worker
(`src/lib/caption-agent.ts`, which was merged into the main Next.js
app/process since both are Node and the split wasn't worth the ops overhead
for a hackathon project), this service genuinely can't merge: different
language runtime, different dependency tree (`ctranslate2`, `faster-whisper`,
`piper-tts`, `transformers` — none of which belong in the Next.js app's
install). It lives in its own directory and talks to the Next.js app over
plain authenticated HTTP (shared-secret, `LOCAL_INFERENCE_SECRET`), in the
opposite call direction (the Next.js app calls out to this service).

## Endpoints

All three inference routes require `Authorization: Bearer <LOCAL_INFERENCE_SECRET>`.
`/health` does not (Railway's healthcheck hits it directly).

| Route | Body | Response |
| --- | --- | --- |
| `GET /health` | — | `{"status":"ok","modelsLoaded":{"nllb":true,"whisper":true,"piper":true}}` |
| `POST /translate` | `{"text","sourceLanguage","targetLanguage"}` (en/zh/es) | `{"text","provider":"nllb"}` |
| `POST /stt/transcribe` | multipart: `audio` file + `expectedLanguage` form field | `{"text"}` |
| `POST /tts/synthesize` | `{"text","language"}` | raw `audio/wav` bytes, header `X-TTS-Provider: piper` |

`/stt/transcribe` deliberately returns only `text` — this service has no
notion of segment timing, speaker identity, or streaming; the Next.js side's
`LocalBufferingSpeechToTextStream` (`src/lib/providers/local-speech-buffer.ts`)
owns those by buffering ~2.5s audio windows and calling this endpoint once per
window. There are no interim/partial results from this tier, unlike
Deepgram's live websocket API — a documented latency/UX tradeoff for running
fully self-hosted.

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `LOCAL_INFERENCE_SECRET` | Yes | Must match the Next.js app's `LOCAL_INFERENCE_SECRET` |
| `INFERENCE_THREADS` | No (default `2`) | CPU thread count for CTranslate2 and faster-whisper — see "Known limitations" below before trusting the default on a multi-vCPU Railway plan |
| `PORT` | No (default `8080`) | Railway sets this automatically |

## Running locally

```sh
cd local-inference
docker build -t clrwf-local-inference .
docker run -p 8080:8080 -e LOCAL_INFERENCE_SECRET=devsecret clrwf-local-inference
```

```sh
curl http://localhost:8080/health

curl -X POST http://localhost:8080/translate \
  -H "Authorization: Bearer devsecret" -H "Content-Type: application/json" \
  -d '{"text":"Hello, welcome to the workshop.","sourceLanguage":"en","targetLanguage":"es"}'

curl -X POST http://localhost:8080/tts/synthesize \
  -H "Authorization: Bearer devsecret" -H "Content-Type: application/json" \
  -d '{"text":"Hola","language":"es"}' -o out.wav

curl -X POST http://localhost:8080/stt/transcribe \
  -H "Authorization: Bearer devsecret" \
  -F "audio=@sample.wav" -F "expectedLanguage=en"
```

The Docker build bakes all model weights in at build time (see
`scripts/download_models.sh`), so the first `docker build` is slow (~1-2GB of
downloads) but every container start after that is fast — no runtime model
download, no dependency on Hugging Face being reachable at startup.

## Deploying to Railway

1. Create a new Railway service pointed at this directory (`local-inference/`
   as the root), builder `DOCKERFILE` — already configured in `railway.json`.
2. **Budget at least ~2GB of memory for this service once it's actually
   serving traffic** — see "Known limitations" below. `/health` no longer
   forces all three models to load (it just reports whether each singleton
   has been constructed), so a fresh deploy will pass its healthcheck on a
   much smaller memory allocation than before. But the first real translate/
   STT/TTS request still lazily loads its model, and combined real memory use
   for NLLB + faster-whisper + all three Piper voices loaded together still
   runs well above the on-disk ~1-1.5GB estimate. On a plan capped below
   ~2GB, expect `Killed` (OOM) once traffic has touched all three
   capabilities, not on the healthcheck. In the Railway dashboard: this
   service → Settings → look for a Resources/Memory limit control (exact
   location depends on your Railway plan; a Hobby-tier project may need
   upgrading to a plan that allows custom resource limits) and raise it.
3. Set `LOCAL_INFERENCE_SECRET` on this service (generate any random string).
4. On the Next.js app's (`web`) Railway service, set two variables so it can
   reach this one over Railway's private network — **not** this service's
   public URL, and there's no separate "Connect" step needed for this to
   work; any service in the same Railway project can already reach any
   other's `RAILWAY_PRIVATE_DOMAIN` (see this service's Settings → Networking
   for the exact value, normally derived from its service name):
   - `LOCAL_INFERENCE_URL=http://${{local-inference.RAILWAY_PRIVATE_DOMAIN}}:8080`
     (replace `local-inference` with whatever you actually named this
     service in Railway if different)
   - `LOCAL_INFERENCE_SECRET=${{local-inference.LOCAL_INFERENCE_SECRET}}`
     (a reference to the value you set in step 3, so it's always in sync —
     or just paste the same literal string on both services)
   This service does **not** need a connection to Postgres or anything else
   — it has no database access at all.
5. Railway injects `PORT` automatically; the Dockerfile's `CMD` already reads it.
6. Confirm the healthcheck (`GET /health`, `railway.json`'s `healthcheckPath`)
   passes after the first deploy — it can take longer than the default
   timeout on a cold `docker build`, hence `healthcheckTimeout: 300`. If it
   instead loops "Application startup complete" → `Killed` → restart, that's
   the memory issue in step 2, not a code problem — see below.

## Known limitations

- **No interim STT results.** Chunked ~2.5s-window transcription only — see
  "Endpoints" above. True incremental streaming (VAD/rolling-buffer, closer
  to Deepgram's latency) is a possible fast-follow, not built here.
- **Piper's Mandarin voice** (`zh_CN-huayan-medium`) is noticeably weaker than
  its English/Spanish voices — accepted as an MVP limitation.
- **Latency budgets** in `docs/TRANSLATION_ARCHITECTURE.md`'s performance
  table (<1s STT/MT) were written against managed cloud APIs; CPU inference
  for all three models sharing one Railway instance may not hit those numbers.
- **`INFERENCE_THREADS` defaulting to `2` silently wastes a bigger Railway
  plan, and starves `/translate` under concurrent STT — confirmed live
  (2026-07-31).** Both `WhisperModel(cpu_threads=...)` (`app/models/whisper.py`)
  and `ctranslate2.Translator(inter_threads=..., intra_threads=...)`
  (`app/models/nllb.py`) read this one setting, so it caps CPU parallelism for
  *all* inference work regardless of how many vCPUs the service is actually
  allocated — a 32-vCPU plan still only ever uses 2 threads until this is
  raised. With two facilitator+learner STT streams open at once (`caption-agent.ts`
  under `CAPTION_CAPTURE_MODE=agent-all`) each submitting ~2.5s audio windows,
  that 2-thread budget saturates, and a concurrent `/translate` call queues
  behind it long enough to blow past its 5s client-side timeout
  (`local-inference-client.ts`) even though this service itself always
  eventually answers `200 OK` — the client had already given up. Symptom:
  `[translation] local-inference translate attempt 1/2 failed ... TimeoutError`
  in the `web` logs while this service's own access log shows nothing but
  `200 OK`s, just slow ones. Fix: raise `INFERENCE_THREADS` (e.g. `8`) to match
  the service's actual CPU allocation — set on Railway directly, since
  `app/config.py`'s and `docker-compose.yml`'s defaults are just local-dev
  fallbacks, not what a production plan with real vCPU headroom should run at.
- **Needs at least ~2GB of memory on Railway once all three models have been
  used, confirmed by an actual failed deploy** (not just the "~1-1.5GB
  combined" model-file-size estimate above — real memory use during loading/
  inference runs higher than the on-disk weights). Each model module's
  `is_loaded()` (`app/models/{nllb,piper,whisper}.py`) only reports whether
  its singleton has already been constructed — it does not construct it, so
  hitting `/health` no longer forces a load. NLLB (ctranslate2 + tokenizer),
  faster-whisper, and each Piper voice still lazily load into memory on their
  *first real request*, and none of them ever unload, so a deploy that
  actually serves translate + STT + TTS traffic still needs the combined
  footprint of all three. Undersized memory shows up as: `Application startup
  complete` / `Uvicorn running` in the logs, then — once traffic exercises
  the remaining capabilities — `Killed` (the OOM killer, not an application
  crash) and a restart loop. The `None of PyTorch, TensorFlow >= 2.0, or Flax
  have been found` line is unrelated noise from `transformers` and expected —
  this service uses `ctranslate2` for the actual translation model, not
  PyTorch, and only uses `transformers` for tokenization. Fix: raise the
  Railway service's memory limit (see "Deploying to Railway" step 2); on a
  plan hard-capped below ~2GB, either drop one of the three capabilities from
  this service or route it to a cloud provider instead (see root
  `docs/DEPLOYMENT.md` — most features fall back to cloud/mock providers when
  their local-inference route isn't available).

## Running tests

```sh
cd local-inference
pip install -r requirements.txt -r requirements-dev.txt
pytest
```

Tests mock the model singletons (`app/models/*.py`) rather than loading real
weights, so `pytest` doesn't require the Docker image or downloaded models —
it only exercises routing, auth, and request/response shapes. This suite runs
standalone (`cd local-inference && pytest`), not as part of the root `npm test`
— there's no existing CI in this repo to wire it into yet.
