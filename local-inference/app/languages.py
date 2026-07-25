"""Language code mapping for this service's three supported languages. Kept in
lock-step with `SupportedLanguage` in the Next.js app's `src/lib/session-contracts.ts`
(en/zh/es) — the app never needs to know the FLORES-200 or Piper voice codes below,
since the HTTP boundary only ever exchanges the app's own en/zh/es codes."""

SUPPORTED = {"en", "zh", "es"}

# NLLB uses FLORES-200 codes, not ISO-639-1.
FLORES_CODE = {
    "en": "eng_Latn",
    "zh": "zho_Hans",
    "es": "spa_Latn",
}

# faster-whisper accepts codes close to ISO-639-1 directly; centralized here
# alongside FLORES_CODE for discoverability even though it's the identity map.
WHISPER_CODE = {
    "en": "en",
    "zh": "zh",
    "es": "es",
}

# One Piper voice per language (rhasspy/piper-voices). Mandarin coverage/naturalness
# is noticeably weaker than the English/Spanish voices — accepted MVP limitation.
PIPER_VOICE = {
    "en": "en_US-lessac-medium",
    "es": "es_ES-davefx-medium",
    "zh": "zh_CN-huayan-medium",
}


def is_supported(language: str) -> bool:
    return language in SUPPORTED
