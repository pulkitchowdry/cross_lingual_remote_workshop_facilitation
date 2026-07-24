import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/session-contracts";
import type { ContrastMode, FontSize } from "@/lib/accessibility-preferences";

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
  };
  a11y: {
    fontSizeLabel: Record<FontSize, string>;
    textSizeAriaLabel: (label: string) => string;
    contrastLabel: string;
    contrastAriaLabel: (mode: ContrastMode) => string;
    contrastOn: string;
    contrastOff: string;
    themeDark: string;
    themeLight: string;
    themeAriaLabel: (next: "light" | "dark") => string;
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
    facilitatorLanguage: string;
    learnerLanguages: string;
    learnerLanguagesHint: string;
    retention: string;
    retentionDay: string;
    retentionWeek: string;
    retentionMonth: string;
    privacyNote: string;
    submit: string;
  };
  join: {
    invitedTo: string;
    subtitle: string;
    yourName: string;
    preferredLanguage: string;
    consent: string;
    submit: string;
  };
  facilitator: {
    sessionCreated: string;
    subtitle: string;
    statusDraft: string;
    statusLive: string;
    statusEnded: string;
    startSession: string;
    endSession: string;
    logOut: string;
    workshopGoalCard: string;
    learnersJoinedCard: string;
    learnersJoinedHint: string;
    workshopRoom: string;
    liveAudioVideo: string;
    micCameraHint: string;
    captionLabel: string;
    captionPlaceholder: string;
    publish: string;
    actNow: string;
    interventionQueue: string;
    loadDemo: string;
    blocker: string;
    noInterventionYet: string;
    noInterventionHintEmpty: string;
    noInterventionHintOnTrack: string;
    liveTranscript: string;
    whatGroupSaying: string;
    transcriptEmpty: string;
    learnerInvitation: string;
    shareLink: string;
    linkRevokedMsg: string;
    linkInstructions: string;
    learnerLinkAriaLabel: string;
    revokeInvite: string;
    linkMissingMsg: string;
    qrAlt: string;
    whatsNext: string;
    liveWorkspace: string;
    step1: string;
    step2: string;
    step3: string;
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
    appearsInLanguage: string;
    noMessages: string;
    question: string;
    sendMessageLabel: string;
    placeholder: string;
    flagQuestion: string;
    send: string;
  };
  captions: {
    start: string;
    stop: string;
    connectionFailed: string;
    sttError: string;
    micRecordingFailed: string;
    micDenied: string;
  };
  room: {
    connecting: string;
    unableToJoin: string;
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
}

