import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/session-contracts";
import type { ContrastMode, FontSize } from "@/lib/accessibility-preferences";
import type { ThemeName } from "@/lib/theme-preferences";

/**
 * Full interface-chrome dictionary (not just live caption/chat content, which is already
 * translated at runtime by the Claude translation provider). Keyed by the same
 * `SupportedLanguage` used for session/participant language everywhere else, so a page that
 * already knows its facilitator's or learner's language can localize its own static text with
 * no extra state. Third-party LiveKit `ControlBar`/`ParticipantTile` labels (Microphone, Camera,
 * Share screen, Leave) are outside this dictionary — the pinned `@livekit/components-react`
 * version has no localization API, so those remain English.
 */
export interface Dictionary {
  shell: {
    newSession: string;
    skipToContent: string;
    interfaceLanguage: string;
    language: string;
  };
  a11y: {
    fontSizeLabel: Record<FontSize, string>;
    textSizeAriaLabel: (label: string) => string;
    contrastLabel: string;
    contrastAriaLabel: (mode: ContrastMode) => string;
    contrastOn: string;
    contrastOff: string;
    themeNames: Record<ThemeName, string>;
    themeAriaLabel: (nextLabel: string) => string;
  };
  languageNames: Record<SupportedLanguage, string>;
  setup: {
    heading: string;
    subtitle: string;
    yourName: string;
    yourNamePlaceholder: string;
    sessionTitle: string;
    sessionTitlePlaceholder: string;
    workshopGoal: string;
    workshopGoalPlaceholder: string;
    retention: string;
    retentionMinutes: string;
    retentionHour: string;
    retentionDay: string;
    retentionWeek: string;
    retentionMonth: string;
    privacyNote: string;
    strictPrivacyLabel: string;
    strictPrivacyHint: string;
    submit: string;
  };
  join: {
    invitedTo: string;
    subtitle: string;
    yourName: string;
    consent: string;
    submit: string;
    submitting: string;
  };
  facilitator: {
    statusDraft: string;
    statusLive: string;
    statusEnded: string;
    startSession: string;
    endSession: string;
    confirmEndSessionTitle: string;
    confirmEndSessionBody: string;
    logOut: string;
    learnersJoinedCard: string;
    learnersJoinedHint: string;
    workshopRoom: string;
    liveAudioVideo: string;
    micCameraHint: string;
    captionLabel: string;
    captionPlaceholder: string;
    captionAudioHint: string;
    publish: string;
    publishing: string;
    actNow: string;
    blocker: string;
    confusion: string;
    confusionLevelSome: (count: number) => string;
    confusionLevelHigh: (count: number) => string;
    resolveBlocker: string;
    noInterventionYet: string;
    noInterventionHintOnTrack: string;
    waitingToStart: string;
    noInterventionHintWaiting: string;
    insightsNotConfigured: string;
    languageChangeLiveWarning: string;
    liveTranscript: string;
    transcriptEmpty: string;
    currentLesson: string;
    activity: string;
    decision: string;
    noRecentActivity: string;
    learnerInvitation: string;
    shareLink: string;
    linkRevokedMsg: string;
    learnerLinkAriaLabel: string;
    copyLink: string;
    linkCopied: string;
    copyFailed: string;
    revokeInvite: string;
    confirmRevokeInviteTitle: string;
    confirmRevokeInviteBody: string;
    linkMissingMsg: string;
    qrAlt: string;
    sessionEndedHeading: string;
    sessionEndedSummary: string;
    /** The one-shot, end-of-session AI narrative (Session.summary — see insights.ts's
     * generateAndPersistSessionSummary) is plain text, not structured data — these three
     * cover its only three render states: not yet generated (still LIVE-adjacent),
     * generated, or never available (no INSIGHT_MODEL_API_KEY / generation failed). */
    sessionSummaryHeading: string;
    sessionSummaryPending: string;
    sessionSummaryUnavailable: string;
    /** Deterministic participation stats shown above the AI narrative — computed
     * synchronously from already-fetched data, so they render immediately even while
     * session.summary is still pending or unconfigured. */
    sessionSummaryDuration: (minutes: number) => string;
    sessionSummaryMessages: string;
    sessionSummaryQuestions: string;
    sessionSummaryMisunderstoodTopics: string;
  };
  learner: {
    welcome: (name: string) => string;
    subtitle: string;
    preferencesCard: string;
    preferredLanguageLabel: string;
    captionsWillAppear: string;
    playTranslatedAudio: string;
    typedCaptionsAlwaysAudible: string;
    audioBlocked: string;
    audioSkipped: string;
    captionComposerLabel: string;
    captionComposerPlaceholder: string;
    captionAudioHint: string;
    publish: string;
    publishing: string;
    explainSimply: string;
    giveExample: string;
    explainSimplyQuestion: (caption: string) => string;
    giveExampleQuestion: (caption: string) => string;
    sessionEndedHeading: string;
    sessionEndedSummary: string;
  };
  chat: {
    noMessages: string;
    question: string;
    sendMessageLabel: string;
    placeholder: string;
    flagQuestion: string;
    askAnonymously: string;
    anonymousLearner: string;
    anonymousBadge: string;
    privateBadge: string;
    messageFacilitatorPrivately: string;
    publicMode: string;
    privateModeToFacilitator: string;
    privateModeTo: (name: string) => string;
    returnToPublic: string;
    recipientLabel: string;
    everyone: string;
    replyPrivately: string;
    send: string;
    sending: string;
  };
  captions: {
    start: string;
    stop: string;
    agentCapturing: string;
    connectionFailed: string;
    connectionBlocked: string;
    sttError: string;
    micRecordingFailed: string;
    micDenied: string;
  };
  room: {
    connecting: string;
    unableToJoin: string;
    toggleMicrophone: string;
    toggleCamera: string;
    toggleScreenShare: string;
    selectMicrophone: string;
    selectCamera: string;
    leaveCall: string;
    toggleCaptions: string;
    screenShareInterrupted: string;
    disconnectedDuplicate: string;
    disconnectedOther: string;
    mediaDeviceError: string;
    cameraUnavailable: string;
    microphoneUnavailable: string;
    rejoin: string;
  };
  meeting: {
    raisedHandTitle: (name: string) => string;
    connectionQualityTitle: (quality: string) => string;
    toolbarLabel: string;
    muteMic: string;
    unmuteMic: string;
    stopCamera: string;
    startCamera: string;
    lowerHand: string;
    raiseHand: string;
    raiseHandFailed: string;
    stopShareScreen: string;
    shareScreen: string;
    presentingLocked: string;
    switchToVideo: string;
    switchToWhiteboard: string;
    settings: string;
    showCaptions: string;
    captionContentLabel: string;
    captionModeBoth: string;
    captionModeTranslatedOnly: string;
    captionPositionLabel: string;
    captionPositionBottom: string;
    captionPositionTop: string;
    allowLearnerPresenting: string;
    leave: string;
    expandSidebar: string;
    resizeSidebar: string;
    collapseSidebar: string;
    chatLabel: string;
    shrinkCaptionFont: string;
    growCaptionFont: string;
    whiteboardLoading: string;
    pictureInPicture: string;
    copyInviteLink: string;
    linkCopied: string;
  };
  common: {
    speaker: string;
    translationUnavailable: string;
    liveNowTitle: string;
    liveNowHint: string;
    joinLiveSession: string;
    confirm: string;
    cancel: string;
    jumpToLatest: string;
    chatTab: string;
    captionsTab: string;
  };
  notFound: {
    title: string;
    message: string;
    cta: string;
  };
  error: {
    title: string;
    message: string;
    retry: string;
  };
}

