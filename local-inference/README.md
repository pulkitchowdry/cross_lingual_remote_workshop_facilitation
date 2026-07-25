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
| `INFERENCE_THREADS` | No (default `2`) | CPU thread count for CTranslate2 and faster-whisper |
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
2. Set `LOCAL_INFERENCE_SECRET` in the Railway dashboard (generate any random
   string) and, in the Next.js app's own Railway service (or `.env.local` for
   local dev), set matching `LOCAL_INFERENCE_URL` (this service's public
   Railway URL) and `LOCAL_INFERENCE_SECRET`.
3. Railway injects `PORT` automatically; the Dockerfile's `CMD` already reads it.
4. Confirm the healthcheck (`GET /health`, `railway.json`'s `healthcheckPath`)
   passes after the first deploy — it can take longer than the default
   timeout on a cold `docker build`, hence `healthcheckTimeout: 300`.

## Known limitations

- **No interim STT results.** Chunked ~2.5s-window transcription only — see
  "Endpoints" above. True incremental streaming (VAD/rolling-buffer, closer
  to Deepgram's latency) is a possible fast-follow, not built here.
- **Piper's Mandarin voice** (`zh_CN-huayan-medium`) is noticeably weaker than
  its English/Spanish voices — accepted as an MVP limitation.
- **Latency budgets** in `docs/TRANSLATION_ARCHITECTURE.md`'s performance
  table (<1s STT/MT) were written against managed cloud APIs; CPU inference
  for all three models sharing one Railway instance may not hit those numbers.
  No specific Railway CPU/plan sizing is prescribed here — a cost/ops decision
  left to whoever deploys this.
- **Not verified end-to-end in this environment** — no Railway project or
  Hugging Face network access was available while building this. Before
  relying on this in production: build the image, run it, and confirm all
  three routes and `/health` behave as documented above with real model
  weights.

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