const en: Dictionary = {
  shell: { newSession: "New session", skipToContent: "Skip to main content", interfaceLanguage: "Interface language" },
  a11y: {
    fontSizeLabel: { normal: "Normal text", large: "Large text", "x-large": "Extra-large text" },
    textSizeAriaLabel: (label) => `Aa. Text size: ${label}. Activate to change.`,
    contrastLabel: "Contrast",
    contrastAriaLabel: (mode) => `High contrast mode: ${mode === "high" ? "on" : "off"}. Activate to toggle.`,
    contrastOn: "on",
    contrastOff: "off",
    themeDark: "Dark",
    themeLight: "Light",
    themeAriaLabel: (next) => `Switch to ${next} mode`,
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
    facilitatorLanguage: "Facilitator's language",
    learnerLanguages: "Learner languages",
    learnerLanguagesHint: "Learners choose one of these when they join. Start with the languages you can support.",
    retention: "Transcript retention",
    retentionDay: "Delete after 1 day",
    retentionWeek: "Delete after 7 days",
    retentionMonth: "Delete after 30 days",
    privacyNote: "You'll receive a private learner link after creating the session. Live audio is not recorded by default.",
    submit: "Create session",
  },
  join: {
    invitedTo: "You're invited to learn",
    subtitle: "Choose how you'd like to follow the session. Your preferred language controls translated captions and replies.",
    yourName: "Your name",
    preferredLanguage: "Preferred language",
    consent:
      "I agree to speech and text being processed to provide live captions, translation, and facilitator support for this session. Raw audio is not stored by default. My microphone will join the workshop room live (audible to other participants) as soon as I enter — my camera stays off until I turn it on.",
    submit: "Join session",
  },
  facilitator: {
    sessionCreated: "Session created",
    subtitle: "Invite learners first, then start live captions and the intervention dashboard.",
    statusDraft: "draft",
    statusLive: "live",
    statusEnded: "ended",
    startSession: "Start session",
    endSession: "End session",
    logOut: "Log out",
    workshopGoalCard: "Workshop goal",
    learnersJoinedCard: "Learners joined",
    learnersJoinedHint: "Learners have completed consent and joined.",
    workshopRoom: "Workshop room",
    liveAudioVideo: "Live audio and video",
    micCameraHint: "Your microphone joins live; your camera starts off — click the camera icon below to turn it on.",
    captionLabel: "Type a caption for learners",
    captionPlaceholder: "Type a caption for learners in their selected language…",
    publish: "Publish",
    actNow: "Act now",
    interventionQueue: "Evidence-backed intervention queue",
    loadDemo: "Load demo scenario",
    blocker: "Blocker",
    noInterventionYet: "No intervention needed yet",
    noInterventionHintEmpty: "Load the demo scenario to test the grounded intervention experience.",
    noInterventionHintOnTrack: "The group's discussion looks on track — no blockers detected yet.",
    liveTranscript: "Live transcript",
    whatGroupSaying: "What the group is saying",
    transcriptEmpty: "Captions will arrive here when the session is live.",
    learnerInvitation: "Learner invitation",
    shareLink: "Share this private link",
    linkRevokedMsg: "This invite link has been revoked and no longer works. Create a new session to invite learners again.",
    linkInstructions: "Learners will choose a language and consent before entering the session. Scan the QR code or share the link below.",
    learnerLinkAriaLabel: "Learner invitation link",
    revokeInvite: "Revoke invite link",
    linkMissingMsg: "This browser no longer has the original learner link. Create a replacement invitation before sharing the session.",
    qrAlt: "QR code for the learner invitation link",
    whatsNext: "What's next",
    liveWorkspace: "Live learning workspace",
    step1: "Start the session and connect live captions.",
    step2: "Show translated captions in each learner's chosen language.",
    step3: "Enable the evidence-backed intervention queue for the facilitator.",
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
    appearsInLanguage: "Messages appear in your selected language.",
    noMessages: "No messages yet. Say hello or ask for help.",
    question: "Question",
    sendMessageLabel: "Send a message",
    placeholder: "Write in your own language…",
    flagQuestion: "Flag as a question for the facilitator",
    send: "Send",
  },
  captions: {
    start: "Start live captions from mic",
    stop: "Stop live captions",
    connectionFailed:
      "Live caption connection failed. In local development this endpoint needs a Vercel deployment (or `vercel dev`) — use the typed caption box above instead.",
    sttError: "Speech-to-text error.",
    micRecordingFailed: "Microphone recording failed.",
    micDenied: "Microphone access was denied or unavailable.",
  },
  room: {
    connecting: "Connecting your secure audio/video room…",
    unableToJoin: "Unable to join the media room.",
  },
  common: { speaker: "Speaker", translationUnavailable: "Translation unavailable." },
  notFound: {
    title: "Link not found",
    message: "This link is invalid, expired, or has been revoked by the facilitator. Ask them for a fresh link.",
    cta: "Start a new session",
  },
};

