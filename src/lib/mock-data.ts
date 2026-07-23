import type {
  Blocker,
  Decision,
  GlossaryEntry,
  ParticipationSnapshot,
  Poll,
  SessionSummary,
  TranscriptEntry,
} from "./types";

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

export const mockFacilitatorReplies: TranscriptEntry[] = [
  {
    id: "f1",
    speaker: "Facilitator",
    original: "Try checking whether validateEmail() throws when given an empty string.",
    translation: "试着检查一下 validateEmail() 在传入空字符串时是否会抛出异常。",
    confidence: "high",
    hasPreservedSpan: true,
    simplified: {
      original: "Check what happens if you give validateEmail() nothing to check.",
      translation: "检查一下，如果不给 validateEmail() 任何内容，会发生什么。",
    },
  },
  {
    id: "f2",
    speaker: "Facilitator",
    original: "Good catch — wrap that call in a try/catch and log the error to confirm.",
    translation: "发现得好——把那个调用包在 try/catch 里，并记录错误日志来确认。",
    confidence: "high",
    hasPreservedSpan: false,
    simplified: {
      original: "Nice find. Put that line inside a try/catch and print the error to be sure.",
      translation: "找得好。把那一行放进 try/catch，并打印错误信息来确认。",
    },
  },
];

export const mockLiveCaptionFeed: TranscriptEntry[] = [
  mockTranscript[0],
  mockTranscript[1],
  mockFacilitatorReplies[0],
  mockTranscript[2],
  mockFacilitatorReplies[1],
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

export const mockLearnerQuestions: TranscriptEntry[] = [
  {
    id: "q1",
    speaker: "Learner B",
    original: "validateEmail() 是我们自己写的还是用的库？",
    translation: "Is validateEmail() something we wrote, or from a library?",
    confidence: "high",
    hasPreservedSpan: true,
  },
];

export const mockGlossary: GlossaryEntry[] = [
  {
    id: "g1",
    term: "validateEmail()",
    pronunciation: "/ˈvælɪdeɪt iˈmeɪl/",
    definition: "A function that checks whether a given string is a correctly formatted email address.",
    example: "validateEmail(\"\") should return false instead of throwing.",
    translation: "验证邮箱格式是否正确的函数。",
  },
  {
    id: "g2",
    term: "try/catch",
    pronunciation: "/traɪ kætʃ/",
    definition:
      "A block that lets you run code that might fail (try) and handle the failure gracefully (catch) instead of crashing.",
    example: "Wrap the risky call in try/catch so one bad input doesn't take down the whole request.",
    translation: "一种代码结构：先尝试执行可能出错的代码，再捕获并处理错误。",
  },
];

export const mockPoll: Poll = {
  id: "p1",
  question: "Did everyone understand why validateEmail() was throwing?",
  status: "active",
  options: [
    { id: "o1", text: "Yes, makes sense", votes: 7 },
    { id: "o2", text: "Mostly, one detail unclear", votes: 3 },
    { id: "o3", text: "No, still confused", votes: 1 },
  ],
};

export const mockParticipation: ParticipationSnapshot = {
  pollAccuracy: 82,
  translationConfidenceAvg: 88,
  learners: [
    { id: "l1", name: "Learner A", language: "Mandarin", status: "active", participationScore: 91 },
    { id: "l2", name: "Learner B", language: "Mandarin", status: "active", participationScore: 84 },
    {
      id: "l3",
      name: "Learner C",
      language: "Spanish",
      status: "quiet",
      participationScore: 38,
      reminderSent: true,
    },
    { id: "l4", name: "Learner D", language: "Spanish", status: "confused", participationScore: 45 },
    { id: "l5", name: "Learner E", language: "French", status: "active", participationScore: 76 },
    {
      id: "l6",
      name: "Learner F",
      language: "Mandarin",
      status: "quiet",
      participationScore: 29,
      reminderSent: false,
    },
  ],
};

export const mockCurrentLearnerId = "l6";

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
