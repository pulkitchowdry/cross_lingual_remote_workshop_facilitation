## Goal

Improve the accuracy and consistency of real-time translation for by introducing a **Centralised Technical Glossary**.

The glossary will provide preferred translations for technical terms, product names, acronyms and organisation-specific terminology, reducing translation errors without impacting real-time performance.

This feature works alongside the **Confidence Score** feature to improve communication quality before translation errors occur.

---

# Problem Statement

General-purpose translation models perform well for conversational language but often struggle with:

- Technical terminology
- Product names
- Internal project names
- Company-specific vocabulary
- Acronyms
- Newly introduced concepts

For example:

```
Webhook
API Gateway
JWT
OAuth
LiveKit
Prisma
MCP
SupportLab AI
```

These terms should either:

- remain untranslated,
- use a preferred translation,
- or include a predefined explanation.

Without a glossary, the same technical term may be translated differently throughout the meeting, reducing consistency and participant understanding.

---

# Objectives

The glossary should:

- Improve translation accuracy for technical terminology.
- Maintain consistent translations across meetings.
- Avoid adding noticeable latency to the translation pipeline.
- Allow facilitators to customise terminology for their organisation.
- Continuously improve through facilitator feedback.

---

# Design Principles

- The glossary should improve translation quality **before** translation errors occur.
- It should not noticeably impact real-time performance.
- The glossary should be shared across all facilitators within the application.
- Facilitators should always remain in control of glossary content.

---

# Built-in Glossary

The application should ship with a predefined glossary containing common technical terminology.

Examples include:

- API
- REST API
- GraphQL
- OAuth
- JWT
- Kubernetes
- Docker
- Git
- GitHub
- PostgreSQL
- Redis
- LiveKit
- Webhook
- API Gateway
- Feature Flag
- CI/CD
- Machine Learning
- Artificial Intelligence
- LLM
- RAG
- MCP

This glossary provides a strong default experience without requiring any setup.

---

# Custom Glossary Upload

Facilitators can upload additional glossary entries before a meeting.

Supported formats:

- CSV
- Excel (.xlsx)

Example Glossary Upload Format



| Source Term | Translate? | Chinese (Simplified) | Spanish | Notes |

|--------------|------------|----------------------|----------|-------|

| Workshop Hub | No | Workshop Hub | Workshop Hub | Product name |

| Customer Success Portal | No | Customer Success Portal | Customer Success Portal | Keep in English |

| Incident Commander | Yes | 事件指挥官 | Comandante del Incidente | Internal role |

| Webhook | No | Webhook | Webhook | Technical term |

| API Gateway | Yes | API 网关 | Puerta de enlace API | Standard translation |

| Feature Flag | Yes | 功能开关 | Bandera de Función | Software development term |

| Sprint | Yes | 冲刺 | Sprint | Agile methodology |

| Pull Request | No | Pull Request | Pull Request | Widely recognised Git term |

| Kubernetes | No | Kubernetes | Kubernetes | Product/technology name |

---

# Centralised Glossary Store

Uploaded glossary entries become part of a **central glossary repository**.

Benefits:

- Available to every facilitator.
- Consistent terminology across meetings.
- Avoids duplicate uploads.
- Improves translation quality over time.

Facilitators should be able to:

- Search glossary terms.
- View glossary entries.
- Edit glossary entries.
- Delete glossary entries.
- Add entries manually.
- Upload entries in bulk - our csv format based on above columns in example

---

# Translation Pipeline

The glossary should be consulted before translation.

```
Speech
    │
    ▼
Speech Recognition
    │
    ▼
Transcript
    │
    ▼
Detect Technical Terms
    │
    ▼
Glossary Lookup
    │
    ▼
Translation
    │
    ▼
Confidence Score
```

The glossary lookup should only occur for candidate technical terms rather than every word.

This keeps the pipeline lightweight while improving translation accuracy.

---

# Performance Considerations

To ensure conversations remain real time:

- Detect likely technical terms first.
- Only query the glossary for detected terms.
- Cache frequently used glossary entries in memory.
- Preload meeting-specific glossary entries when the session starts.
- Keep glossary lookups lightweight using indexed data structures.

The glossary should not noticeably increase translation latency.

---

# Confidence Score Integration

The glossary should integrate with the **Confidence Score** feature.

Examples:

## Glossary Match

The translated technical term matches the preferred glossary entry.

Result

- Higher confidence.

---

## Glossary Mismatch

The translation differs from the preferred glossary.

Result

- Reduce terminology confidence.
- Suggest the preferred glossary translation.
- Surface the issue within the Confidence Score breakdown.

---

## Unknown Technical Term

A technical term is detected but does not exist in the glossary.

Result

- Continue using the normal translation pipeline.
- Record the term for future recommendations.

---

# User Interface

## Glossary Management

Provide a dedicated Glossary page where facilitators can:

- Search terms
- Filter terms
- Upload glossary files
- Add entries manually
- Edit entries
- Delete entries
- View usage statistics

---

## During Meetings

No additional UI should be displayed unless required.

The glossary should operate silently in the background.

Only if a glossary mismatch contributes to a low **Confidence Score** should the facilitator receive an informative notification.

Example

> The preferred glossary translation for "Webhook" differs from the generated translation.

---

# Post-Meeting Recommendations

After each meeting, analyse transcripts and identify technical terms that were:

- Frequently used
- Newly introduced
- Not present in the glossary
- Associated with lower Confidence Scores

Generate recommendations.

Example

```
Suggested Glossary Entries

Webhook

API Gateway

MCP Server

Semantic Search

Knowledge Graph

Prompt Engineering
```

Facilitators can:

- Approve
- Edit
- Ignore

Approved entries are added to the central glossary.

---

# Future Enhancements

## AI Glossary Suggestions

Before a meeting begins:

- Analyse uploaded slides.
- Analyse PDFs.
- Analyse agendas.
- Analyse workshop documents.

Automatically recommend glossary entries before participants join.

---

## Organisation Glossaries

Support multiple glossary scopes:

- Global glossary (built-in)
- Organisation glossary
- Team glossary
- Meeting glossary

The translation engine merges these in priority order during translation.

---

## Glossary Analytics

Display insights such as:

- Most frequently used terms
- Most translated terms
- Terms with the highest correction rate
- Recently added terms
- Languages requiring the most glossary assistance

---

# Acceptance Criteria

- [ ] Ship with a built-in technical glossary.
- [ ] Allow facilitators to upload glossary files (CSV and Excel).
- [ ] Allow manual creation, editing and deletion of glossary entries.
- [ ] Store uploaded glossary entries in a central glossary repository.
- [ ] Make the shared glossary available to all facilitators.
- [ ] Detect candidate technical terms before translation.
- [ ] Use glossary entries to improve translation quality with minimal latency.
- [ ] Integrate glossary usage into the Confidence Score calculation.
- [ ] Record unknown technical terms during meetings.
- [ ] Recommend new glossary entries in the post-meeting summary.
- [ ] Allow facilitators to approve, edit or ignore recommended glossary entries.