const zh: Dictionary = {
  shell: { newSession: "新建场次", skipToContent: "跳转到主要内容", interfaceLanguage: "界面语言" },
  a11y: {
    fontSizeLabel: { normal: "标准字号", large: "大字号", "x-large": "特大字号" },
    textSizeAriaLabel: (label) => `Aa。字号：${label}。点击切换。`,
    contrastLabel: "对比度",
    contrastAriaLabel: (mode) => `高对比度模式：${mode === "high" ? "开启" : "关闭"}。点击切换。`,
    contrastOn: "开启",
    contrastOff: "关闭",
    themeDark: "深色",
    themeLight: "浅色",
    themeAriaLabel: (next) => `切换为${next === "dark" ? "深色" : "浅色"}模式`,
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
    facilitatorLanguage: "主持人使用的语言",
    learnerLanguages: "学员可选语言",
    learnerLanguagesHint: "学员加入时会从中选择一种。请先勾选你能够支持的语言。",
    retention: "转录保留时长",
    retentionDay: "1 天后删除",
    retentionWeek: "7 天后删除",
    retentionMonth: "30 天后删除",
    privacyNote: "创建场次后，你会收到一个学员专属链接。默认不会保存实时录音。",
    submit: "创建场次",
  },
  join: {
    invitedTo: "你被邀请加入学习",
    subtitle: "选择你想如何跟随这场活动。你偏好的语言将决定翻译字幕和回复所使用的语言。",
    yourName: "你的姓名",
    preferredLanguage: "偏好语言",
    consent:
      "我同意为提供本场次的实时字幕、翻译及主持人协助而处理我的语音与文字。默认不会保存原始音频。进入后我的麦克风会立即接入活动室（其他参与者可以听到），摄像头会保持关闭，直到我手动开启。",
    submit: "加入场次",
  },
  facilitator: {
    sessionCreated: "场次已创建",
    subtitle: "请先邀请学员，然后开启实时字幕与干预看板。",
    statusDraft: "草稿",
    statusLive: "进行中",
    statusEnded: "已结束",
    startSession: "开始场次",
    endSession: "结束场次",
    logOut: "退出登录",
    workshopGoalCard: "工作坊目标",
    learnersJoinedCard: "已加入学员",
    learnersJoinedHint: "已完成同意确认并加入的学员人数。",
    workshopRoom: "活动室",
    liveAudioVideo: "实时音视频",
    micCameraHint: "你的麦克风会立即接入；摄像头默认关闭——点击下方摄像头图标可开启。",
    captionLabel: "为学员输入字幕",
    captionPlaceholder: "输入字幕，将以学员所选语言显示……",
    publish: "发布",
    actNow: "立即处理",
    interventionQueue: "有据可查的干预队列",
    loadDemo: "加载演示场景",
    blocker: "障碍",
    noInterventionYet: "暂无需要干预的事项",
    noInterventionHintEmpty: "加载演示场景以体验基于证据的干预功能。",
    noInterventionHintOnTrack: "小组讨论看起来在正轨上——目前未检测到障碍。",
    liveTranscript: "实时转录",
    whatGroupSaying: "小组正在讨论的内容",
    transcriptEmpty: "场次开始后，字幕会显示在这里。",
    learnerInvitation: "学员邀请",
    shareLink: "分享此专属链接",
    linkRevokedMsg: "该邀请链接已被撤销，无法再使用。请创建新场次以重新邀请学员。",
    linkInstructions: "学员进入前需要选择语言并同意条款。扫描二维码或分享下方链接即可邀请。",
    learnerLinkAriaLabel: "学员邀请链接",
    revokeInvite: "撤销邀请链接",
    linkMissingMsg: "此浏览器中已没有原始学员链接。请先创建新的邀请后再分享此场次。",
    qrAlt: "学员邀请链接二维码",
    whatsNext: "接下来",
    liveWorkspace: "实时学习空间",
    step1: "开始场次并接入实时字幕。",
    step2: "以每位学员所选语言显示翻译字幕。",
    step3: "为主持人启用有据可查的干预队列。",
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
    appearsInLanguage: "消息会以你所选的语言显示。",
    noMessages: "暂无消息。打个招呼或提出问题吧。",
    question: "提问",
    sendMessageLabel: "发送消息",
    placeholder: "用你自己的语言书写……",
    flagQuestion: "标记为向主持人提出的问题",
    send: "发送",
  },
  captions: {
    start: "从麦克风开始实时字幕",
    stop: "停止实时字幕",
    connectionFailed:
      "实时字幕连接失败。本地开发环境下此功能需要 Vercel 部署（或 `vercel dev`）——请改用上方的手动输入字幕框。",
    sttError: "语音转文字出错。",
    micRecordingFailed: "麦克风录音失败。",
    micDenied: "麦克风访问被拒绝或不可用。",
  },
  room: {
    connecting: "正在连接安全音视频房间……",
    unableToJoin: "无法加入媒体房间。",
  },
  common: { speaker: "发言者", translationUnavailable: "暂无译文。" },
  notFound: {
    title: "未找到该链接",
    message: "此链接无效、已过期，或已被主持人撤销。请向主持人索取新的链接。",
    cta: "创建新场次",
  },
};