const en: Dictionary = {
  shell: { newSession: "New session", skipToContent: "Skip to main content", interfaceLanguage: "Interface language", language: "Language" },
  a11y: {
    fontSizeLabel: { normal: "Normal text", large: "Large text", "x-large": "Extra-large text" },
    textSizeAriaLabel: (label) => `Aa. Text size: ${label}. Activate to change.`,
    contrastLabel: "Contrast",
    contrastAriaLabel: (mode) => `High contrast mode: ${mode === "high" ? "on" : "off"}. Activate to toggle.`,
    contrastOn: "on",
    contrastOff: "off",
    themeNames: { beige: "Beige", "ink-copper": "Ink & Copper", "slate-night": "Slate Night", "warm-dusk": "Warm Dusk" },
    themeAriaLabel: (next) => `Switch to ${next} theme`,
  },
  languageNames: { en: "English", zh: "Chinese", es: "Spanish" },
  setup: {
    heading: "Session setup",
    subtitle:
      "Set the workshop goal once, before the session starts. The dashboard uses this to judge whether the group's discussion is on track.",
    yourName: "Your name",
    yourNamePlaceholder: "e.g. Priya, workshop facilitator",
    sessionTitle: "Session title",
    sessionTitlePlaceholder: "e.g. REST endpoint workshop",
    workshopGoal: "Workshop goal",
    workshopGoalPlaceholder: "e.g. Implement a working REST endpoint for user signup, including input validation.",
    retention: "Transcript retention",
    retentionMinutes: "Delete after 5 minutes (testing)",
    retentionHour: "Delete after 1 hour",
    retentionDay: "Delete after 1 day",
    retentionWeek: "Delete after 7 days",
    retentionMonth: "Delete after 30 days",
    privacyNote: "You'll receive a private learner link after creating the session. Live audio is not recorded by default.",
    strictPrivacyLabel: "Strict privacy mode",
    strictPrivacyHint:
      "Keeps audio and text on this server — nothing goes to Claude or another cloud provider. Needs local-inference configured, or captions and translation stay unavailable all session.",
    submit: "Create session",
  },
  join: {
    invitedTo: "You're invited to learn",
    subtitle: "Choose how you'd like to follow the session. Your preferred language controls translated captions and replies.",
    yourName: "Your name",
    consent:
      "I agree to speech and text being processed for live captions, translation, and facilitator support. Raw audio isn't stored by default. My camera and mic join live as soon as I enter — mic starts muted, camera can be turned off anytime.",
    submit: "Join session",
    submitting: "Joining…",
  },
  facilitator: {
    statusDraft: "draft",
    statusLive: "live",
    statusEnded: "ended",
    startSession: "Start session",
    endSession: "End session",
    confirmEndSessionTitle: "End this session?",
    confirmEndSessionBody: "Learners will be disconnected and captions will stop. This can't be undone.",
    logOut: "Log out",
    learnersJoinedCard: "Learners joined",
    learnersJoinedHint: "Learners have completed consent and joined.",
    workshopRoom: "Workshop room",
    liveAudioVideo: "Live audio and video",
    micCameraHint: "Your camera joins live; your microphone starts muted — click the microphone icon below to turn it on.",
    captionLabel: "Type a caption for learners",
    captionPlaceholder: "Type a caption for learners in their selected language…",
    captionAudioHint: "Read aloud to every learner in their language, even if they haven't turned on translated audio.",
    publish: "Publish",
    publishing: "Publishing…",
    actNow: "Act now",
    blocker: "Blocker",
    confusion: "Possible confusion",
    confusionLevelSome: (count) => `Some confusion (${count})`,
    confusionLevelHigh: (count) => `High confusion (${count})`,
    resolveBlocker: "Mark resolved",
    noInterventionYet: "No intervention needed yet",
    noInterventionHintOnTrack: "The group's discussion looks on track — no blockers or confusion detected yet.",
    waitingToStart: "Waiting to begin",
    noInterventionHintWaiting: "Nothing to analyze yet — this updates once the discussion starts.",
    insightsNotConfigured: "Automatic insight detection isn't configured for this session — nothing here is analyzed. Use the typed caption/chat tools to follow along manually.",
    languageChangeLiveWarning: "Changing language while captions are running won't restart the live speech recognition — stop and restart captions to fully apply it.",
    liveTranscript: "Live transcript",
    transcriptEmpty: "Captions will arrive here when the session is live.",
    currentLesson: "Current lesson",
    activity: "Activity",
    decision: "Decision",
    noRecentActivity: "No activity or decisions noted yet.",
    learnerInvitation: "Learner invitation",
    shareLink: "Share this private link",
    linkRevokedMsg: "This invite link has been revoked and no longer works. Create a new session to invite learners again.",
    learnerLinkAriaLabel: "Learner invitation link",
    copyLink: "Copy link",
    linkCopied: "Copied!",
    copyFailed: "Couldn't copy the link. Select and copy it manually instead.",
    revokeInvite: "Revoke invite link",
    confirmRevokeInviteTitle: "Revoke this invite link?",
    confirmRevokeInviteBody: "Anyone who hasn't joined yet will no longer be able to use this link.",
    linkMissingMsg: "This browser no longer has the original learner link. Create a replacement invitation before sharing the session.",
    qrAlt: "QR code for the learner invitation link",
    sessionEndedHeading: "Session transcript",
    sessionEndedSummary: "This session has ended. The video room is closed, but the full transcript and chat history below remain available until the session's retention period expires.",
    sessionSummaryHeading: "AI session summary",
    sessionSummaryPending: "Generating a summary of this session…",
    sessionSummaryUnavailable: "No AI summary is available for this session.",
    sessionSummaryDuration: (minutes) => `${minutes} min`,
    sessionSummaryMessages: "Messages",
    sessionSummaryQuestions: "Questions",
    sessionSummaryMisunderstoodTopics: "Misunderstood topics",
  },
  learner: {
    welcome: (name) => `Welcome, ${name}`,
    subtitle: "Your captions and facilitator replies will appear in your selected language.",
    preferencesCard: "Your learning preferences",
    preferredLanguageLabel: "Preferred language:",
    captionsWillAppear: "Captions will appear here as soon as the facilitator starts speaking.",
    playTranslatedAudio: "Play translated audio for new captions",
    typedCaptionsAlwaysAudible: "The facilitator's typed captions are always read aloud, even if this is off.",
    audioBlocked: "Translated audio playback was blocked by the browser.",
    audioSkipped: "Some translated audio couldn't be loaded and was skipped.",
    captionComposerLabel: "Type a caption for everyone",
    captionComposerPlaceholder: "Type something to be read aloud to everyone…",
    captionAudioHint: "Read aloud to everyone in their language, even if they haven't turned on translated audio — useful if you can't speak.",
    publish: "Publish",
    publishing: "Publishing…",
    explainSimply: "Explain simply",
    giveExample: "Give an example",
    explainSimplyQuestion: (caption) => `Please explain this simply: "${caption}"`,
    giveExampleQuestion: (caption) => `Please give an example for this: "${caption}"`,
    sessionEndedHeading: "This session has ended",
    sessionEndedSummary: "The facilitator ended this session. You can still review the transcript and chat history below until it's automatically deleted per this session's retention setting.",
  },
  chat: {
    noMessages: "No messages yet. Say hello or ask for help.",
    question: "Question",
    sendMessageLabel: "Send a message",
    placeholder: "Write in your own language…",
    flagQuestion: "Flag as a question for the facilitator",
    askAnonymously: "Ask anonymously",
    anonymousLearner: "Anonymous learner",
    anonymousBadge: "Anonymous",
    privateBadge: "Private",
    messageFacilitatorPrivately: "Message facilitator privately",
    publicMode: "Public chat",
    privateModeToFacilitator: "Private to facilitator",
    privateModeTo: (name) => `Private to ${name}`,
    returnToPublic: "Return to public",
    recipientLabel: "Send to",
    everyone: "Everyone",
    replyPrivately: "Reply privately",
    send: "Send",
    sending: "Sending…",
  },
  captions: {
    start: "Start live captions from mic",
    stop: "Stop live captions",
    agentCapturing: "Live captions are already running from your mic",
    connectionFailed:
      "Live captions disconnected. Unmute your mic in the video room instead — captions start automatically. Or use the typed caption box above.",
    connectionBlocked:
      "Live captions couldn't connect. Unmute your mic in the video room instead — captions start automatically. Or use the typed caption box above.",
    sttError: "Speech-to-text error.",
    micRecordingFailed: "Microphone recording failed.",
    micDenied: "Microphone access was denied or unavailable.",
  },
  room: {
    connecting: "Connecting your secure audio/video room…",
    unableToJoin: "Unable to join the media room.",
    toggleMicrophone: "Toggle microphone",
    toggleCamera: "Toggle camera",
    toggleScreenShare: "Toggle screen share",
    selectMicrophone: "Select microphone",
    selectCamera: "Select camera",
    leaveCall: "Leave call",
    toggleCaptions: "Toggle captions",
    screenShareInterrupted: "Your screen share was interrupted by a reconnect — click Share screen again to resume.",
    disconnectedDuplicate: "You've been disconnected because this link was opened in another tab or window at the same time.",
    disconnectedOther: "You've been disconnected from the media room.",
    mediaDeviceError: "There was a problem with your microphone or camera.",
    cameraUnavailable: "Your camera isn't available (permission denied, in use elsewhere, or not found) — continuing without it. You can still join with audio.",
    microphoneUnavailable: "Your microphone isn't available (permission denied, in use elsewhere, or not found) — continuing without it.",
    rejoin: "Rejoin",
  },
  meeting: {
    raisedHandTitle: (name) => `${name} raised their hand`,
    connectionQualityTitle: (quality) => `Connection: ${quality}`,
    toolbarLabel: "Meeting controls",
    muteMic: "Mute microphone",
    unmuteMic: "Unmute microphone",
    stopCamera: "Turn off camera",
    startCamera: "Turn on camera",
    lowerHand: "Lower hand",
    raiseHand: "Raise hand",
    raiseHandFailed: "Couldn't raise hand — check your connection and try again",
    stopShareScreen: "Stop sharing screen",
    shareScreen: "Share screen",
    presentingLocked: "The facilitator hasn't turned this on for participants yet",
    switchToVideo: "Switch to video",
    switchToWhiteboard: "Switch to whiteboard",
    settings: "Settings",
    showCaptions: "Show captions",
    captionContentLabel: "Caption content",
    captionModeBoth: "Original + translated",
    captionModeTranslatedOnly: "Translated only",
    captionPositionLabel: "Caption position",
    captionPositionBottom: "Bottom",
    captionPositionTop: "Top",
    allowLearnerPresenting: "Allow participants to share screen & use whiteboard",
    leave: "Leave meeting",
    expandSidebar: "Show chat",
    resizeSidebar: "Resize chat panel",
    collapseSidebar: "Hide chat",
    chatLabel: "Chat",
    shrinkCaptionFont: "Decrease caption text size",
    growCaptionFont: "Increase caption text size",
    whiteboardLoading: "Loading whiteboard…",
    pictureInPicture: "Picture-in-picture",
    copyInviteLink: "Copy invite link",
    linkCopied: "Link copied!",
  },
  common: {
    speaker: "Speaker",
    translationUnavailable: "Translation unavailable.",
    liveNowTitle: "Live now",
    liveNowHint: "The workshop room is live. Join to see and hear the group.",
    joinLiveSession: "Join live session",
    confirm: "Confirm",
    cancel: "Cancel",
    jumpToLatest: "Jump to latest",
    chatTab: "Chat",
    captionsTab: "Captions",
  },
  notFound: {
    title: "Link not found",
    message: "This link is invalid, expired, or has been revoked by the facilitator. Ask them for a fresh link.",
    cta: "Start a new session",
  },
  error: {
    title: "Something went wrong",
    message: "An unexpected error occurred. You can try again, or reload the page.",
    retry: "Try again",
  },
};

