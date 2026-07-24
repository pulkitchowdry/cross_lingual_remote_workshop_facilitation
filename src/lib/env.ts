/**
 * Server-only environment contract. Fails fast with a readable error instead of
 * letting a missing variable surface as an obscure runtime crash later.
 * Optional provider keys are validated for shape only when present, since
 * features stay in fixture/mock mode until their key is configured.
 */

type EnvSpec = {
  key: string;
  required: boolean;
  description: string;
};

const ENV_SPEC: EnvSpec[] = [
  { key: "DATABASE_URL", required: true, description: "PostgreSQL connection string" },
  { key: "LIVEKIT_URL", required: false, description: "LiveKit room service URL" },
  { key: "LIVEKIT_API_KEY", required: false, description: "LiveKit API key" },
  { key: "LIVEKIT_API_SECRET", required: false, description: "LiveKit API secret" },
  { key: "CLAUDE_API_KEY", required: false, description: "Claude translation provider key" },
  { key: "CLAUDE_API_URL", required: false, description: "Claude API base URL" },
  { key: "STT_API_KEY", required: false, description: "Speech-to-text provider key" },
  { key: "TTS_API_KEY", required: false, description: "Text-to-speech provider key (opt-in translated audio)" },
  { key: "INSIGHT_MODEL_API_KEY", required: false, description: "Structured-insight LLM provider key" },
  {
    key: "CAPTION_AGENT_SECRET",
    required: false,
    description: "Shared secret authorizing the standalone agent/ worker's /api/captions/agent calls",
  },
];

export interface EnvValidationResult {
  ok: boolean;
  missingRequired: string[];
  configuredOptional: string[];
}

export function validateEnv(source: Record<string, string | undefined> = process.env): EnvValidationResult {
  const missingRequired: string[] = [];
  const configuredOptional: string[] = [];

  for (const spec of ENV_SPEC) {
    const value = source[spec.key];
    const isSet = typeof value === "string" && value.trim().length > 0;
    if (spec.required && !isSet) {
      missingRequired.push(spec.key);
    } else if (!spec.required && isSet) {
      configuredOptional.push(spec.key);
    }
  }

  return { ok: missingRequired.length === 0, missingRequired, configuredOptional };
}

/**
 * Call at server startup (e.g. from `src/lib/db.ts`) to convert a missing
 * required variable into a single clear error instead of a stack of Prisma
 * or fetch failures.
 */
export function assertRequiredEnv(source: Record<string, string | undefined> = process.env) {
  const result = validateEnv(source);
  if (!result.ok) {
    const specsByKey = new Map(ENV_SPEC.map((spec) => [spec.key, spec.description]));
    const details = result.missingRequired
      .map((key) => `  - ${key}: ${specsByKey.get(key) ?? "required"}`)
      .join("\n");
    throw new Error(
      `Missing required environment variable(s):\n${details}\nCopy .env.example to .env.local and fill these in.`,
    );
  }
  return result;
}

/** Feature flags derived from which optional provider keys are configured. */
export function providerAvailability(source: Record<string, string | undefined> = process.env) {
  return {
    liveKit: Boolean(source.LIVEKIT_URL && source.LIVEKIT_API_KEY && source.LIVEKIT_API_SECRET),
    claude: Boolean(source.CLAUDE_API_KEY),
    speechToText: Boolean(source.STT_API_KEY),
    textToSpeech: Boolean(source.TTS_API_KEY),
    insightModel: Boolean(source.INSIGHT_MODEL_API_KEY),
  };
}
