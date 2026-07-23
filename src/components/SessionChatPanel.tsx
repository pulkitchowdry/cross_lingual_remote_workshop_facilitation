type ChatMessage = {
  id: string;
  originalText: string;
  language: string;
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
}: {
  messages: ChatMessage[];
  targetLanguage: string;
  sendAction: (formData: FormData) => void | Promise<void>;
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
              <p className="font-data text-xs font-medium text-accent">{message.sender.displayName}</p>
              <p className="mt-1 text-sm leading-relaxed">{translatedText(message, targetLanguage)}</p>
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
        <button className="font-data w-fit rounded-md bg-accent px-4 py-2 text-xs font-medium uppercase tracking-wider text-accent-foreground">
          Send
        </button>
      </form>
    </aside>
  );
}