const zh: Dictionary = {
  shell: { newSession: "新建场次", skipToContent: "跳转到主要内容", interfaceLanguage: "界面语言", language: "语言" },
  a11y: {
    fontSizeLabel: { normal: "标准字号", large: "大字号", "x-large": "特大字号" },
    textSizeAriaLabel: (label) => `Aa。字号：${label}。点击切换。`,
    contrastLabel: "对比度",
    contrastAriaLabel: (mode) => `高对比度模式：${mode === "high" ? "开启" : "关闭"}。点击切换。`,
    contrastOn: "开启",
    contrastOff: "关闭",
    themeNames: { beige: "米色", "ink-copper": "墨铜色", "slate-night": "板岩夜色", "warm-dusk": "暖暮色" },
    themeAriaLabel: (next) => `切换为${next}主题`,
  },
  languageNames: { en: "英语", zh: "中文", es: "西班牙语" },
  setup: {
    heading: "创建场次",
    subtitle: "在开始前设定一次工作坊目标。控制台会据此判断小组讨论是否在正轨上。",
    yourName: "你的姓名",
    yourNamePlaceholder: "例如：Priya，工作坊主持人",
    sessionTitle: "场次标题",
    sessionTitlePlaceholder: "例如：REST 接口工作坊",
    workshopGoal: "工作坊目标",
    workshopGoalPlaceholder: "例如：实现一个可用的用户注册 REST 接口，并包含输入校验。",
    retention: "转录保留时长",
    retentionMinutes: "5 分钟后删除（测试用）",
    retentionHour: "1 小时后删除",
    retentionDay: "1 天后删除",
    retentionWeek: "7 天后删除",
    retentionMonth: "30 天后删除",
    privacyNote: "创建场次后，你会收到一个学员专属链接。默认不会保存实时录音。",
    strictPrivacyLabel: "严格隐私模式",
    strictPrivacyHint:
      "音频和文本只留在本服务器——不会发送给 Claude 或其他云端服务。需配置本地推理，否则整场字幕和翻译都不可用。",
    submit: "创建场次",
  },
  join: {
    invitedTo: "你被邀请加入学习",
    subtitle: "选择你想如何跟随这场活动。你偏好的语言将决定翻译字幕和回复所使用的语言。",
    yourName: "你的姓名",
    consent:
      "我同意为提供实时字幕、翻译及主持人协助而处理我的语音与文字。默认不保存原始音频。进入后摄像头和麦克风立即接入——麦克风默认静音，摄像头可随时关闭。",
    submit: "加入场次",
    submitting: "加入中……",
  },
  facilitator: {
    statusDraft: "草稿",
    statusLive: "进行中",
    statusEnded: "已结束",
    startSession: "开始场次",
    endSession: "结束场次",
    confirmEndSessionTitle: "确定要结束此场次吗？",
    confirmEndSessionBody: "学员将被断开连接，字幕也会停止。此操作无法撤销。",
    logOut: "退出登录",
    learnersJoinedCard: "已加入学员",
    learnersJoinedHint: "已完成同意确认并加入的学员人数。",
    workshopRoom: "活动室",
    liveAudioVideo: "实时音视频",
    micCameraHint: "你的摄像头会立即接入；麦克风默认静音——点击下方麦克风图标可开启。",
    captionLabel: "为学员输入字幕",
    captionPlaceholder: "输入字幕，将以学员所选语言显示……",
    captionAudioHint: "会以每位学员的语言朗读给他们听，即使他们未开启翻译语音。",
    publish: "发布",
    publishing: "发布中……",
    actNow: "立即处理",
    blocker: "障碍",
    confusion: "可能存在困惑",
    confusionLevelSome: (count) => `一些困惑 (${count})`,
    confusionLevelHigh: (count) => `困惑较多 (${count})`,
    resolveBlocker: "标记为已解决",
    noInterventionYet: "暂无需要干预的事项",
    noInterventionHintOnTrack: "小组讨论看起来在正轨上——目前未检测到障碍或困惑。",
    waitingToStart: "等待开始",
    noInterventionHintWaiting: "暂无可分析内容——讨论开始后将自动更新。",
    insightsNotConfigured: "此场次未配置自动洞察检测——此处内容不会被分析。请改用手动输入字幕/聊天工具跟进。",
    languageChangeLiveWarning: "在字幕运行时切换语言不会重启实时语音识别——请先停止再重新开始字幕以完全生效。",
    liveTranscript: "实时转录",
    transcriptEmpty: "场次开始后，字幕会显示在这里。",
    currentLesson: "当前课程",
    activity: "动态",
    decision: "决定",
    noRecentActivity: "暂无记录的动态或决定。",
    learnerInvitation: "学员邀请",
    shareLink: "分享此专属链接",
    linkRevokedMsg: "该邀请链接已被撤销，无法再使用。请创建新场次以重新邀请学员。",
    learnerLinkAriaLabel: "学员邀请链接",
    copyLink: "复制链接",
    linkCopied: "已复制！",
    copyFailed: "复制链接失败，请手动选择并复制。",
    revokeInvite: "撤销邀请链接",
    confirmRevokeInviteTitle: "确定要撤销此邀请链接吗？",
    confirmRevokeInviteBody: "尚未加入的人将无法再使用此链接。",
    linkMissingMsg: "此浏览器中已没有原始学员链接。请先创建新的邀请后再分享此场次。",
    qrAlt: "学员邀请链接二维码",
    sessionEndedHeading: "场次转录记录",
    sessionEndedSummary: "此场次已结束。视频会议室已关闭，但以下完整转录和聊天记录会保留，直到该场次的保留期限到期为止。",
    sessionSummaryHeading: "AI 场次摘要",
    sessionSummaryPending: "正在生成此场次的摘要……",
    sessionSummaryUnavailable: "此场次暂无 AI 摘要。",
    sessionSummaryDuration: (minutes) => `${minutes} 分钟`,
    sessionSummaryMessages: "消息数",
    sessionSummaryQuestions: "提问数",
    sessionSummaryMisunderstoodTopics: "未理解的主题",
  },
  learner: {
    welcome: (name) => `欢迎，${name}`,
    subtitle: "字幕与主持人回复都会以你所选的语言显示。",
    preferencesCard: "你的学习偏好",
    preferredLanguageLabel: "偏好语言：",
    captionsWillAppear: "主持人开始发言后，字幕会显示在这里。",
    playTranslatedAudio: "为新字幕播放翻译语音",
    typedCaptionsAlwaysAudible: "主持人输入的字幕始终会朗读，即使此项关闭。",
    audioBlocked: "浏览器阻止了翻译语音的播放。",
    audioSkipped: "部分翻译语音无法加载，已跳过。",
    captionComposerLabel: "为所有人输入字幕",
    captionComposerPlaceholder: "输入内容，将朗读给所有人听……",
    captionAudioHint: "会以每个人的语言朗读给他们听，即使他们未开启翻译语音——适合无法说话时使用。",
    publish: "发布",
    publishing: "发布中……",
    explainSimply: "简单解释",
    giveExample: "举个例子",
    explainSimplyQuestion: (caption) => `请用简单的话解释这段字幕：“${caption}”`,
    giveExampleQuestion: (caption) => `请针对这段字幕举一个例子：“${caption}”`,
    sessionEndedHeading: "此场次已结束",
    sessionEndedSummary: "主持人已结束此场次。你仍可在下方查看转录记录和聊天记录，直到根据此场次的保留设置被自动删除为止。",
  },
  chat: {
    noMessages: "暂无消息。打个招呼或提出问题吧。",
    question: "提问",
    sendMessageLabel: "发送消息",
    placeholder: "用你自己的语言书写……",
    flagQuestion: "标记为向主持人提出的问题",
    askAnonymously: "匿名提问",
    anonymousLearner: "匿名学员",
    anonymousBadge: "匿名",
    privateBadge: "私密",
    messageFacilitatorPrivately: "私信主持人",
    publicMode: "公开聊天",
    privateModeToFacilitator: "私信主持人",
    privateModeTo: (name) => `私信 ${name}`,
    returnToPublic: "返回公开",
    recipientLabel: "发送给",
    everyone: "所有人",
    replyPrivately: "私密回复",
    send: "发送",
    sending: "发送中……",
  },
  captions: {
    start: "从麦克风开始实时字幕",
    stop: "停止实时字幕",
    agentCapturing: "已在通过你的麦克风自动生成实时字幕",
    connectionFailed:
      "实时字幕连接已断开。可在通话中开启麦克风代替——字幕会自动开始。也可使用上方的手动字幕框。",
    connectionBlocked:
      "实时字幕未能连接。可在通话中开启麦克风代替——字幕会自动开始。也可使用上方的手动字幕框。",
    sttError: "语音转文字出错。",
    micRecordingFailed: "麦克风录音失败。",
    micDenied: "麦克风访问被拒绝或不可用。",
  },
  room: {
    connecting: "正在连接安全音视频房间……",
    unableToJoin: "无法加入媒体房间。",
    toggleMicrophone: "开关麦克风",
    toggleCamera: "开关摄像头",
    toggleScreenShare: "开关屏幕共享",
    selectMicrophone: "选择麦克风",
    selectCamera: "选择摄像头",
    leaveCall: "离开通话",
    toggleCaptions: "开关字幕",
    screenShareInterrupted: "屏幕共享因重新连接而中断——请点击“共享屏幕”以恢复。",
    disconnectedDuplicate: "你已断开连接，因为此链接同时在另一个标签页或窗口中被打开。",
    disconnectedOther: "你已从媒体房间断开连接。",
    mediaDeviceError: "麦克风或摄像头出现问题。",
    cameraUnavailable: "摄像头不可用（权限被拒绝、被占用或未找到）——将不使用摄像头继续。你仍可以只用音频加入。",
    microphoneUnavailable: "麦克风不可用（权限被拒绝、被占用或未找到）——将不使用麦克风继续。",
    rejoin: "重新加入",
  },
  meeting: {
    raisedHandTitle: (name) => `${name} 举手了`,
    connectionQualityTitle: (quality) => `连接质量：${quality}`,
    toolbarLabel: "会议控制",
    muteMic: "静音麦克风",
    unmuteMic: "取消静音",
    stopCamera: "关闭摄像头",
    startCamera: "打开摄像头",
    lowerHand: "放下手",
    raiseHand: "举手",
    raiseHandFailed: "举手失败——请检查网络连接后重试",
    stopShareScreen: "停止共享屏幕",
    shareScreen: "共享屏幕",
    presentingLocked: "主持人尚未为参与者开启此功能",
    switchToVideo: "切换到视频",
    switchToWhiteboard: "切换到白板",
    settings: "设置",
    showCaptions: "显示字幕",
    captionContentLabel: "字幕内容",
    captionModeBoth: "原文 + 译文",
    captionModeTranslatedOnly: "仅译文",
    captionPositionLabel: "字幕位置",
    captionPositionBottom: "底部",
    captionPositionTop: "顶部",
    allowLearnerPresenting: "允许参与者共享屏幕和使用白板",
    leave: "离开会议",
    expandSidebar: "显示聊天",
    resizeSidebar: "调整聊天面板大小",
    collapseSidebar: "隐藏聊天",
    chatLabel: "聊天",
    shrinkCaptionFont: "减小字幕字号",
    growCaptionFont: "增大字幕字号",
    whiteboardLoading: "正在加载白板…",
    pictureInPicture: "画中画",
    copyInviteLink: "复制邀请链接",
    linkCopied: "链接已复制！",
  },
  common: {
    speaker: "发言者",
    translationUnavailable: "暂无译文。",
    liveNowTitle: "正在直播",
    liveNowHint: "活动室已开始直播。加入即可看到并听到大家。",
    joinLiveSession: "加入直播会议",
    confirm: "确认",
    cancel: "取消",
    jumpToLatest: "跳到最新",
    chatTab: "聊天",
    captionsTab: "字幕",
  },
  notFound: {
    title: "未找到该链接",
    message: "此链接无效、已过期，或已被主持人撤销。请向主持人索取新的链接。",
    cta: "创建新场次",
  },
  error: {
    title: "出了点问题",
    message: "发生了意外错误。你可以重试，或刷新页面。",
    retry: "重试",
  },
};