const es: Dictionary = {
  shell: { newSession: "Nueva sesión", skipToContent: "Saltar al contenido principal", interfaceLanguage: "Idioma de la interfaz" },
  a11y: {
    fontSizeLabel: { normal: "Texto normal", large: "Texto grande", "x-large": "Texto extra grande" },
    textSizeAriaLabel: (label) => `Aa. Tamaño de texto: ${label}. Actívalo para cambiarlo.`,
    contrastLabel: "Contraste",
    contrastAriaLabel: (mode) => `Modo de alto contraste: ${mode === "high" ? "activado" : "desactivado"}. Actívalo para alternar.`,
    contrastOn: "activado",
    contrastOff: "desactivado",
    themeDark: "Oscuro",
    themeLight: "Claro",
    themeAriaLabel: (next) => `Cambiar a modo ${next === "dark" ? "oscuro" : "claro"}`,
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
    facilitatorLanguage: "Idioma del facilitador",
    learnerLanguages: "Idiomas para los alumnos",
    learnerLanguagesHint: "Los alumnos elegirán uno de estos al unirse. Empieza con los idiomas que puedas ofrecer.",
    retention: "Retención de la transcripción",
    retentionDay: "Eliminar después de 1 día",
    retentionWeek: "Eliminar después de 7 días",
    retentionMonth: "Eliminar después de 30 días",
    privacyNote: "Recibirás un enlace privado para alumnos después de crear la sesión. El audio en vivo no se graba de forma predeterminada.",
    submit: "Crear sesión",
  },
  join: {
    invitedTo: "Estás invitado a aprender",
    subtitle: "Elige cómo quieres seguir la sesión. Tu idioma preferido controla los subtítulos y las respuestas traducidas.",
    yourName: "Tu nombre",
    preferredLanguage: "Idioma preferido",
    consent:
      "Acepto que mi voz y mi texto se procesen para ofrecer subtítulos en vivo, traducción y apoyo del facilitador durante esta sesión. El audio original no se guarda de forma predeterminada. Mi micrófono se conectará a la sala del taller en vivo (audible para el resto de participantes) en cuanto entre; mi cámara permanecerá apagada hasta que yo la active.",
    submit: "Unirse a la sesión",
  },
  facilitator: {
    sessionCreated: "Sesión creada",
    subtitle: "Invita primero a los alumnos y luego inicia los subtítulos en vivo y el panel de intervención.",
    statusDraft: "borrador",
    statusLive: "en vivo",
    statusEnded: "finalizada",
    startSession: "Iniciar sesión",
    endSession: "Finalizar sesión",
    logOut: "Cerrar sesión",
    workshopGoalCard: "Objetivo del taller",
    learnersJoinedCard: "Alumnos conectados",
    learnersJoinedHint: "Alumnos que completaron el consentimiento y se unieron.",
    workshopRoom: "Sala del taller",
    liveAudioVideo: "Audio y video en vivo",
    micCameraHint: "Tu micrófono se conecta en vivo; tu cámara empieza apagada — haz clic en el ícono de cámara para activarla.",
    captionLabel: "Escribe un subtítulo para los alumnos",
    captionPlaceholder: "Escribe un subtítulo para los alumnos en su idioma seleccionado…",
    publish: "Publicar",
    actNow: "Actuar ahora",
    interventionQueue: "Cola de intervención respaldada por evidencia",
    loadDemo: "Cargar escenario de demostración",
    blocker: "Bloqueo",
    noInterventionYet: "Ninguna intervención necesaria por ahora",
    noInterventionHintEmpty: "Carga el escenario de demostración para probar la experiencia de intervención con evidencia.",
    noInterventionHintOnTrack: "La conversación del grupo parece ir bien — aún no se detectan bloqueos.",
    liveTranscript: "Transcripción en vivo",
    whatGroupSaying: "Lo que el grupo está diciendo",
    transcriptEmpty: "Los subtítulos aparecerán aquí cuando la sesión esté en vivo.",
    learnerInvitation: "Invitación para alumnos",
    shareLink: "Comparte este enlace privado",
    linkRevokedMsg: "Este enlace de invitación fue revocado y ya no funciona. Crea una nueva sesión para volver a invitar alumnos.",
    linkInstructions: "Los alumnos elegirán un idioma y darán su consentimiento antes de entrar a la sesión. Escanea el código QR o comparte el enlace de abajo.",
    learnerLinkAriaLabel: "Enlace de invitación para alumnos",
    revokeInvite: "Revocar enlace de invitación",
    linkMissingMsg: "Este navegador ya no tiene el enlace original para alumnos. Crea una invitación de reemplazo antes de compartir la sesión.",
    qrAlt: "Código QR del enlace de invitación para alumnos",
    whatsNext: "Qué sigue",
    liveWorkspace: "Espacio de aprendizaje en vivo",
    step1: "Inicia la sesión y conecta los subtítulos en vivo.",
    step2: "Muestra subtítulos traducidos en el idioma elegido por cada alumno.",
    step3: "Activa la cola de intervención respaldada por evidencia para el facilitador.",
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
    appearsInLanguage: "Los mensajes aparecen en tu idioma seleccionado.",
    noMessages: "Aún no hay mensajes. Saluda o pide ayuda.",
    question: "Pregunta",
    sendMessageLabel: "Enviar un mensaje",
    placeholder: "Escribe en tu propio idioma…",
    flagQuestion: "Marcar como pregunta para el facilitador",
    send: "Enviar",
  },
  captions: {
    start: "Iniciar subtítulos en vivo desde el micrófono",
    stop: "Detener subtítulos en vivo",
    connectionFailed:
      "Falló la conexión de subtítulos en vivo. En desarrollo local este endpoint requiere un despliegue en Vercel (o `vercel dev`) — usa el cuadro de subtítulos manual de arriba en su lugar.",
    sttError: "Error de conversión de voz a texto.",
    micRecordingFailed: "Falló la grabación del micrófono.",
    micDenied: "El acceso al micrófono fue denegado o no está disponible.",
  },
  room: {
    connecting: "Conectando tu sala segura de audio y video…",
    unableToJoin: "No se pudo unir a la sala multimedia.",
  },
  common: { speaker: "Orador", translationUnavailable: "Traducción no disponible." },
  notFound: {
    title: "Enlace no encontrado",
    message: "Este enlace no es válido, caducó o fue revocado por el facilitador. Pídele uno nuevo.",
    cta: "Crear una nueva sesión",
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

export function getDictionary(lang: SupportedLanguage): Dictionary {
  return dictionaries[lang];
}
