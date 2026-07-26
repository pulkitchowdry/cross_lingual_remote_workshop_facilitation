# Cross-Lingual Remote Workshop Facilitation

A prototype built for the **"Breaking Language Barriers"** hackathon challenge: help learners and facilitators communicate more clearly across language differences during real-time online/hybrid learning sessions — live speech-to-text, translation, and AI-generated context (progress, decisions, blockers) grounded in the actual discussion.

Our demo scenario: a remote facilitator supporting a hands-on workshop run in a language they don't speak.

See [`docs/problem_statement.md`](docs/problem_statement.md) for the official challenge statement and [`docs/approaches.md`](docs/approaches.md) for the design rationale. Recording the pitch video? See the slide deck at [`docs/slides/pitch-slides.pdf`](docs/slides/pitch-slides.pdf). For the detailed, privacy-first translation pipeline design (speech translation, captions, TTS, chat/Q&A, provider comparisons), see [`docs/TRANSLATION_ARCHITECTURE.md`](docs/TRANSLATION_ARCHITECTURE.md). For the facilitator-auth-provider and PostgreSQL-hosting decision, see [`docs/AUTH_DATABASE_ARCHITECTURE.md`](docs/AUTH_DATABASE_ARCHITECTURE.md).

## Architecture

```mermaid
flowchart LR
    subgraph Live[Live session]
        Mic["Facilitator / learner speech"] --> STT["Speech-to-text\n(Deepgram Nova-3, diarized)"]
        STT --> MT["Translation\n(Claude API)"]
    end

    MT --> Captions["Live translated captions\n(learner view)"]
    MT --> Transcript[("Growing transcript\nPostgres")]

    Transcript --> AI["Understanding layer\n(Claude, prompt-cached over transcript)"]
    AI --> Guard{{"validateInsightDraft\nreject ungrounded citations"}}
    Guard --> Dashboard["Facilitator dashboard\ngoal / activity / decisions / blockers"]

    Learner["Learner question"] --> MT
    Dashboard --> Reply["Facilitator reply"] --> MT --> Captions
```

## Tech Stack

- **Frontend:** Next.js (App Router) + TypeScript + Tailwind CSS
- **Speech-to-text:** Deepgram Nova-3 (multi-speaker diarization)
- **Translation & understanding:** Claude API (prompt-cached over the growing transcript)
- **Text-to-speech:** self-hosted Piper (via `local-inference`) first, falling back to ElevenLabs — opt-in
- **Real-time transport:** LiveKit + WebSockets
- **Database:** PostgreSQL via Prisma, hosted on Railway (see [`docs/AUTH_DATABASE_ARCHITECTURE.md`](docs/AUTH_DATABASE_ARCHITECTURE.md))
- **Facilitator authentication:** opaque cookie/token flow (`session-security.ts`) for both facilitator and learner today; migrating the facilitator side to Clerk is a decided-but-not-yet-implemented follow-up (see [`docs/AUTH_DATABASE_ARCHITECTURE.md`](docs/AUTH_DATABASE_ARCHITECTURE.md))
- **Hosting:** Railway

## Getting Started

### Option A: Docker Compose (fastest)

Runs the whole stack — Postgres, a local LiveKit dev server, `local-inference`,
and this app (which also runs the captions worker in-process, see
`src/lib/caption-agent.ts`) — with one command, no local Postgres/LiveKit
install required:

