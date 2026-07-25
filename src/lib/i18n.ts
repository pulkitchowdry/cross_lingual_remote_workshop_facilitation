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
    logOut: string;
    learnersJoinedCard: string;
    learnersJoinedHint: string;
    workshopRoom: string;
    liveAudioVideo: string;
    micCameraHint: string;
    captionLabel: string;
    captionPlaceholder: string;
    publish: string;
    publishing: string;
    actNow: string;
    blocker: string;
    resolveBlocker: string;
    noInterventionYet: string;
    noInterventionHintOnTrack: string;
    waitingToStart: string;
    noInterventionHintWaiting: string;
    languageChangeLiveWarning: string;
    liveTranscript: string;
    transcriptEmpty: string;
    learnerInvitation: string;
    shareLink: string;
    linkRevokedMsg: string;
    learnerLinkAriaLabel: string;
    copyLink: string;
    linkCopied: string;
    copyFailed: string;
    revokeInvite: string;
    linkMissingMsg: string;
    qrAlt: string;
  };
  learner: {
    welcome: (name: string) => string;
    subtitle: string;
    preferencesCard: string;
    preferredLanguageLabel: string;
    liveCaptions: string;
    followExplanation: string;
    sessionEnded: string;
    waitingForFacilitator: string;
    captionStream: string;
    captionsWillAppear: string;
    playTranslatedAudio: string;
    audioBlocked: string;
    audioSkipped: string;
  };
  chat: {
    translatedChat: string;
    noMessages: string;
    question: string;
    sendMessageLabel: string;
    placeholder: string;
    flagQuestion: string;
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
    screenShareInterrupted: string;
    disconnectedDuplicate: string;
    disconnectedOther: string;
    mediaDeviceError: string;
    reload: string;
  };
  common: {
    speaker: string;
    translationUnavailable: string;
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
    retentionDay: "Delete after 1 day",
    retentionWeek: "Delete after 7 days",
    retentionMonth: "Delete after 30 days",
    privacyNote: "You'll receive a private learner link after creating the session. Live audio is not recorded by default.",
    strictPrivacyLabel: "Strict privacy mode",
    strictPrivacyHint:
      "Nothing is ever sent to Claude or another cloud translation provider — audio and text stay on this server. This requires a local-inference server to be configured; if none is set up (the default for local testing), captions and translations will show as unavailable for the whole session instead of using the cloud, not just when the network is unreliable.",
    submit: "Create session",
  },
  join: {
    invitedTo: "You're invited to learn",
    subtitle: "Choose how you'd like to follow the session. Your preferred language controls translated captions and replies.",
    yourName: "Your name",
    consent:
      "I agree to speech and text being processed to provide live captions, translation, and facilitator support for this session. Raw audio is not stored by default. My camera and microphone will join the workshop room live as soon as I enter (visible/audible to other participants) — my microphone starts muted, and I can turn my camera off at any time.",
    submit: "Join session",
    submitting: "Joining…",
  },
  facilitator: {
    statusDraft: "draft",
    statusLive: "live",
    statusEnded: "ended",
    startSession: "Start session",
    endSession: "End session",
    logOut: "Log out",
    learnersJoinedCard: "Learners joined",
    learnersJoinedHint: "Learners have completed consent and joined.",
    workshopRoom: "Workshop room",
    liveAudioVideo: "Live audio and video",
    micCameraHint: "Your camera joins live; your microphone starts muted — click the microphone icon below to turn it on.",
    captionLabel: "Type a caption for learners",
    captionPlaceholder: "Type a caption for learners in their selected language…",
    publish: "Publish",
    publishing: "Publishing…",
    actNow: "Act now",
    blocker: "Blocker",
    resolveBlocker: "Mark resolved",
    noInterventionYet: "No intervention needed yet",
    noInterventionHintOnTrack: "The group's discussion looks on track — no blockers detected yet.",
    waitingToStart: "Waiting to begin",
    noInterventionHintWaiting: "Nothing to analyze yet — this updates once the discussion starts.",
    languageChangeLiveWarning: "Changing language while captions are running won't restart the live speech recognition — stop and restart captions to fully apply it.",
    liveTranscript: "Live transcript",
    transcriptEmpty: "Captions will arrive here when the session is live.",
    learnerInvitation: "Learner invitation",
    shareLink: "Share this private link",
    linkRevokedMsg: "This invite link has been revoked and no longer works. Create a new session to invite learners again.",
    learnerLinkAriaLabel: "Learner invitation link",
    copyLink: "Copy link",
    linkCopied: "Copied!",
    copyFailed: "Couldn't copy the link. Select and copy it manually instead.",
    revokeInvite: "Revoke invite link",
    linkMissingMsg: "This browser no longer has the original learner link. Create a replacement invitation before sharing the session.",
    qrAlt: "QR code for the learner invitation link",
  },
  learner: {
    welcome: (name) => `Welcome, ${name}`,
    subtitle: "Your captions and facilitator replies will appear in your selected language.",
    preferencesCard: "Your learning preferences",
    preferredLanguageLabel: "Preferred language:",
    liveCaptions: "Live captions",
    followExplanation: "Follow the explanation in your language",
    sessionEnded: "Session ended",
    waitingForFacilitator: "Waiting for the facilitator to start",
    captionStream: "Caption stream",
    captionsWillAppear: "Captions will appear here as soon as the facilitator starts speaking.",
    playTranslatedAudio: "Play translated audio for new captions",
    audioBlocked: "Translated audio playback was blocked by the browser.",
    audioSkipped: "Some translated audio couldn't be loaded and was skipped.",
  },
  chat: {
    translatedChat: "Translated chat",
    noMessages: "No messages yet. Say hello or ask for help.",
    question: "Question",
    sendMessageLabel: "Send a message",
    placeholder: "Write in your own language…",
    flagQuestion: "Flag as a question for the facilitator",
    send: "Send",
    sending: "Sending…",
  },
  captions: {
    start: "Start live captions from mic",
    stop: "Stop live captions",
    agentCapturing: "Live captions are already running from your mic",
    connectionFailed:
      "Live caption connection failed. Use the typed caption box above instead.",
    connectionBlocked:
      "Couldn't open the live caption connection. Try unmuting your microphone in the video room instead — captions will start automatically. You can also use the typed caption box above.",
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
    screenShareInterrupted: "Your screen share was interrupted by a reconnect — click Share screen again to resume.",
    disconnectedDuplicate: "You've been disconnected because this link was opened in another tab or window at the same time.",
    disconnectedOther: "You've been disconnected from the media room.",
    mediaDeviceError: "There was a problem with your microphone or camera.",
    reload: "Reload",
  },
  common: { speaker: "Speaker", translationUnavailable: "Translation unavailable." },
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
    retentionDay: "1 天后删除",
    retentionWeek: "7 天后删除",
    retentionMonth: "30 天后删除",
    privacyNote: "创建场次后，你会收到一个学员专属链接。默认不会保存实时录音。",
    strictPrivacyLabel: "严格隐私模式",
    strictPrivacyHint:
      "绝不会将音频或文本发送给 Claude 或其他云端翻译服务——数据始终留在本服务器上。此选项需要配置本地推理服务器；如果未配置（本地测试的默认情况），整场活动的字幕和翻译都会显示为不可用，而不仅仅是网络不稳定时才会如此。",
    submit: "创建场次",
  },
  join: {
    invitedTo: "你被邀请加入学习",
    subtitle: "选择你想如何跟随这场活动。你偏好的语言将决定翻译字幕和回复所使用的语言。",
    yourName: "你的姓名",
    consent:
      "我同意为提供本场次的实时字幕、翻译及主持人协助而处理我的语音与文字。默认不会保存原始音频。进入后我的摄像头和麦克风会立即接入活动室（其他参与者可以看到/听到）——麦克风默认静音，摄像头可随时关闭。",
    submit: "加入场次",
    submitting: "加入中……",
  },
  facilitator: {
    statusDraft: "草稿",
    statusLive: "进行中",
    statusEnded: "已结束",
    startSession: "开始场次",
    endSession: "结束场次",
    logOut: "退出登录",
    learnersJoinedCard: "已加入学员",
    learnersJoinedHint: "已完成同意确认并加入的学员人数。",
    workshopRoom: "活动室",
    liveAudioVideo: "实时音视频",
    micCameraHint: "你的摄像头会立即接入；麦克风默认静音——点击下方麦克风图标可开启。",
    captionLabel: "为学员输入字幕",
    captionPlaceholder: "输入字幕，将以学员所选语言显示……",
    publish: "发布",
    publishing: "发布中……",
    actNow: "立即处理",
    blocker: "障碍",
    resolveBlocker: "标记为已解决",
    noInterventionYet: "暂无需要干预的事项",
    noInterventionHintOnTrack: "小组讨论看起来在正轨上——目前未检测到障碍。",
    waitingToStart: "等待开始",
    noInterventionHintWaiting: "暂无可分析内容——讨论开始后将自动更新。",
    languageChangeLiveWarning: "在字幕运行时切换语言不会重启实时语音识别——请先停止再重新开始字幕以完全生效。",
    liveTranscript: "实时转录",
    transcriptEmpty: "场次开始后，字幕会显示在这里。",
    learnerInvitation: "学员邀请",
    shareLink: "分享此专属链接",
    linkRevokedMsg: "该邀请链接已被撤销，无法再使用。请创建新场次以重新邀请学员。",
    learnerLinkAriaLabel: "学员邀请链接",
    copyLink: "复制链接",
    linkCopied: "已复制！",
    copyFailed: "复制链接失败，请手动选择并复制。",
    revokeInvite: "撤销邀请链接",
    linkMissingMsg: "此浏览器中已没有原始学员链接。请先创建新的邀请后再分享此场次。",
    qrAlt: "学员邀请链接二维码",
  },
  learner: {
    welcome: (name) => `欢迎，${name}`,
    subtitle: "字幕与主持人回复都会以你所选的语言显示。",
    preferencesCard: "你的学习偏好",
    preferredLanguageLabel: "偏好语言：",
    liveCaptions: "实时字幕",
    followExplanation: "以你的语言跟随讲解",
    sessionEnded: "场次已结束",
    waitingForFacilitator: "等待主持人开始",
    captionStream: "字幕流",
    captionsWillAppear: "主持人开始发言后，字幕会显示在这里。",
    playTranslatedAudio: "为新字幕播放翻译语音",
    audioBlocked: "浏览器阻止了翻译语音的播放。",
    audioSkipped: "部分翻译语音无法加载，已跳过。",
  },
  chat: {
    translatedChat: "翻译聊天",
    noMessages: "暂无消息。打个招呼或提出问题吧。",
    question: "提问",
    sendMessageLabel: "发送消息",
    placeholder: "用你自己的语言书写……",
    flagQuestion: "标记为向主持人提出的问题",
    send: "发送",
    sending: "发送中……",
  },
  captions: {
    start: "从麦克风开始实时字幕",
    stop: "停止实时字幕",
    agentCapturing: "已在通过你的麦克风自动生成实时字幕",
    connectionFailed:
      "实时字幕连接失败。请改用上方的手动输入字幕框。",
    connectionBlocked:
      "无法建立实时字幕连接。可以改为在视频通话中开启麦克风——字幕会自动开始生成。你也可以改用上方的手动输入字幕框。",
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
    screenShareInterrupted: "屏幕共享因重新连接而中断——请点击“共享屏幕”以恢复。",
    disconnectedDuplicate: "你已断开连接，因为此链接同时在另一个标签页或窗口中被打开。",
    disconnectedOther: "你已从媒体房间断开连接。",
    mediaDeviceError: "麦克风或摄像头出现问题。",
    reload: "重新加载",
  },
  common: { speaker: "发言者", translationUnavailable: "暂无译文。" },
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
    retentionDay: "Eliminar después de 1 día",
    retentionWeek: "Eliminar después de 7 días",
    retentionMonth: "Eliminar después de 30 días",
    privacyNote: "Recibirás un enlace privado para alumnos después de crear la sesión. El audio en vivo no se graba de forma predeterminada.",
    strictPrivacyLabel: "Modo de privacidad estricto",
    strictPrivacyHint:
      "Nunca se envía audio ni texto a Claude ni a otro proveedor de traducción en la nube: todo permanece en este servidor. Esto requiere un servidor de inferencia local configurado; si no hay uno (lo habitual en pruebas locales), los subtítulos y traducciones se mostrarán como no disponibles durante toda la sesión, no solo cuando la red falle.",
    submit: "Crear sesión",
  },
  join: {
    invitedTo: "Estás invitado a aprender",
    subtitle: "Elige cómo quieres seguir la sesión. Tu idioma preferido controla los subtítulos y las respuestas traducidas.",
    yourName: "Tu nombre",
    consent:
      "Acepto que mi voz y mi texto se procesen para ofrecer subtítulos en vivo, traducción y apoyo del facilitador durante esta sesión. El audio original no se guarda de forma predeterminada. Mi cámara y micrófono se conectarán a la sala del taller en vivo en cuanto entre (visible/audible para el resto de participantes) — mi micrófono empieza silenciado y puedo apagar mi cámara en cualquier momento.",
    submit: "Unirse a la sesión",
    submitting: "Uniéndote…",
  },
  facilitator: {
    statusDraft: "borrador",
    statusLive: "en vivo",
    statusEnded: "finalizada",
    startSession: "Iniciar sesión",
    endSession: "Finalizar sesión",
    logOut: "Cerrar sesión",
    learnersJoinedCard: "Alumnos conectados",
    learnersJoinedHint: "Alumnos que completaron el consentimiento y se unieron.",
    workshopRoom: "Sala del taller",
    liveAudioVideo: "Audio y video en vivo",
    micCameraHint: "Tu cámara se conecta en vivo; tu micrófono empieza silenciado — haz clic en el ícono de micrófono para activarlo.",
    captionLabel: "Escribe un subtítulo para los alumnos",
    captionPlaceholder: "Escribe un subtítulo para los alumnos en su idioma seleccionado…",
    publish: "Publicar",
    publishing: "Publicando…",
    actNow: "Actuar ahora",
    blocker: "Bloqueo",
    resolveBlocker: "Marcar como resuelto",
    noInterventionYet: "Ninguna intervención necesaria por ahora",
    noInterventionHintOnTrack: "La conversación del grupo parece ir bien — aún no se detectan bloqueos.",
    waitingToStart: "Esperando para comenzar",
    noInterventionHintWaiting: "Aún no hay nada que analizar — esto se actualizará cuando comience la conversación.",
    languageChangeLiveWarning: "Cambiar el idioma mientras los subtítulos están activos no reinicia el reconocimiento de voz en vivo — detén y vuelve a iniciar los subtítulos para aplicarlo por completo.",
    liveTranscript: "Transcripción en vivo",
    transcriptEmpty: "Los subtítulos aparecerán aquí cuando la sesión esté en vivo.",
    learnerInvitation: "Invitación para alumnos",
    shareLink: "Comparte este enlace privado",
    linkRevokedMsg: "Este enlace de invitación fue revocado y ya no funciona. Crea una nueva sesión para volver a invitar alumnos.",
    learnerLinkAriaLabel: "Enlace de invitación para alumnos",
    copyLink: "Copiar enlace",
    linkCopied: "¡Copiado!",
    copyFailed: "No se pudo copiar el enlace. Selecciónalo y cópialo manualmente.",
    revokeInvite: "Revocar enlace de invitación",
    linkMissingMsg: "Este navegador ya no tiene el enlace original para alumnos. Crea una invitación de reemplazo antes de compartir la sesión.",
    qrAlt: "Código QR del enlace de invitación para alumnos",
  },
  learner: {
    welcome: (name) => `Bienvenido/a, ${name}`,
    subtitle: "Tus subtítulos y las respuestas del facilitador aparecerán en tu idioma seleccionado.",
    preferencesCard: "Tus preferencias de aprendizaje",
    preferredLanguageLabel: "Idioma preferido:",
    liveCaptions: "Subtítulos en vivo",
    followExplanation: "Sigue la explicación en tu idioma",
    sessionEnded: "Sesión finalizada",
    waitingForFacilitator: "Esperando a que el facilitador comience",
    captionStream: "Flujo de subtítulos",
    captionsWillAppear: "Los subtítulos aparecerán aquí en cuanto el facilitador empiece a hablar.",
    playTranslatedAudio: "Reproducir audio traducido para los nuevos subtítulos",
    audioBlocked: "El navegador bloqueó la reproducción del audio traducido.",
    audioSkipped: "Algunos audios traducidos no se pudieron cargar y se omitieron.",
  },
  chat: {
    translatedChat: "Chat traducido",
    noMessages: "Aún no hay mensajes. Saluda o pide ayuda.",
    question: "Pregunta",
    sendMessageLabel: "Enviar un mensaje",
    placeholder: "Escribe en tu propio idioma…",
    flagQuestion: "Marcar como pregunta para el facilitador",
    send: "Enviar",
    sending: "Enviando…",
  },
  captions: {
    start: "Iniciar subtítulos en vivo desde el micrófono",
    stop: "Detener subtítulos en vivo",
    agentCapturing: "Los subtítulos en vivo ya se están generando desde tu micrófono",
    connectionFailed:
      "Falló la conexión de subtítulos en vivo. Usa el cuadro de subtítulos manual de arriba en su lugar.",
    connectionBlocked:
      "No se pudo abrir la conexión de subtítulos en vivo. Prueba a activar el micrófono en la sala de video: los subtítulos comenzarán automáticamente. También puedes usar el cuadro de subtítulos manual de arriba.",
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
    screenShareInterrupted: "Tu pantalla compartida se interrumpió por una reconexión — haz clic en Compartir pantalla para reanudarla.",
    disconnectedDuplicate: "Te has desconectado porque este enlace se abrió al mismo tiempo en otra pestaña o ventana.",
    disconnectedOther: "Te has desconectado de la sala multimedia.",
    mediaDeviceError: "Hubo un problema con tu micrófono o cámara.",
    reload: "Recargar",
  },
  common: { speaker: "Orador", translationUnavailable: "Traducción no disponible." },
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
      const [tag, qPart] = part.trim().split(";q=");
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
