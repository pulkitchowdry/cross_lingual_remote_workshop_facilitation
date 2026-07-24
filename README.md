# Cross-Lingual Remote Workshop Facilitation

A prototype built for the **"Breaking Language Barriers"** hackathon challenge: help learners and facilitators communicate more clearly across language differences during real-time online/hybrid learning sessions — live speech-to-text, translation, and AI-generated context (progress, decisions, blockers) grounded in the actual discussion.

Our demo scenario: a remote facilitator supporting a hands-on workshop run in a language they don't speak.

See [`docs/problem_statement.md`](docs/problem_statement.md) for the official challenge statement and [`docs/approaches.md`](docs/approaches.md) for the design rationale. Recording the pitch video? See [`docs/PITCH.md`](docs/PITCH.md). For the detailed, privacy-first translation pipeline design (speech translation, captions, TTS, chat/Q&A, provider comparisons), see [`docs/TRANSLATION_ARCHITECTURE.md`](docs/TRANSLATION_ARCHITECTURE.md).

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
- **Real-time transport:** LiveKit + WebSockets
- **Database:** PostgreSQL via Prisma
- **Hosting:** Vercel

## Getting Started

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
   LIVEKIT_URL="http://localhost:7882"
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

6. Apply migrations and generate the Prisma client:

   ```bash
   npx prisma migrate deploy
   npx prisma generate
   ```

7. (Optional) Seed a demo session with a facilitator and a ready learner join link:

   ```bash
   npm run db:seed
   ```

8. Run the dev server:

   ```bash
   npm run dev
   ```

Open [http://localhost:3000](http://localhost:3000) to view the app.

## Testing

- `npm test` — unit tests (Vitest) for session-security tokens, environment validation, and the insight citation guardrail.
- `npm run test:e2e` — Playwright smoke test covering the facilitator create-session flow and the opaque learner join link (starts its own dev server against `DATABASE_URL`; requires a reachable PostgreSQL instance).

## Server-only provider interfaces

`src/lib/providers/` defines typed boundaries so application code never depends on a vendor SDK directly:

- `RoomProvider` (`room.ts`) — LiveKit-backed today; issues short-lived room credentials and pushes DataChannel signals (`notifyCaptionsChanged`).
- `TranslationProvider` (`translation.ts`) — Claude-backed today.
- `SpeechToTextProvider` (`speech-to-text.ts`) — Deepgram Nova-3 adapter once `STT_API_KEY` is set; mock otherwise. Supports one-shot chunk transcription (`transcribeChunk`) and live streaming (`openStream`, used by `/api/captions/stream` and the `agent/` worker) — see `docs/TRANSLATION_ARCHITECTURE.md` Part 2.
- `InsightProvider` (`insight.ts`) — mock (returns no insights) until `INSIGHT_MODEL_API_KEY` is configured; `validateInsightDraft` rejects any insight that cites a transcript segment outside the batch it was derived from, per `docs/PLAN.md`'s evidence-grounding requirement.
- `TextToSpeechProvider` (`text-to-speech.ts`) — ElevenLabs adapter once `TTS_API_KEY` is set; mock (returns no audio) otherwise. Opt-in only — see `docs/TRANSLATION_ARCHITECTURE.md` Part 3.

`agent/` is a standalone LiveKit Agents worker (its own `package.json`, not a dependency of this app) that subscribes to the facilitator's audio track server-side, so captions work without the browser mic control. See `agent/README.md`.

## Screenshots

Full facilitator → learner → facilitator loop; more shots (light mode, polls, glossary before/after, etc.) are in `docs/PITCH.md`.

| Session setup | Facilitator dashboard |
| --- | --- |
| ![Setup](docs/screenshots/setup.png) | ![Facilitator dashboard](docs/screenshots/dashboard.png) |

| Learner view | Session history |
| --- | --- |
| ![Learner view](docs/screenshots/learner.png) | ![History](docs/screenshots/history.png) |

## Project Structure

```
docs/                  Problem statement and brainstorm/validation docs
src/app/                Next.js App Router pages and layouts
```

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Deepgram Docs](https://developers.deepgram.com/)
- [Anthropic (Claude) API Docs](https://docs.anthropic.com/)
