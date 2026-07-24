# Breaking Language Barriers in Online & Hybrid Learning

## Solution Design Document

> **Delivered vs. planned.** This document is the full solution-design brainstorm and predates several implementation
> decisions — it does not reflect what currently ships. The actual prototype (see the root `README.md` for its real
> architecture and provider list) implements: live multilingual captions, real-time speech translation, multilingual
> chat with question-flagging, the evidence-backed intervention queue (Module 3, now backed by a real Claude call —
> see `src/lib/providers/insight.ts`), an accessibility settings panel (font size + high contrast), and enforced
> transcript retention. Several modules below — session glossary upload, simplify-explanation, AI glossary, live
> polls, quiet-participant detection, AI raise-hand suggestion, live whiteboard translation, off-track group
> detection, sign-language avatar, on-device processing — were either built and later removed during the "one working
> session flow" simplification (see commit `31cc243`) or were never implemented; treat everything below as design
> intent, not a feature inventory of the current app.

# High-Level System Flow

```
                  Facilitator / Learner Speech
                              │
                              ▼
                     Speech-to-Text Engine
                              │
                              ▼
                    Translation Engine
                              │
               ┌──────────────┴──────────────┐
               ▼                             ▼
      Live Captions                  Translated Audio
               │
               ▼
          AI Understanding Layer
               │
      ┌────────┼────────┬───────────┬
      ▼        ▼        ▼           ▼
  Glossary  Simplify  Confusion   Poll Generator
              Text    Detection
      │
      ▼
 Facilitator Dashboard
      │
      ▼
 Group Analytics & Session Insights
```

---

# Product Modules

## Module 1 — Understand

### Goal

Allow every learner to understand the facilitator regardless of language.

---

### Live Multilingual Captions

**Problem**

Learners cannot understand spoken explanations.

**Solution**

Generate live captions translated into each learner's preferred language.

**Benefits**

* Immediate understanding
* No interruption to teaching
* Supports multiple languages simultaneously

---

### Real-Time Speech Translation

**Problem**

Listening to an unfamiliar language slows learning.

**Solution**

Translate facilitator speech into text or synthesized audio.

**Benefits**

* Learners hear explanations naturally
* Reduces cognitive load
* Supports multilingual classrooms

---

### Session Glossary

**Problem**

Technical terminology is translated inconsistently.

**Solution**

Facilitator uploads slides, PDFs, or notes before class.

The system extracts:

* technical terms
* abbreviations
* domain-specific vocabulary

These terms are prioritized during translation.

**Benefits**

* Better translation quality
* Consistent terminology
* Improved understanding

---

### Simplify Explanation

**Problem**

Even after translation, explanations may still be difficult.

**Solution**

One-click AI simplification rewrites explanations into simpler language before retranslation.

Example

Original

> "The compiler performs lexical analysis."

Simplified

> "The compiler first breaks your program into small words before understanding it."

---

### AI Glossary

When learners encounter unfamiliar words they can instantly view:

* definition
* pronunciation
* examples
* translation

without leaving the session.

---

# Module 2 — Participate

## Goal

Help every learner confidently participate.

---

### Multilingual Chat

Messages are automatically translated for every recipient.

Each participant can write naturally in their own language.

---

### Multilingual Q&A

Learners ask questions in their preferred language.

The facilitator receives translated questions.

Responses are translated back automatically.

---

### Live Comprehension Polls

The AI can automatically generate polls such as:

* Did everyone understand?
* Which answer is correct?
* Rate your confidence.

Results appear instantly on the facilitator dashboard.

---

### Quiet Participant Detection

The system detects learners who have:

* not spoken
* not answered polls
* not sent messages

Instead of alerting the facilitator immediately, the learner first receives a gentle reminder encouraging participation.

---

### AI Raise-Hand Suggestion (Wow Feature)

If repeated confusion is detected, the system suggests:

> Would you like to ask the facilitator?

One click submits a translated question.

---

# Module 3 — Assist the Facilitator

## Goal

Provide real-time classroom awareness.

---

### Confusion Detection

The system continuously analyses:

* incorrect responses
* hesitation
* repeated clarification requests
* long pauses
* low-confidence translations

Possible indicators include:

* multiple learners asking similar questions
* repeated requests for clarification
* inconsistent answers in polls
* unusual drops in participation

The dashboard highlights learners who may need assistance.

---

### Translation Confidence Indicator

Every translation receives a confidence score.

Example

```
Translation Confidence

98% ✓

82% ⚠

65% ❗
```

Low-confidence translations notify the facilitator.

---

### Participation Dashboard

Displays

* active learners
* quiet learners
* confused learners
* language distribution
* poll accuracy
* participation score
* translation confidence

This provides a live overview of classroom engagement.

---

### AI Session Summary

At the end of the session the facilitator receives:

* important questions
* misunderstood topics
* participation statistics
* suggested improvements

---

# Module 4 — Collaborate

