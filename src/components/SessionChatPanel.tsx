type ChatMessage = {
  id: string;
  originalText: string;
  language: string;
  kind?: string;
  sender: { displayName: string };
  translations: Array<{ targetLanguage: string; text: string }>;
};

function translatedText(message: ChatMessage, targetLanguage: string) {
  return (
    message.translations.find((translation) => translation.targetLanguage === targetLanguage)?.text ??
    (message.language === targetLanguage ? message.originalText : "Translation unavailable.")
  );
}

export function SessionChatPanel({
  messages,
  targetLanguage,
  sendAction,
  allowQuestions = false,
}: {
  messages: ChatMessage[];
  targetLanguage: string;
  sendAction: (formData: FormData) => void | Promise<void>;
  allowQuestions?: boolean;
}) {
  return (
    <aside className="flex min-h-[38rem] flex-col rounded-lg border border-border-subtle bg-surface-raised">
      <div className="border-b border-border-subtle px-4 py-3">
        <p className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">Translated chat</p>
        <p className="mt-1 text-sm text-foreground">Messages appear in your selected language.</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4" aria-live="polite">
        {messages.length > 0 ? (
          messages.map((message) => (
            <article key={message.id} className="rounded-md border border-border-subtle bg-background p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-data text-xs font-medium text-[var(--accent-text)]">{message.sender.displayName}</p>
                {message.kind === "QUESTION" && (
                  <span className="font-data rounded-full border border-accent px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--accent-text)]">
                    Question
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm leading-relaxed" lang={targetLanguage}>
                {translatedText(message, targetLanguage)}
              </p>
              {message.language !== targetLanguage && (
                <p className="mt-2 text-xs italic text-muted-foreground" lang={message.language}>
                  {message.originalText}
                </p>
              )}
            </article>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No messages yet. Say hello or ask for help.</p>
        )}
      </div>
      <form action={sendAction} className="flex flex-col gap-2 border-t border-border-subtle p-4">
        <label className="sr-only" htmlFor="session-chat-message">Send a message</label>
        <textarea
          id="session-chat-message"
          className="resize-none rounded-md border border-border-strong bg-background p-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          name="message"
          rows={2}
          maxLength={1000}
          required
          placeholder="Write in your own language…"
        />
        <div className="flex items-center justify-between gap-3">
          {allowQuestions ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" name="kind" value="QUESTION" className="h-3.5 w-3.5" />
              Flag as a question for the facilitator
            </label>
          ) : (
            <span />
          )}
          <button className="font-data w-fit rounded-md bg-accent px-4 py-2 text-xs font-medium uppercase tracking-wider text-accent-foreground">
            Send
          </button>
        </div>
      </form>
    </aside>
  );
}
