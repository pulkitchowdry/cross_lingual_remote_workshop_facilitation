import type { Blocker, Decision, SessionSummary, TranscriptEntry } from "./types";

export const mockGoal =
  "Implement a working REST endpoint for user signup, including input validation.";

export const mockCurrentActivity =
  "Debugging a 500 error thrown when the email field is empty.";

export const mockTranscript: TranscriptEntry[] = [
  {
    id: "t1",
    speaker: "Learner A",
    original: "如果 email 是空的，会报 500 错误。",
    translation: "If the email is empty, it throws a 500 error.",
    confidence: "high",
    hasPreservedSpan: false,
  },
  {
    id: "t2",
    speaker: "Learner B",
    original: "我们试着加了 if (!req.body.email) return res.status(400)，但还是报错。",
    translation:
      "We tried adding if (!req.body.email) return res.status(400), but it still errors.",
    confidence: "medium",
    hasPreservedSpan: true,
  },
  {
    id: "t3",
    speaker: "Learner A",
    original: "可能是 validateEmail() 函数本身抛出了异常。",
    translation: "It might be that the validateEmail() function itself is throwing.",
    confidence: "low",
    hasPreservedSpan: true,
  },
];

export const mockDecisions: Decision[] = [
  {
    id: "d1",
    summary: "Added an early return for a missing email field.",
    quoteId: "t2",
  },
];

export const mockBlockers: Blocker[] = [
  {
    id: "b1",
    summary: "Unclear whether validateEmail() throws on empty input.",
    quoteId: "t3",
  },
];

export const mockHistory: SessionSummary[] = [
  {
    id: "h1",
    timestamp: "10:02 AM",
    activity: "Setting up the Express route and request body parsing.",
    decisions: ["Use express.json() middleware for body parsing."],
    blockers: [],
  },
  {
    id: "h2",
    timestamp: "10:14 AM",
    activity: "Debugging a 500 error thrown when the email field is empty.",
    decisions: ["Added an early return for a missing email field."],
    blockers: ["Unclear whether validateEmail() throws on empty input."],
  },
];
