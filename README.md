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

   Running `local-inference` on its own isn't enough — this app only calls it once
   `LOCAL_INFERENCE_URL`/`LOCAL_INFERENCE_SECRET` are *also* set in `.env.local` (matching
   the secret the service was started with). Without both, `textToSpeechProvider.isConfigured`
   is `false` and the whole "translated audio" feature (and, if `STT_API_KEY` is also unset,
   live speech-to-text) silently doesn't appear anywhere in the UI — which reads as
   "translation is broken" rather than "not configured yet":

   ```env
   LOCAL_INFERENCE_URL="http://localhost:8080"
   LOCAL_INFERENCE_SECRET="devsecret"
   ```

   This also doubles as the self-hosted tier for speech-to-text and translation (Part 5 of
   [`docs/TRANSLATION_ARCHITECTURE.md`](docs/TRANSLATION_ARCHITECTURE.md)) — the same two
   variables turn all three on together.

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

----------------------------------------------------------------------
## How to use?
We can use this application as a facilitator or as a learner. Following are details on how different features can be used,

### How to create a new session?
A facilitator can create a new session from the page - https://xlingo-production.up.railway.app/setup

1. Choose your preferred language
2. Enter details related to the session,
   - Your name       *required
   - Session title   *required
   - Workshop goal   *required
   - Transcript retention (Choose when the data can be deleted for compliance and privacy)
   - Strict privacy mode   - We support self hosted AI models along with third-party services. When enabled all content flows through our self hosted model offering maximum privacy. 
   
   Note - Currently AI summary is not provided when strict privacy mode is enabled.
3. Click on "create session" button.

### As a facilitator how to prepare translation of technical/domain specific terminology?
Once the session is created, you can add/edit/remove technical or domain specific terminology using the "manage glossary" button. This is for improved translation specifically for technical terms or product/company names.

Click on the edit button to choose if a term should be translated or not. If you have a preferred translation then enter the respective text.

### How to invite learners or save link as facilitator?
Bookmark link - This option is for facilitators to join the session.

Learner invitation link - Copy the learner invitation link or scan the QR code to share it with learners on your phone.

*Use the revoke invite link to cancel/stop learners from joining the session.

### How can a learner join a session?
A learner can join a session using an invite link provided by the facilitator. Following is an example of an invite link,
https://xlingo-production.up.railway.app/join/81NGC8VQ4uSQFh5AIFBy5UGiacQz143YdMKItWqfvB4

Once on the page, the learner can perform the below,

1. Choose your preferred language
2. Agree to terms and conditions
3. Click on "Join session" button.

### What are the features offered and how to use them?
Our video conferencing application offers the below features,

   - Translation and captions through audio (Speech-to-Text) and typed content (Text-to-Speech)
   - Share individual video using the camera
   - Raise hand (for learners to let the facilitator know that they have a question)
   - Screen-sharing
   - Whiteboard
   - Controls for facilitator to allow learners to share screen or edit whiteboard
   - Controls for facilitator and learner to choose how captions are displayed
   - Analytics for facilitator
   - Accessibility buttons
   - Theme colors and language selection

Following is a detailed explanation of some of the core features,

   A. Video conferencing controls
   
      Microphone     - Enable/disable your mic to speak
      Video          - Enable/disable your camera
      Raise hand     - To notify facilitator in case of any questions
      Screen-share   - If you want to share a screen like a tab/window/complete screen with other participants
      Whiteboard     - To visually explain concepts or topics to learners and for allowing group activity. More details below.
      Settings       - Enable/disable captions, choose where captions are displayed and if translated and original text captions need to be shown together. Facilitator also has an additional option of allowing participants to share screen/edit whiteboard for group activities.
      Exit           - To leave the session
   
   B. Chat
   
   Message typed in the chat window are translated in real-time and shown to each participant in their respective language. 
   For example - Consider facilitator's language in the app is English while learner's language is Chinese. When the facilitator types a message in English, it is translated in real-time and shown to the learner in Chinese.
   
   Private messaging - We offer private messaging where learners can privately send a message to a facilitator and vice-versa.
   
   Explain simply feature - Learners can click on any message in the chat/caption window and choose to request the facilitator to explain it or share an example. This is to engage learners into asking questions when in doubt.

   Ask anonymously - Some learners may be hesitant in asking questions in public and so we offer a "ask anonymously" button where their name will not be shown to other learners in the session.
   Note - To avoid misuse the name will still be shown to the facilitator.

   C. Captions
   
   Audio is translated in real-time and displayed to participants in their respective language (2-5 seconds delay based on connection). 

   Participants can also type in the captions section and the audio will be played out for the other participants in their respective language.

   Confidence score - We are transparent in how the captions are delivered and display a confidence score which shows a breakdown on audio quality, translation and network quality.
   Note - Network quality is not shown for typed captions.

   Note - Audio translation works best on Chrome and depends on the network quality.

   D. Analytics

   Act now - Our system scans for any questions in the chat/captions section and performs a sentiment analysis. This allows us to detect if the learners are confused about something and immediately displays it to the facilitator.
   
   Confusion trend - Based on the conversation in the session (both chat and caption) our AI system analyzes the confusion trend across different time intervals. This helps the facilitator know if the learners are understanding the concept or confused. It is also like a timeline where the facilitator can know if the learners got confused recently or from the beginning of the session.

   Participation - Facilitator can identify how many learners are actively participating in the session.

   Blockers - Metrics on newly raised, open and closed blockers for the group. This is again based on the sentiment analysis performed on the chat and caption messages.

   Languages - Overall how many translations the system performs in the background for all the languages it supports.

   Note - If a facilitator joins mid-session then they can still see the old captions, chat messages and the analytics

### How to use whiteboard?
Facilitators and learners can create flowcharts, diagrams, etc using whiteboard. The text typed in text boxes or mermaid diagram is translated for every participant in their respective language.

Note - for learners to edit the whiteboard, the facilitator needs to provide access from the settings in meeting controls.


### Can we see a summary of the session and its analytics?
   When a session is ended, a summary and a snapshot of the analytics is offered to the facilitator. It displays the following information,

   A. Session Information
   
      - Goal of the session
      - Number of learners joined
      - Start and end time

   B. AI session summary
   
   Our AI session summary highlights the misunderstood topics, important questions asked by the learners, how did they engage in the session and also suggests improvements for future sessions.

   C. Analytics snapshot
   
   Explained above in the analytics section

### Do we offer accessibility features?
We are level AA as per  Web Content Accessibility Guidelines (WCAG). In the top right corner of the page you can see the below buttons,

   A. "AA"
   
   Use the AA button in the top right corner of the page to increase or decrease the font size of the page. The page layout changes smoothly.

   B. Contrast
   
   Widgets, cards, input fields on the page have proper borders displayed with high contrast.

   C. Themes
   
   We offer themes for all types of users - Warm dusk, Beige, Ink & copper and Slate night. Some of these are for people who prefer light mode while some are for dark mode users.
   
----------------------------------------------------------------------