const es: Dictionary = {
  shell: { newSession: "Nueva sesión", skipToContent: "Saltar al contenido principal", interfaceLanguage: "Idioma de la interfaz", language: "Idioma" },
  a11y: {
    fontSizeLabel: { normal: "Texto normal", large: "Texto grande", "x-large": "Texto extra grande" },
    textSizeAriaLabel: (label) => `Aa. Tamaño de texto: ${label}. Actívalo para cambiarlo.`,
    contrastLabel: "Contraste",
    contrastAriaLabel: (mode) => `Modo de alto contraste: ${mode === "high" ? "activado" : "desactivado"}. Actívalo para alternar.`,
    contrastOn: "activado",
    contrastOff: "desactivado",
    themeNames: { beige: "Beige", "ink-copper": "Tinta y cobre", "slate-night": "Noche de pizarra", "warm-dusk": "Ocaso cálido" },
    themeAriaLabel: (next) => `Cambiar al tema ${next}`,
  },
  languageNames: { en: "Inglés", zh: "Chino", es: "Español" },
  setup: {
    heading: "Configuración de la sesión",
    subtitle:
      "Define el objetivo del taller una vez, antes de que comience la sesión. El panel lo usa para evaluar si la conversación del grupo va por buen camino.",
    yourName: "Tu nombre",
    yourNamePlaceholder: "p. ej. Priya, facilitadora del taller",
    sessionTitle: "Título de la sesión",
    sessionTitlePlaceholder: "p. ej. Taller de endpoints REST",
    workshopGoal: "Objetivo del taller",
    workshopGoalPlaceholder: "p. ej. Implementar un endpoint REST funcional para el registro de usuarios, con validación de datos.",
    retention: "Retención de la transcripción",
    retentionMinutes: "Eliminar después de 5 minutos (prueba)",
    retentionHour: "Eliminar después de 1 hora",
    retentionDay: "Eliminar después de 1 día",
    retentionWeek: "Eliminar después de 7 días",
    retentionMonth: "Eliminar después de 30 días",
    privacyNote: "Recibirás un enlace privado para alumnos después de crear la sesión. El audio en vivo no se graba de forma predeterminada.",
    strictPrivacyLabel: "Modo de privacidad estricto",
    strictPrivacyHint:
      "El audio y el texto permanecen en este servidor — nunca se envían a Claude ni a otro proveedor en la nube. Requiere inferencia local configurada, o los subtítulos y traducciones quedarán no disponibles toda la sesión.",
    submit: "Crear sesión",
  },
  join: {
    invitedTo: "Estás invitado a aprender",
    subtitle: "Elige cómo quieres seguir la sesión. Tu idioma preferido controla los subtítulos y las respuestas traducidas.",
    yourName: "Tu nombre",
    consent:
      "Acepto que mi voz y texto se procesen para subtítulos en vivo, traducción y apoyo del facilitador. El audio original no se guarda de forma predeterminada. Mi cámara y micrófono se conectan en vivo en cuanto entro — el micrófono empieza silenciado y puedo apagar la cámara en cualquier momento.",
    submit: "Unirse a la sesión",
    submitting: "Uniéndote…",
  },
  facilitator: {
    statusDraft: "borrador",
    statusLive: "en vivo",
    statusEnded: "finalizada",
    startSession: "Iniciar sesión",
    endSession: "Finalizar sesión",
    confirmEndSessionTitle: "¿Finalizar esta sesión?",
    confirmEndSessionBody: "Los alumnos se desconectarán y los subtítulos se detendrán. Esta acción no se puede deshacer.",
    logOut: "Cerrar sesión",
    learnersJoinedCard: "Alumnos conectados",
    learnersJoinedHint: "Alumnos que completaron el consentimiento y se unieron.",
    workshopRoom: "Sala del taller",
    liveAudioVideo: "Audio y video en vivo",
    micCameraHint: "Tu cámara se conecta en vivo; tu micrófono empieza silenciado — haz clic en el ícono de micrófono para activarlo.",
    captionLabel: "Escribe un subtítulo para los alumnos",
    captionPlaceholder: "Escribe un subtítulo para los alumnos en su idioma seleccionado…",
    captionAudioHint: "Se leerá en voz alta a cada alumno en su idioma, aunque no hayan activado el audio traducido.",
    publish: "Publicar",
    publishing: "Publicando…",
    actNow: "Actuar ahora",
    blocker: "Bloqueo",
    confusion: "Posible confusión",
    confusionLevelSome: (count) => `Algo de confusión (${count})`,
    confusionLevelHigh: (count) => `Mucha confusión (${count})`,
    resolveBlocker: "Marcar como resuelto",
    noInterventionYet: "Ninguna intervención necesaria por ahora",
    noInterventionHintOnTrack: "La conversación del grupo parece ir bien — aún no se detectan bloqueos ni confusión.",
    waitingToStart: "Esperando para comenzar",
    noInterventionHintWaiting: "Aún no hay nada que analizar — esto se actualizará cuando comience la conversación.",
    insightsNotConfigured: "La detección automática de información no está configurada para esta sesión — nada aquí se analiza. Usa las herramientas de subtítulos/chat manuales para seguir la sesión.",
    languageChangeLiveWarning: "Cambiar el idioma mientras los subtítulos están activos no reinicia el reconocimiento de voz en vivo — detén y vuelve a iniciar los subtítulos para aplicarlo por completo.",
    liveTranscript: "Transcripción en vivo",
    transcriptEmpty: "Los subtítulos aparecerán aquí cuando la sesión esté en vivo.",
    currentLesson: "Lección actual",
    activity: "Actividad",
    decision: "Decisión",
    noRecentActivity: "Aún no se ha registrado actividad ni decisiones.",
    learnerInvitation: "Invitación para alumnos",
    shareLink: "Comparte este enlace privado",
    linkRevokedMsg: "Este enlace de invitación fue revocado y ya no funciona. Crea una nueva sesión para volver a invitar alumnos.",
    learnerLinkAriaLabel: "Enlace de invitación para alumnos",
    copyLink: "Copiar enlace",
    linkCopied: "¡Copiado!",
    copyFailed: "No se pudo copiar el enlace. Selecciónalo y cópialo manualmente.",
    revokeInvite: "Revocar enlace de invitación",
    confirmRevokeInviteTitle: "¿Revocar este enlace de invitación?",
    confirmRevokeInviteBody: "Quienes aún no se hayan unido ya no podrán usar este enlace.",
    linkMissingMsg: "Este navegador ya no tiene el enlace original para alumnos. Crea una invitación de reemplazo antes de compartir la sesión.",
    qrAlt: "Código QR del enlace de invitación para alumnos",
    sessionEndedHeading: "Transcripción de la sesión",
    sessionEndedSummary: "Esta sesión ha finalizado. La sala de video está cerrada, pero la transcripción completa y el historial de chat siguen disponibles a continuación hasta que expire el período de retención de la sesión.",
    sessionSummaryHeading: "Resumen de la sesión (IA)",
    sessionSummaryPending: "Generando un resumen de esta sesión…",
    sessionSummaryUnavailable: "No hay ningún resumen de IA disponible para esta sesión.",
    sessionSummaryDuration: (minutes) => `${minutes} min`,
    sessionSummaryMessages: "Mensajes",
    sessionSummaryQuestions: "Preguntas",
    sessionSummaryMisunderstoodTopics: "Temas no comprendidos",
  },
  learner: {
    welcome: (name) => `Bienvenido/a, ${name}`,
    subtitle: "Tus subtítulos y las respuestas del facilitador aparecerán en tu idioma seleccionado.",
    preferencesCard: "Tus preferencias de aprendizaje",
    preferredLanguageLabel: "Idioma preferido:",
    captionsWillAppear: "Los subtítulos aparecerán aquí en cuanto el facilitador empiece a hablar.",
    playTranslatedAudio: "Reproducir audio traducido para los nuevos subtítulos",
    typedCaptionsAlwaysAudible: "Los subtítulos escritos por el facilitador siempre se leen en voz alta, aunque esto esté desactivado.",
    audioBlocked: "El navegador bloqueó la reproducción del audio traducido.",
    audioSkipped: "Algunos audios traducidos no se pudieron cargar y se omitieron.",
    captionComposerLabel: "Escribe un subtítulo para todos",
    captionComposerPlaceholder: "Escribe algo para que se lea en voz alta a todos…",
    captionAudioHint: "Se leerá en voz alta a todos en su idioma, aunque no hayan activado el audio traducido — útil si no puedes hablar.",
    publish: "Publicar",
    publishing: "Publicando…",
    explainSimply: "Explicar sencillo",
    giveExample: "Dar un ejemplo",
    explainSimplyQuestion: (caption) => `Explica esto de forma sencilla: "${caption}"`,
    giveExampleQuestion: (caption) => `Da un ejemplo para esto: "${caption}"`,
    sessionEndedHeading: "Esta sesión ha finalizado",
    sessionEndedSummary: "El facilitador finalizó esta sesión. Aún puedes revisar la transcripción y el historial de chat a continuación hasta que se eliminen automáticamente según la configuración de retención de esta sesión.",
  },
  chat: {
    noMessages: "Aún no hay mensajes. Saluda o pide ayuda.",
    question: "Pregunta",
    sendMessageLabel: "Enviar un mensaje",
    placeholder: "Escribe en tu propio idioma…",
    flagQuestion: "Marcar como pregunta para el facilitador",
    askAnonymously: "Preguntar de forma anónima",
    anonymousLearner: "Estudiante anónimo",
    anonymousBadge: "Anónimo",
    privateBadge: "Privado",
    messageFacilitatorPrivately: "Enviar mensaje privado al facilitador",
    publicMode: "Chat público",
    privateModeToFacilitator: "Privado al facilitador",
    privateModeTo: (name) => `Privado para ${name}`,
    returnToPublic: "Volver a público",
    recipientLabel: "Enviar a",
    everyone: "Todos",
    replyPrivately: "Responder en privado",
    send: "Enviar",
    sending: "Enviando…",
  },
  captions: {
    start: "Iniciar subtítulos en vivo desde el micrófono",
    stop: "Detener subtítulos en vivo",
    agentCapturing: "Los subtítulos en vivo ya se están generando desde tu micrófono",
    connectionFailed:
      "Se perdió la conexión de subtítulos en vivo. Activa el micrófono en la sala de video — los subtítulos comenzarán solos. O usa el cuadro de subtítulos manual de arriba.",
    connectionBlocked:
      "No se pudieron conectar los subtítulos en vivo. Activa el micrófono en la sala de video — los subtítulos comenzarán solos. O usa el cuadro de subtítulos manual de arriba.",
    sttError: "Error de conversión de voz a texto.",
    micRecordingFailed: "Falló la grabación del micrófono.",
    micDenied: "El acceso al micrófono fue denegado o no está disponible.",
  },
  room: {
    connecting: "Conectando tu sala segura de audio y video…",
    unableToJoin: "No se pudo unir a la sala multimedia.",
    toggleMicrophone: "Activar o desactivar micrófono",
    toggleCamera: "Activar o desactivar cámara",
    toggleScreenShare: "Activar o desactivar compartir pantalla",
    selectMicrophone: "Seleccionar micrófono",
    selectCamera: "Seleccionar cámara",
    leaveCall: "Salir de la llamada",
    toggleCaptions: "Activar o desactivar subtítulos",
    screenShareInterrupted: "Tu pantalla compartida se interrumpió por una reconexión — haz clic en Compartir pantalla para reanudarla.",
    disconnectedDuplicate: "Te has desconectado porque este enlace se abrió al mismo tiempo en otra pestaña o ventana.",
    disconnectedOther: "Te has desconectado de la sala multimedia.",
    mediaDeviceError: "Hubo un problema con tu micrófono o cámara.",
    cameraUnavailable: "Tu cámara no está disponible (permiso denegado, en uso, o no encontrada) — continuando sin ella. Aún puedes unirte solo con audio.",
    microphoneUnavailable: "Tu micrófono no está disponible (permiso denegado, en uso, o no encontrado) — continuando sin él.",
    rejoin: "Reincorporarse",
  },
  meeting: {
    raisedHandTitle: (name) => `${name} levantó la mano`,
    connectionQualityTitle: (quality) => `Conexión: ${quality}`,
    toolbarLabel: "Controles de la reunión",
    muteMic: "Silenciar micrófono",
    unmuteMic: "Activar micrófono",
    stopCamera: "Apagar cámara",
    startCamera: "Encender cámara",
    lowerHand: "Bajar la mano",
    raiseHand: "Levantar la mano",
    raiseHandFailed: "No se pudo levantar la mano — revisa tu conexión e inténtalo de nuevo",
    stopShareScreen: "Dejar de compartir pantalla",
    shareScreen: "Compartir pantalla",
    presentingLocked: "El facilitador aún no ha activado esto para los participantes",
    switchToVideo: "Cambiar a video",
    switchToWhiteboard: "Cambiar a pizarra",
    settings: "Ajustes",
    showCaptions: "Mostrar subtítulos",
    captionContentLabel: "Contenido de subtítulos",
    captionModeBoth: "Original + traducido",
    captionModeTranslatedOnly: "Solo traducido",
    captionPositionLabel: "Posición de subtítulos",
    captionPositionBottom: "Abajo",
    captionPositionTop: "Arriba",
    allowLearnerPresenting: "Permitir que los participantes compartan pantalla y usen la pizarra",
    leave: "Salir de la reunión",
    expandSidebar: "Mostrar chat",
    resizeSidebar: "Cambiar tamaño del panel de chat",
    collapseSidebar: "Ocultar chat",
    chatLabel: "Chat",
    shrinkCaptionFont: "Reducir tamaño de texto de subtítulos",
    growCaptionFont: "Aumentar tamaño de texto de subtítulos",
    whiteboardLoading: "Cargando pizarra…",
    pictureInPicture: "Imagen en imagen",
    copyInviteLink: "Copiar enlace de invitación",
    linkCopied: "¡Enlace copiado!",
  },
  common: {
    speaker: "Orador",
    translationUnavailable: "Traducción no disponible.",
    liveNowTitle: "En vivo ahora",
    liveNowHint: "La sala del taller está en vivo. Únete para ver y escuchar al grupo.",
    joinLiveSession: "Unirse a la sesión en vivo",
    confirm: "Confirmar",
    cancel: "Cancelar",
    jumpToLatest: "Ir a lo último",
    chatTab: "Chat",
    captionsTab: "Subtítulos",
  },
  notFound: {
    title: "Enlace no encontrado",
    message: "Este enlace no es válido, caducó o fue revocado por el facilitador. Pídele uno nuevo.",
    cta: "Crear una nueva sesión",
  },
  error: {
    title: "Algo salió mal",
    message: "Ocurrió un error inesperado. Puedes intentarlo de nuevo o recargar la página.",
    retry: "Intentar de nuevo",
  },
};

