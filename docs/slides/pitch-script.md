# Pitch video script — hackathon style

Filming format: each presenter stands in front of the camera with the slide
(or a live demo) projected/displayed behind them, and delivers their own
segment. `pitch-slides.html` now carries only a title and a one-line caption
per slide — the full talking points live here so the slides stay a visual
backdrop, not a teleprompter.

Handoff cue: end your segment by saying the next presenter's name so the
camera/scene switch has a clean audio cue.

## Presenter 1 — Problem & approach (0:00–1:00), slide 1/5

- Workshops run across languages every day.
- When facilitator and learner don't share one, a lost learner stays quiet.
- By the time anyone notices, the moment to help is gone.
- We capture speech, translate it live, and have Claude track the goal,
  decisions, and blockers from the transcript — every insight linked back
  to the exact line it came from.
- *(gesture at the pipeline diagram behind you, then hand off)*

## Presenter 2 — Facilitator dashboard (1:00–1:45), slide 2/5, live demo

- The goal comes from setup. Nothing else.
- Decision and blocker cards? No one typed them.
- Claude pulls them live from the transcript — and cites the line, or
  rejects itself.

## Presenter 3 — Learner join & Q&A (1:45–3:00), slide 3/5, live demo

- Scan a QR code. No account, no setup.
- Captions translate in real time — original still visible underneath.
- A question arrives already translated. The reply translates back.
- Every screen, every button — fully localized.

## Presenter 4 — Accuracy, accessibility, privacy (3:00–4:15), slide 4/5, live demo

- The brief asks for speed, accuracy, accessibility, privacy — not just a demo.
- Every caption carries a confidence score. Shaky translations get flagged,
  not trusted blindly.
- Text size, high contrast, light or dark — every screen, every session.
- Languages and retention are set up front. Audio is never recorded by default.

## Presenter 5 — Why it matters & close (4:15–5:00), slide 5/5

- **Impact:** a quiet learner used to be invisible; now it's a card on the
  dashboard, translated round-trip, in a session that ships fully localized
  end to end.
- **Prototype quality:** real Postgres sessions, role-scoped join tokens,
  accessibility and i18n baked in from setup through Q&A — not a slide.
- **Feasibility:** a citation guardrail (`validateInsightDraft`) on top of
  Deepgram and Claude — APIs we can call today.
- Thank you — live translation plus grounded understanding, so no one gets
  left behind in their own workshop.

## Filming notes

- One continuous shot per segment: presenter framed roughly waist-up, slide
  or live demo filling the screen/wall behind them.
- Keep the same camera position and slide-screen size across segments so
  cuts between presenters feel like one video, not five.
- For the live-demo segments (2–4), the "slide" behind the presenter is the
  actual running app, not the static HTML slide — cue the demo before you
  start talking.
