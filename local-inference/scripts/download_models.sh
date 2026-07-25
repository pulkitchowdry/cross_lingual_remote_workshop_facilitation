#!/bin/sh
# Bakes all model weights into the Docker image at build time (see Dockerfile).
# Railway's container filesystem is ephemeral per deploy without an attached
# Volume, so downloading at runtime would mean re-fetching ~1GB+ of weights on
# every deploy and failing the healthcheck until that finishes. Baking in
# trades a slower `docker build` (cached by Railway between deploys unless
# this file or requirements.txt changes) for fast, deterministic starts.
set -eu

mkdir -p /models

huggingface-cli download pulkitchowdry/nllb-600m-ct2-int8 --local-dir /models/nllb

# Tokenizer artifacts only — the CT2 conversion above already carries the
# translation weights; skip the base model's ~2.4GB PyTorch weights.
huggingface-cli download facebook/nllb-200-distilled-600M \
  --include "tokenizer.json" "tokenizer_config.json" "sentencepiece.bpe.model" "special_tokens_map.json" \
  --local-dir /models/nllb-tokenizer

huggingface-cli download Systran/faster-whisper-small --local-dir /models/whisper-small

mkdir -p /models/piper
huggingface-cli download rhasspy/piper-voices \
  --include "en/en_US/lessac/medium/*" "es/es_ES/davefx/medium/*" "zh/zh_CN/huayan/medium/*" \
  --local-dir /models/piper-src

find /models/piper-src -name "*.onnx" -exec cp {} /models/piper/ \;
find /models/piper-src -name "*.onnx.json" -exec cp {} /models/piper/ \;
rm -rf /models/piper-src