const dictionaries: Record<SupportedLanguage, Dictionary> = { en, zh, es };

/** Dispatched on `window` whenever the resolved page/session language changes, so any
 * mounted client component (nav, accessibility panel, theme toggle) can re-read
 * `document.documentElement`'s `data-ui-lang` attribute — see `useUiLanguage`. */
export const UI_LANGUAGE_CHANGE_EVENT = "ui-language-change";

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === "string" && (SUPPORTED_LANGUAGES as readonly { value: string }[]).some((l) => l.value === value);
}

export function resolveLanguage(value: unknown, fallback: SupportedLanguage = "en"): SupportedLanguage {
  return isSupportedLanguage(value) ? value : fallback;
}

/**
 * Parses an `Accept-Language` header (e.g. `"es-MX,es;q=0.9,en;q=0.8"`) and picks the
 * first supported language it names, by descending `;q=` weight (not raw list order —
 * a header can legally list a lower-priority tag before a higher-priority one, e.g.
 * `"en;q=0.5,fr;q=0.9"`). Used to pick the initial UI language for pages with no session
 * yet (setup/join before a `?lang=` is set), so a first-time visitor sees their own
 * language instead of always English. Delegates to `resolveLanguageFromAcceptLanguage`,
 * which the root layout already uses for the same header — two separate parsers here
 * used to disagree on which language wins whenever q-values weren't in list order.
 */