## Goal

Enable multilingual teamwork.

---

### Live Whiteboard Translation

Learners write on a shared whiteboard.

Text automatically appears in each learner's preferred language.

Everyone collaborates on the same canvas.

---

### Off-Track Group Detection

During breakout rooms the AI monitors conversation.

Indicators include:

* long silence
* unrelated discussion
* repeated confusion
* no progress

The facilitator receives a notification.

---

### AI Discussion Assistant

When groups become stuck, the AI suggests:

* discussion starters
* clarification questions
* next steps

without solving the task for them.

---

# Module 5 — Accessibility

Designed for inclusive learning.

Features include:

* Screen-reader compatible captions
* Adjustable font size
* High contrast mode
* Keyboard navigation
* Sign-language avatar
* Caption positioning
* Audio-only mode

---

# Module 6 — Privacy

Privacy is considered throughout the session.

Features include:

* Optional on-device speech recognition
* Optional on-device translation
* Edge processing where possible
* Automatic deletion after session
* User-controlled recording permissions
* No permanent storage unless enabled

---

# User Journey

## Before Session

Facilitator

* Creates session
* Uploads learning material
* Session glossary generated
* Chooses supported languages
* Starts session

Learner

* Joins session
* Chooses preferred language
* Enables accessibility preferences

---

## During Session

### Facilitator

1. Speaks normally.

2. Live captions appear.

3. Translation delivered to learners.

4. Dashboard monitors understanding.

5. Receives confusion alerts.

6. Simplifies explanation when needed.

7. Launches comprehension poll.

8. Monitors breakout rooms.

9. Receives notifications for struggling groups.

---

### Learner

1. Watches translated captions.

2. Listens to translated audio.

3. Uses glossary when needed.

4. Chats naturally.

5. Asks questions in own language.

6. Receives translated responses.

7. Participates in polls.

8. Collaborates on translated whiteboard.

9. Receives participation reminders if inactive.

---

## After Session

Facilitator

Receives

* participation report
* common misunderstandings
* AI summary
* poll statistics

Learner

Receives

* translated notes
* personal vocabulary list
* key concepts
* optional AI summary

Data is deleted according to privacy settings.

---

# Technical Architecture

| Component              | Suggested Technology              |
| ---------------------- | --------------------------------- |
| Video conferencing     | LiveKit                           |
| Speech-to-text (local) | faster-whisper / whisper.cpp      |
| Speech-to-text (cloud) | OpenAI Realtime API, Soniox       |
| Translation (cloud)    | OpenAI Realtime API               |
| Translation (local)    | Argos Translate                   |
| AI Understanding Layer | GPT-4.1 / Claude                  |
| Whiteboard             | Excalidraw                        |
| Dashboard              | React + Recharts                  |
| Backend                | Node.js / Python                  |
| Database               | PostgreSQL / SQLite               |
| Authentication         | Clerk / Auth.js                   |
| Deployment             | Docker + Railway / Render / Azure |

---

# 7. MVP Roadmap

## Phase 1 (Core Prototype)

* Live multilingual captions
* Speech translation
* Multilingual chat
* Q&A translation
* Session glossary
* Privacy controls

Deliverable:
A complete multilingual classroom experience.

---

## Phase 2

* Facilitator dashboard
* Comprehension detection
* Simplify explanations
* Live polls
* Translation confidence

Deliverable:
AI-assisted facilitation.

---

## Phase 3

* Whiteboard translation
* Group monitoring
* Participation analytics
* Accessibility improvements

Deliverable:
Multilingual collaboration.

---

## Phase 4 (Innovation)

* AI session summaries
* Replay last explanation
* Personal vocabulary builder
* AI discussion assistant
* AI raise-hand suggestions

Deliverable:
An intelligent learning companion beyond basic translation.

---

# Future Enhancements

Potential extensions beyond the prototype include:

* Real-time translation of shared slides and screen content using OCR.
* Automatic translation overlays for digital whiteboards (e.g., Miro, Figma).
* Personalized learning recommendations based on comprehension history.
* Integration with Learning Management Systems (Canvas, Moodle, Blackboard).
* Offline-first mode for low-connectivity environments.
* Voice cloning for translated speech while preserving speaker identity.
* Support for additional languages and domain-specific translation models.

---

# Success Metrics

The solution will be evaluated based on measurable outcomes:

| Goal                   | Example Metric                                                         |
| ---------------------- | ---------------------------------------------------------------------- |
| Improve understanding  | Higher comprehension poll scores                                       |
| Increase participation | More questions, chat messages, and poll responses                      |
| Better collaboration   | Increased group activity and reduced off-track alerts                  |
| Translation quality    | Higher AI confidence scores and fewer clarification requests           |
| Accessibility          | Successful use of captions, screen readers, and accessibility features |
| Performance            | Low translation latency suitable for live conversations                |
| Privacy                | Compliance with session data retention preferences                     |

---

