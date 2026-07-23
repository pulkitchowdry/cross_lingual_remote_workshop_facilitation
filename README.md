# Cross-Lingual Remote Workshop Facilitation

A prototype built for the **"Breaking Language Barriers"** hackathon challenge: help learners and facilitators communicate more clearly across language differences during real-time online/hybrid learning sessions — live speech-to-text, translation, and AI-generated context (progress, decisions, blockers) grounded in the actual discussion.

Our demo scenario: a remote facilitator supporting a hands-on workshop run in a language they don't speak.

See [`docs/problem_statement.md`](docs/problem_statement.md) for the official challenge statement, our interpretation, target users, and success criteria, and [`docs/approaches.md`](docs/approaches.md) for market validation, the shared pipeline design, and the five candidate approaches under consideration.

Recording the pitch video? See [`docs/PITCH.md`](docs/PITCH.md) for a 5-minute
script, shot list, and the architecture diagram below.

## Architecture

```mermaid
flowchart LR
    subgraph Live[Live session]
        Mic["Facilitator / learner speech"] --> STT["Speech-to-text\n(Deepgram Nova-3, diarized)"]
        STT --> MT["Translation\n(DeepL)"]
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
- **Translation:** DeepL API
- **Understanding/summarization:** Claude API, with prompt caching over the growing transcript
- **Real-time transport:** WebSockets
- **Hosting:** Vercel

## Getting Started

The app uses Prisma with PostgreSQL for session/message storage (see `prisma/schema.prisma`).

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env.local` with a `DATABASE_URL` pointing at a PostgreSQL database, e.g. for a local Postgres instance:

   ```bash
   # create a database and role once:
   psql -h localhost -U postgres -c "CREATE ROLE workshop LOGIN PASSWORD 'workshop';"
   psql -h localhost -U postgres -c "CREATE DATABASE workshop_copilot OWNER workshop;"
   ```

   ```env
   # .env.local
   DATABASE_URL="postgresql://workshop:workshop@localhost:5432/workshop_copilot?schema=public"
   ```

   See `.env.example` for the full list of environment variables (LiveKit, DeepL, etc.).

3. Apply migrations and generate the Prisma client:

   ```bash
   npx prisma migrate deploy
   npx prisma generate
   ```

4. (Optional) Seed a demo session with a facilitator and a ready learner join link:

   ```bash
   npm run db:seed
   ```

5. Run the dev server:

   ```bash
   npm run dev
   ```

Open [http://localhost:3000](http://localhost:3000) to view the app. Edit `src/app/page.tsx` to get started — the page auto-updates as you edit.

## Testing

- `npm test` — unit tests (Vitest) for session-security tokens, environment
  validation, and the insight citation guardrail.
- `npm run test:e2e` — Playwright smoke test covering the facilitator
  create-session flow and the opaque learner join link (starts its own dev
  server against `DATABASE_URL`; requires a reachable PostgreSQL instance).

## Server-only provider interfaces

`src/lib/providers/` and `src/lib/translation.ts` define typed boundaries so
application code never depends on a vendor SDK directly:

- `RoomProvider` (`room.ts`) — LiveKit-backed today; issues short-lived room
  credentials.
- `TranslationProvider` (`translation.ts`) — DeepL-backed today.
- `SpeechToTextProvider` (`speech-to-text.ts`) — mock until `STT_API_KEY` is
  configured and a streaming adapter (e.g. Deepgram/Soniox) is wired in.
- `InsightProvider` (`insight.ts`) — mock (returns no insights) until
  `INSIGHT_MODEL_API_KEY` is configured; `validateInsightDraft` rejects any
  insight that cites a transcript segment outside the batch it was derived
  from, per `docs/PLAN.md`'s evidence-grounding requirement.

## Screenshots

Ten highlights covering the full facilitator → learner → facilitator loop;
the rest of `docs/screenshots/` (light mode, poll/raise-hand pairs, glossary
before/after, etc.) is covered shot-by-shot in `docs/PITCH.md`.

**Session setup**

![Setup](docs/screenshots/setup.png)

**Facilitator learner invitation — QR code + opaque link**

![Facilitator page showing the learner invitation QR code](docs/screenshots/phase0-facilitator-qr.png)

**Facilitator dashboard** — goal, current activity, decisions, and blockers extracted from the live transcript, plus learner questions and a reply box that auto-translates.

![Facilitator dashboard](docs/screenshots/dashboard.png)

**Live caption ticker — facilitator dashboard**

![Live caption ticker, dashboard](docs/screenshots/live-caption-ticker-dashboard.png)

**Learner view** — facilitator messages translated into the learner's language, with the original preserved.

![Learner view](docs/screenshots/learner.png)

**Dashboard with learner questions**

![Dashboard with learner questions](docs/screenshots/dashboard-learner-questions.png)

**Quiet-learner escalation** — the facilitator is nudged when a learner has gone quiet.

![Dashboard quiet-learner escalation](docs/screenshots/dashboard-quiet-escalation.png)

**Technical glossary protection** — code, commands, and named terms survive translation unchanged.

![AI glossary, after protection](docs/screenshots/ai-glossary-after.png)

**Polls** — quick comprehension checks, translated for every learner.

![Dashboard poll](docs/screenshots/dashboard-poll.png)

**Session history** — a grounded catch-up summary for a learner who joined late.

![History](docs/screenshots/history.png)

## Project Structure

```
docs/                  Problem statement and brainstorm/validation docs
src/app/                Next.js App Router pages and layouts
```

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Deepgram Docs](https://developers.deepgram.com/)
- [DeepL API Docs](https://developers.deepl.com/)
