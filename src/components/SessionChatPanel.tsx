"use client";

import { useActionState } from "react";
import { getDictionary, resolveLanguage } from "@/lib/i18n";
import { ChatSendButton } from "@/components/ChatSendButton";
import type { FormActionResult } from "@/lib/session-contracts";

type ChatMessage = {
  id: string;
  originalText: string;
  language: string;
  kind?: string;
  sender: { displayName: string };
  translations: Array<{ targetLanguage: string; text: string }>;
};

function translatedText(message: ChatMessage, targetLanguage: string, translationUnavailable: string) {
  return (
    message.translations.find((translation) => translation.targetLanguage === targetLanguage)?.text ??
    (message.language === targetLanguage ? message.originalText : translationUnavailable)
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
  sendAction: (prevState: FormActionResult, formData: FormData) => Promise<FormActionResult>;
  allowQuestions?: boolean;
}) {
  const dict = getDictionary(resolveLanguage(targetLanguage)).chat;
  const translationUnavailable = getDictionary(resolveLanguage(targetLanguage)).common.translationUnavailable;
  // Expected, routine failures (rate limited, session ended mid-type) now come back
  // as state instead of a thrown Error — see FormActionResult's doc comment for why
  // that matters: without this, any of them took down the whole page, video call
  // included, instead of showing an inline message next to the textarea.
  const [state, formAction] = useActionState<FormActionResult, FormData>(sendAction, { error: null });

  return (
    <aside className="flex min-h-[38rem] flex-col rounded-lg border border-border-subtle bg-surface-raised">
      <div className="border-b border-border-subtle px-4 py-3">
        <p className="font-data text-xs font-medium uppercase tracking-wider text-muted-foreground">{dict.translatedChat}</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4" aria-live="polite">
        {messages.length > 0 ? (
          messages.map((message) => (
            <article key={message.id} className="rounded-md border border-border-subtle bg-background p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-data text-xs font-medium text-[var(--accent-text)]">{message.sender.displayName}</p>
                {message.kind === "QUESTION" && (
                  <span className="font-data rounded-full border border-accent px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--accent-text)]">
                    {dict.question}
                  </span>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed" lang={targetLanguage}>
                {translatedText(message, targetLanguage, translationUnavailable)}
              </p>
              {message.language !== targetLanguage && (
                <p className="mt-2 whitespace-pre-wrap text-xs italic text-muted-foreground" lang={message.language}>
                  {message.originalText}
                </p>
              )}
            </article>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">{dict.noMessages}</p>
        )}
      </div>
      <form action={formAction} className="flex flex-col gap-2 border-t border-border-subtle p-4">
        <label className="sr-only" htmlFor="session-chat-message">{dict.sendMessageLabel}</label>
        <textarea
          id="session-chat-message"
          className="resize-none rounded-md border border-border-strong bg-background p-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          name="message"
          rows={2}
          maxLength={1000}
          required
          placeholder={dict.placeholder}
        />
        {state.error && (
          <p className="text-xs" role="alert" style={{ color: "var(--tick-low)" }}>
            {state.error}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          {allowQuestions ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" name="kind" value="QUESTION" className="h-3.5 w-3.5" />
              {dict.flagQuestion}
            </label>
          ) : (
            <span />
          )}
          <ChatSendButton label={dict.send} sendingLabel={dict.sending} />
        </div>
      </form>
    </aside>
  );
}
