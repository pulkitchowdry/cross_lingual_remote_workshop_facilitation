# Skills: local-inference/ tasks

See [`AGENTS.md`](AGENTS.md) for the module structure and conventions this
assumes.

## Run it locally

Via Docker (bakes models into the image — see `README.md`):

```sh
cd local-inference
docker build -t clrwf-local-inference .
docker run -p 8080:8080 -e LOCAL_INFERENCE_SECRET=devsecret clrwf-local-inference
```

Or as part of the full stack: `docker compose up local-inference` from the
repo root (see `docs/DEPLOYMENT.md`).

## Run the tests

```sh
cd local-inference
pip install -r requirements.txt -r requirements-dev.txt
pytest
```

## Add a new inference route, language, or model

See `AGENTS.md`'s "Adding a new inference route or language" — the short
version: model logic in `app/models/`, thin router in `app/routers/`,
registered in `app/main.py`, tests added, `README.md`'s endpoint table
updated, and if new weights are needed, add them to
`scripts/download_models.sh`.

## Rebuild after changing dependencies or model downloads

`requirements.txt` and `scripts/download_models.sh` are both baked in at
`docker build` time — changing either invalidates the Docker layer cache from
that point on, so expect a slow rebuild (weights are ~1-1.5GB). This is
deliberate (see the comment at the top of `scripts/download_models.sh`) —
Railway's filesystem is ephemeral per deploy, so baking in trades slower
builds for fast, deterministic starts.

## Deploy

Railway, via `local-inference/railway.json` — see `docs/DEPLOYMENT.md`. This
needs a persistent process holding ~1-1.5GB of models in memory, so it can't
run on Vercel Functions — see `README.md`'s "Why this is a separate package".
