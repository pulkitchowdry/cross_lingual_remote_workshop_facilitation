# Audio Translation Testing

This procedure is for development-only manual checks of the live audio ->
original caption -> translated caption path. It uses opt-in server logs and does
not add analytics or external services.

## Enable Timing Logs

Set this only in local development:

```sh
CAPTION_LATENCY_LOGS=1
```

Start the app with the custom server (`npm run dev` or `docker compose up`), not
plain `next dev`, so the `/api/captions/stream` WebSocket path is available.

Logs look like:

```text
[caption-latency] {
  source: "caption-agent" | "browser-ws" | "typed-facilitator" | "typed-learner",
  requestedTargetLanguages: ["es", "zh"],
  translatedTargetLanguages: ["zh"],
  missingTargetLanguages: ["es"],
  speechToOriginalMs: 1234 | null,
  originalToTranslatedMs: 456,
  originalToPersistedMs: 512
}
```

The log intentionally omits audio bytes, original caption text, and translated
text. Copy the visible captions from the UI into the results table below.

## Manual Procedure

1. Configure `DATABASE_URL`, LiveKit, and either `LOCAL_INFERENCE_URL` +
   `LOCAL_INFERENCE_SECRET` or `STT_API_KEY`.
2. Configure either local inference translation or `CLAUDE_API_KEY`.
3. Start the app with `CAPTION_LATENCY_LOGS=1`.
4. Create and start a session.
5. Join one learner with a different preferred language.
6. Speak one short sentence at a time through the facilitator microphone.
7. Wait for the learner caption to appear.
8. Record the visible original transcription, translated text, and the matching
   `[caption-latency]` values from the server log.
9. Repeat for simple sentences, names, numbers, technical terms, and code-like
   phrases.

Use typed captions only as a translation-baseline check; `speechToOriginalMs`
will be `null` because no audio/STT step exists.

## Results Template

| Field | Result |
| --- | --- |
| Language pair |  |
| Test sentence category |  |
| Expected text |  |
| Original transcription |  |
| Translated text |  |
| Transcription latency (`speechToOriginalMs`) |  |
| Translation latency (`originalToTranslatedMs`) |  |
| Meaning accuracy |  |
| Technical-term accuracy |  |
| Omissions or errors |  |
| Overall usefulness |  |

Suggested rating scale for accuracy/usefulness: 1 = unusable, 3 = understandable
with corrections, 5 = ready to use live.