export function detectBrowserLanguage(acceptLanguageHeader: string | null, fallback: SupportedLanguage = "en"): SupportedLanguage {
  return resolveLanguageFromAcceptLanguage(acceptLanguageHeader, fallback);
}

/**
 * Best-effort initial `<html lang>` for the very first server-rendered response
 * (see layout.tsx), before any page-specific language is known — the root
 * layout is shared by every route and has no access to a nested route's
 * searchParams/session/participant data, which is where each page's real
 * language actually comes from. Parses the standard `Accept-Language` header
 * format ("en-US,en;q=0.9,zh;q=0.8") and picks the first supported language by
 * descending q-value. `SyncUiLanguage` corrects this to the page's actual
 * resolved language once client JS hydrates; this is only a heuristic to avoid
 * shipping a wrong-language `lang` attribute for the common case where a
 * visitor's browser preference matches the language they'll pick.
 */
export function resolveLanguageFromAcceptLanguage(
  header: string | null | undefined,
  fallback: SupportedLanguage = "en",
): SupportedLanguage {
  if (!header) return fallback;
  const ranges = header
    .split(",")
    .map((part) => {
      // RFC 7231 allows optional whitespace (OWS) around the ";q=" delimiter — a literal
      // ";q=" split misses entries like "en; q=0.9" (space after the semicolon), which
      // some non-browser HTTP clients/proxies emit, leaving that preference's tag
      // unsplit and rejected by isSupportedLanguage below instead of parsed and ranked.
      const [tag, qPart] = part.trim().split(/;\s*q=/i);
      const q = qPart ? Number.parseFloat(qPart) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 1 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranges) {
    const primary = tag.split("-")[0];
    if (isSupportedLanguage(primary)) return primary;
  }
  return fallback;
}

export function getDictionary(lang: SupportedLanguage): Dictionary {
  return dictionaries[lang];
}
