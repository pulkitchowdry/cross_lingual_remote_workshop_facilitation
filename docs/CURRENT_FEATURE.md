## Goal

The **Confidence Score** feature aims to improve communication transparency during multilingual conferences by informing participants when speech recognition or translation quality may be unreliable.

Rather than assuming every translation is correct, the application should indicate when the system is uncertain so that misunderstandings can be avoided before they impact the discussion.

The confidence score should help both facilitators and participants identify potential communication issues and provide clear guidance on the appropriate action.

---

# Problem Statement

Real-time translation consists of multiple stages:

```
Speaker Audio
      │
      ▼
Speech Recognition (Transcript)
      │
      ▼
Translation
      │
      ▼
Translated Text
```

A poor translation does not always indicate a translation problem.

Communication quality may degrade because of:

- Poor microphone quality
- Low speaker volume
- Background noise
- Multiple people speaking simultaneously
- Network packet loss
- Speech recognition errors
- Translation uncertainty
- Technical terminology that cannot be translated reliably

The Confidence Score should identify the source of the issue instead of simply reporting that the translation confidence is low.

---

# Objectives

The system should:

- Increase user trust by being transparent about translation quality.
- Prevent misunderstandings before they affect the discussion.
- Help facilitators understand why communication failed.
- Encourage clarification only when necessary.
- Provide actionable feedback instead of generic warnings.

---

# Confidence Score Model

Although the feature is called **Confidence Score**, the overall score should be calculated using multiple confidence signals.

Suggested inputs:

| Signal | Purpose |
|---------|----------|
| Audio Quality | Was the speaker's audio captured clearly? |
| Speech Recognition Confidence | How reliable is the generated transcript? |
| Translation Confidence | How confident is the translation model? |
| Terminology Confidence | Were technical terms translated correctly? |
| Network Quality | Were there transmission issues? |

The application should combine these into a single overall **Confidence Score** while preserving the individual signals for diagnostics.

Example:

```
Confidence Score

93%

High
```

Hover / Details

```
Audio Quality
92%

Speech Recognition
88%

Translation
96%

Terminology
95%

Network
100%
```

---

# Confidence Levels

## High

Communication was reliable.

### User Action

- No action required.

---

## Medium

Some uncertainty exists.

### Recipient Action

Display a clarification option.

Example:

```
⚠ Some content may not have translated correctly.

Request clarification
```

Instead of a generic button, allow users to specify why they are requesting clarification.

Examples:

- I couldn't hear clearly
- Translation seems incorrect
- Could you repeat that?
- Could you explain differently?

This helps the facilitator understand the issue immediately.

---

## Low

Communication is likely inaccurate.

Instead of showing a generic warning, determine the probable root cause and provide actionable guidance.

---

# Root Cause Classification

## Audio Issue

Possible causes

- Speaker too far from microphone
- Background noise
- Low microphone volume
- Network audio degradation

Speaker notification

> We couldn't hear you clearly.

Suggested actions

- Move closer to your microphone.
- Speak louder.
- Reduce background noise.
- Repeat your last sentence.

---

## Speech Recognition Issue

Possible causes

- Fast speech
- Unclear pronunciation
- Multiple speakers talking simultaneously

Speaker notification

> Some words could not be recognised accurately.

Suggested actions

- Speak more slowly.
- Pause between sentences.
- Repeat the sentence.

---

## Translation Issue

Possible causes

- Complex sentence structure
- Ambiguous wording
- Low translation confidence

Speaker notification

> This sentence could not be translated reliably.

Suggested actions

- Rephrase the sentence.
- Use shorter sentences.
- Simplify the wording.

---

## Technical Terminology Issue

Possible causes

- Unknown acronyms
- Domain-specific vocabulary
- Missing glossary entries

Speaker notification

> Some technical terms may not have translated correctly.

Suggested actions

- Expand acronyms.
- Explain specialised terminology.
- Use simpler alternatives where possible.

---

# User Interface

## Recipient

Display the overall Confidence Score.

Example

```
🟢 Confidence Score

Reliable
```

or

```
🟡 Confidence Score

Needs Attention
```

Hovering over the score displays:

- Audio Quality
- Speech Recognition
- Translation
- Terminology
- Network

If confidence is Medium or Low, display a clarification button.

---

## Speaker

When the Confidence Score falls below the configured threshold, display a non-intrusive notification explaining the detected issue.

Examples

```
We couldn't hear you clearly.
```

```
Your sentence may not have translated correctly.
```

```
Please explain the technical term "Webhook".
```

Avoid displaying only:

```
Low Confidence
```

The message should always explain *why*.

---

# Confidence Score Logic

Examples

### Scenario 1

Audio Quality

95%

Translation

96%

Result

```
Confidence Score

High
```

No action required.

---

### Scenario 2

Audio Quality

48%

Translation

98%

Result

```
Confidence Score

Low

Reason:
Audio quality is poor.
```

Speaker receives microphone guidance.

---

### Scenario 3

Audio Quality

98%

Translation

55%

Result

```
Confidence Score

Low

Reason:
Translation uncertainty.
```

Speaker is asked to rephrase.

---

### Scenario 4

Audio Quality

98%

Translation

96%

Terminology

42%

Result

```
Confidence Score

Medium

Reason:
Technical terminology may not translate correctly.
```

Suggest expanding or explaining the terminology.

---

# Post-Meeting Metrics

The meeting summary should include analytics related to communication quality.

Suggested metrics

- Average Confidence Score
- Number of clarification requests
- Number of low-confidence events
- Audio quality issues
- Speech recognition issues
- Translation issues
- Terminology issues
- Average response time to clarification
- Languages with the most clarification requests
- Frequently misunderstood technical terms

Example

```
Communication Summary

Average Confidence Score
94%

Clarification Requests
12

Audio Issues
5

Translation Issues
3

Terminology Issues
4

Most Misunderstood Terms

- Webhook
- API Gateway
- Middleware
```

This enables facilitators to improve future sessions.

---

# Future Enhancements

## Automatic Glossary Expansion

When low terminology confidence is detected, automatically enrich translated content.

Example

Speaker

> The webhook payload is idempotent.

Displayed translation

> The webhook (automatic HTTP callback) payload is idempotent (performing the same request multiple times produces the same result).

This improves participant understanding without interrupting the meeting.

---

# Acceptance Criteria

- [ ] Display an overall Confidence Score for every translated message.
- [ ] Compute the Confidence Score using multiple communication signals.
- [ ] Classify low-confidence events by root cause.
- [ ] Display actionable guidance to speakers based on the detected issue.
- [ ] Allow participants to request clarification with contextual reasons.
- [ ] Show detailed confidence breakdown on hover.
- [ ] Record Confidence Score metrics for post-meeting analytics.
- [ ] Ensure notifications are informative and non-disruptive.
- [ ] Design the scoring system to support future confidence signals without major architectural changes.