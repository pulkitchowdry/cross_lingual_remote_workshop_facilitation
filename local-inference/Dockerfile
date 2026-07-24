FROM python:3.11-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY scripts/download_models.sh scripts/download_models.sh
RUN chmod +x scripts/download_models.sh && ./scripts/download_models.sh

COPY app/ app/

ENV PORT=8080
EXPOSE 8080

# --workers 1: each worker would duplicate the combined NLLB/whisper/Piper
# model memory footprint. Scale via Railway replicas, not multi-worker.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1"]