```bash
cp .env.example .env   # optional — fill in real keys, everything else falls back gracefully
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000). See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for what each service needs and how
to run a subset of the stack.

### Option B: Run natively

The app needs four services configured before it runs end to end: **PostgreSQL** (session/message storage), **LiveKit** (real-time audio rooms), **Deepgram** (speech-to-text), and **Claude** (translation + understanding). Everything degrades gracefully — the app runs with only `DATABASE_URL` set, and each feature turns on once its key is added.

1. Install dependencies:

   ```bash
   npm install
   ```

2. **PostgreSQL** — create a local database and role:

   ```bash
   sudo apt update && sudo apt install postgresql postgresql-contrib   # if not already installed
   sudo -u postgres psql -c "CREATE ROLE workshop LOGIN PASSWORD 'workshop';"
   sudo -u postgres psql -c "CREATE DATABASE workshop_copilot OWNER workshop;"
   ```

   Then create `.env.local` (see `.env.example` for the full list of variables):

   ```env
   DATABASE_URL="postgresql://workshop:workshop@localhost:5432/workshop_copilot?schema=public"
   ```

3. **LiveKit** — run a local dev server, then add its credentials to `.env.local`:

   ```bash
   livekit-server --dev
   ```

   ```env
   LIVEKIT_URL="http://localhost:7880"
   LIVEKIT_API_KEY="devkey"
   LIVEKIT_API_SECRET="secret"
   ```

4. **Deepgram** — get an API key from [console.deepgram.com](https://console.deepgram.com/) and add it:

   ```env
   STT_API_KEY="your-deepgram-key"
   ```

5. **Claude** — get an API key from [console.anthropic.com](https://console.anthropic.com/settings/keys) and add it (used for both translation and the facilitator-dashboard insight layer):

   ```env
   CLAUDE_API_KEY="your-claude-key"
   INSIGHT_MODEL_API_KEY="your-claude-key"
   ```

6. **Text-to-speech** (optional — opt-in feature, the app runs fine without it) — either run `local-inference` (see its own README for setup) for self-hosted Piper TTS, or get an ElevenLabs key from [elevenlabs.io/app/settings/api-keys](https://elevenlabs.io/app/settings/api-keys) as a cloud-only/fallback tier:

   ```env
   TTS_API_KEY="your-elevenlabs-key"
   ```

7. Apply migrations and generate the Prisma client:

   ```bash
   npx prisma migrate deploy
   npx prisma generate
   ```

8. (Optional) Seed a demo session with a facilitator and a ready learner join link:

   ```bash
   npm run db:seed
   ```

9. Run the dev server:

   ```bash
   npm run dev
   ```

Open [http://localhost:3000](http://localhost:3000) to view the app.

## Testing

- `npm test` — unit tests (Vitest): session-security tokens, environment validation, the insight citation guardrail + response parsing, accessibility preference validation, retention-deadline math, and the speech-to-text/text-to-speech provider mock/error paths.
- `npm run test:e2e` — Playwright smoke test covering the facilitator create-session flow and the opaque learner join link (starts its own dev server against `DATABASE_URL`; requires a reachable PostgreSQL instance).
- **The mic-streaming live caption path (`/api/captions/stream`, "Start live captions from mic") runs on a custom Node server (`server.ts`, started by `npm run dev`/`npm start`), not plain `next dev`/`next start`.** It handles the WebSocket upgrade itself with `ws`, since Next route handlers can't do a raw upgrade on their own. If you run the app any other way (e.g. `npx next dev` directly), that route will 400 instead of upgrading — the facilitator dashboard's typed-caption box is the fallback for that pipeline. The LiveKit room itself (audio/video, DataChannel captions) and the typed-caption/chat/translation paths don't depend on the custom server.

## Server-only provider interfaces

`src/lib/providers/` defines typed boundaries so application code never depends on a vendor SDK directly:

- `RoomProvider` (`room.ts`) — LiveKit-backed today; issues short-lived room credentials and pushes DataChannel signals (`notifyCaptionsChanged`).
- `TranslationProvider` (`translation.ts`) — Claude-backed today.
- `SpeechToTextProvider` (`speech-to-text.ts`) — Deepgram Nova-3 adapter once `STT_API_KEY` is set; mock otherwise. Supports one-shot chunk transcription (`transcribeChunk`) and live streaming (`openStream`, used by `/api/captions/stream` and the caption agent worker) — see `docs/TRANSLATION_ARCHITECTURE.md` Part 2.
- `InsightProvider` (`insight.ts`) — Claude-backed once `INSIGHT_MODEL_API_KEY` is set (analyzes the recent transcript for ACTIVITY/DECISION/BLOCKER/CONFUSION after each caption, via `waitUntil` so it never blocks the live caption path); returns no insights otherwise. `validateInsightDraft` rejects any insight that cites a transcript segment outside the batch it was derived from, per `docs/PLAN.md`'s evidence-grounding requirement.
- `TextToSpeechProvider` (`text-to-speech.ts`) — tiered like speech-to-text: self-hosted Piper (via `local-inference`) first, falling back to a free-tier-compatible ElevenLabs premade voice once `TTS_API_KEY` is set, mock (returns no audio) if neither is configured. A session's strict-privacy mode disables the cloud fallback (`allowCloudFallback: false`), same as translation/STT. Opt-in only — see `docs/TRANSLATION_ARCHITECTURE.md` Part 3.

`src/lib/caption-agent.ts` is the LiveKit Agents worker that subscribes to the facilitator's audio track server-side, so captions work without the browser mic control. It's registered by `server.ts` and runs in the same process/deploy as the rest of the app (no separate `package.json` or service) — see `docs/TRANSLATION_ARCHITECTURE.md` Part 2.

## Screenshots

Full facilitator → learner → facilitator loop; more shots (light mode, accessibility settings, etc.) are in `docs/screenshots/` and the pitch deck at `docs/slides/pitch-slides.pdf`.

| Session setup | Facilitator dashboard |
| --- | --- |
| ![Setup](docs/screenshots/setup.png) | ![Facilitator dashboard](docs/screenshots/dashboard.png) |

| Learner view | Facilitator dashboard — live, Claude-generated blocker |
| --- | --- |
| ![Learner view](docs/screenshots/learner.png) | ![Live AI-detected blocker](docs/screenshots/uat2/facilitator-live-ai-blocker-real-claude.png) |

| Accessibility settings (font size + high contrast) | Learner view — session ended |
| --- | --- |
| ![Accessibility settings](docs/screenshots/uat2/accessibility-large-text-high-contrast.png) | ![Session ended](docs/screenshots/uat2/learner-session-ended-fixed.png) |

## Project Structure

```
docs/                  Problem statement and brainstorm/validation docs
src/app/                Next.js App Router pages and layouts
```

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Deepgram Docs](https://developers.deepgram.com/)
- [Anthropic (Claude) API Docs](https://docs.anthropic.com/)
