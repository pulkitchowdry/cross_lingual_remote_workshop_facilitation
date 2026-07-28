"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { getDictionary, resolveLanguage } from "@/lib/i18n";
import { ChatSendButton } from "@/components/ChatSendButton";
import { CaptionComprehensionActions } from "@/components/CaptionComprehensionActions";
import { CHAT_MESSAGE_MAX_LENGTH, truncateForQuotedQuestion, type FormActionResult } from "@/lib/session-contracts";

type ChatMessage = {
  id: string;
  originalText: string;
  language: string;
  kind?: string;
  isAnonymous?: boolean;
  recipientId?: string | null;
  sender: { id: string; displayName: string };
  translations: Array<{ targetLanguage: string; text: string }>;
};

export type PrivateRecipientOption = {
  participantId: string;
  userId: string;
  displayName: string;
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
  embedded = false,
  viewerIsFacilitator = false,
  readOnly = false,
  viewerUserId,
  canMessageFacilitatorPrivately = false,
  privateRecipientOptions = [],
}: {
  messages: ChatMessage[];
  targetLanguage: string;
  sendAction: (prevState: FormActionResult, formData: FormData) => Promise<FormActionResult>;
  allowQuestions?: boolean;
  /** True when rendered inside the meeting sidebar's Chat tab instead of standalone next to the room. */
  embedded?: boolean;
  viewerIsFacilitator?: boolean;
  /** Hides the compose form — for a session that's already ENDED, where `sendAction`
   * would just reject every submission server-side (see sendChatMessage's own LIVE
   * guard) with nothing left in the room to send a message to. */
  readOnly?: boolean;
  viewerUserId?: string;
  canMessageFacilitatorPrivately?: boolean;
  privateRecipientOptions?: PrivateRecipientOption[];
}) {
  const dict = getDictionary(resolveLanguage(targetLanguage)).chat;
  const learnerDict = getDictionary(resolveLanguage(targetLanguage)).learner;
  const translationUnavailable = getDictionary(resolveLanguage(targetLanguage)).common.translationUnavailable;
  const Wrapper = embedded ? "div" : "aside";
  const privateModeStatusId = useId();
  const facilitatorRecipientSelectId = useId();
  const learnerPrivateCheckboxId = useId();
  const [learnerPrivateMode, setLearnerPrivateMode] = useState(false);
  const [selectedRecipientParticipantId, setSelectedRecipientParticipantId] = useState("");
  // Which messages have their "Explain simply"/"Give an example" quick-questions
  // revealed — same click-to-expand behavior as LiveTranscriptFeed's caption rows,
  // kept local to this panel since a chat message's revealed state has no reason to
  // survive a tab switch or an auto-refresh re-render.
  const [revealedMessageIds, setRevealedMessageIds] = useState<Set<string>>(new Set());
  function toggleRevealed(id: string) {
    setRevealedMessageIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const selectedRecipient = privateRecipientOptions.find((option) => option.participantId === selectedRecipientParticipantId);
  const recipientByUserId = useMemo(
    () => new Map(privateRecipientOptions.map((option) => [option.userId, option])),
    [privateRecipientOptions],
  );
  const isPrivateComposer = viewerIsFacilitator ? Boolean(selectedRecipient) : learnerPrivateMode;
  const privateModeStatus = viewerIsFacilitator
    ? selectedRecipient
      ? dict.privateModeTo(selectedRecipient.displayName)
      : dict.publicMode
    : learnerPrivateMode
      ? dict.privateModeToFacilitator
      : dict.publicMode;
  // Expected, routine failures (rate limited, session ended mid-type) now come back
  // as state instead of a thrown Error — see FormActionResult's doc comment for why
  // that matters: without this, any of them took down the whole page, video call
  // included, instead of showing an inline message next to the textarea.
  const [state, formAction] = useActionState<FormActionResult, FormData>(sendAction, { error: null });

  return (
    // `h-full` — this is now always nested inside either MeetingSidebar's own
    // docked panel or SessionSidePanel.tsx's tab container, both of which already
    // bound the height themselves (SessionSidePanel's is a fixed clamp, matching
    // LiveSessionRoom's own, so the two line up side by side and the messages list
    // below scrolls internally instead of growing without limit). The static
    // "Translated chat" header this used to render on its own is now whichever
    // external label the caller supplies (MeetingSidebar's "Chat" bar,
    // SessionSidePanel's chatTabLabel tab button), so it isn't repeated here too.
    <Wrapper className={embedded ? "flex h-full min-h-0 flex-col" : "flex h-full flex-col rounded-lg border border-border-subtle bg-surface-raised"}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4" aria-live="polite">
        {messages.length > 0 ? (
          messages.map((message) => {
            // A learner can ask "Explain simply"/"Give an example" about anyone else's
            // message (mirrors CaptionComprehensionActions for captions — see
            // TranslationHistoryTab), but not their own words, and never once the
            // composer itself is gone (readOnly: nothing left in the room to answer).
            // Also never on a PRIVATE message (message.recipientId set — either the
            // learner's own private-to-facilitator message, already excluded above by
            // the sender check, or a facilitator's private reply addressed to this
            // learner): the generated question always resends the quoted text as a
            // fully PUBLIC chat message, so offering it here would silently republish
            // private message content to the entire session.
            const isExplainable =
              !viewerIsFacilitator && !readOnly && message.sender.id !== viewerUserId && !message.recipientId;
            const revealed = isExplainable && revealedMessageIds.has(message.id);
            const quotedText = translatedText(message, targetLanguage, translationUnavailable);
            return (
              <article key={message.id} className="rounded-md border border-border-subtle bg-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-data text-xs font-medium text-[var(--accent-text)]">
                    {message.isAnonymous && !viewerIsFacilitator ? dict.anonymousLearner : message.sender.displayName}
                  </p>
                  <div className="flex items-center gap-1.5">
                    {message.recipientId && (
                      // Distinct accent color from the Anonymous badge below (previously
                      // byte-for-byte identical styling) — "who can see this" and "is the
                      // name hidden" are different facts about a message, and looked alike
                      // enough in a fast-scrolling chat to be easy to mix up at a glance.
                      <span className="font-data rounded-full border border-accent px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--accent-text)]">
                        {dict.privateBadge}
                      </span>
                    )}
                    {message.isAnonymous && viewerIsFacilitator && (
                      <span className="font-data rounded-full border border-border-strong px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {dict.anonymousBadge}
                      </span>
                    )}
                    {message.kind === "QUESTION" && (
                      <span className="font-data rounded-full border border-accent px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--accent-text)]">
                        {dict.question}
                      </span>
                    )}
                  </div>
                </div>
                {isExplainable ? (
                  <button
                    type="button"
                    aria-expanded={revealed}
                    onClick={() => toggleRevealed(message.id)}
                    className="mt-1 block w-full rounded-md text-left hover:bg-surface-raised"
                  >
                    <p className="whitespace-pre-wrap text-sm leading-relaxed" lang={targetLanguage}>
                      {quotedText}
                    </p>
                    {message.language !== targetLanguage && (
                      <p className="mt-2 whitespace-pre-wrap text-xs italic text-muted-foreground" lang={message.language}>
                        {message.originalText}
                      </p>
                    )}
                  </button>
                ) : (
                  <>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed" lang={targetLanguage}>
                      {quotedText}
                    </p>
                    {message.language !== targetLanguage && (
                      <p className="mt-2 whitespace-pre-wrap text-xs italic text-muted-foreground" lang={message.language}>
                        {message.originalText}
                      </p>
                    )}
                  </>
                )}
                {revealed && (
                  <div className="mt-2">
                    <CaptionComprehensionActions
                      sendAction={sendAction}
                      explainSimplyLabel={learnerDict.explainSimply}
                      giveExampleLabel={learnerDict.giveExample}
                      sendingLabel={dict.sending}
                      // Quote message.originalText, not the resolved/translated
                      // `quotedText` — quotedText can hold the localized "Translation
                      // unavailable" placeholder (or generally the translated text),
                      // which should never end up quoted in the generated question.
                      // Matches the caption flow's use of segment.originalText
                      // (TranslationHistoryTab.tsx / learn/page.tsx).
                      explainSimplyMessage={learnerDict.explainSimplyQuestion(truncateForQuotedQuestion(message.originalText))}
                      giveExampleMessage={learnerDict.giveExampleQuestion(truncateForQuotedQuestion(message.originalText))}
                    />
                  </div>
                )}
                {viewerIsFacilitator && message.sender.id !== viewerUserId && recipientByUserId.has(message.sender.id) && (
                  <button
                    type="button"
                    className="font-data mt-3 rounded-md border border-border-strong px-2.5 py-1 text-[0.6875rem] font-medium uppercase tracking-wider text-foreground hover:border-accent hover:text-[var(--accent-text)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                    onClick={() => {
                      const recipient = recipientByUserId.get(message.sender.id);
                      if (recipient) setSelectedRecipientParticipantId(recipient.participantId);
                    }}
                  >
                    {dict.replyPrivately}
                  </button>
                )}
              </article>
            );
          })
        ) : (
          <p className="text-sm text-muted-foreground">{dict.noMessages}</p>
        )}
      </div>
      {!readOnly && (
      <form action={formAction} className="flex flex-col gap-2 border-t border-border-subtle p-4">
        <label className="sr-only" htmlFor="session-chat-message">{dict.sendMessageLabel}</label>
        {isPrivateComposer && <input type="hidden" name="visibility" value="PRIVATE" />}
        {selectedRecipient && <input type="hidden" name="recipientParticipantId" value={selectedRecipient.participantId} />}
        <textarea
          id="session-chat-message"
          className="resize-none rounded-md border border-border-strong bg-background p-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          name="message"
          rows={2}
          maxLength={CHAT_MESSAGE_MAX_LENGTH}
          required
          placeholder={dict.placeholder}
        />
        {state.error && (
          <p className="text-xs" role="alert" style={{ color: "var(--tick-low)" }}>
            {state.error}
          </p>
        )}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2" aria-live="polite" id={privateModeStatusId}>
            <span className="font-data rounded-full border border-border-strong px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {privateModeStatus}
            </span>
            {isPrivateComposer && (
              <button
                type="button"
                className="font-data rounded-md border border-border-strong px-2.5 py-1 text-[0.6875rem] font-medium uppercase tracking-wider text-foreground hover:border-accent hover:text-[var(--accent-text)] focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                onClick={() => {
                  setLearnerPrivateMode(false);
                  setSelectedRecipientParticipantId("");
                }}
              >
                {dict.returnToPublic}
              </button>
            )}
          </div>
          <div className="flex items-end justify-between gap-3">
            <div className="flex flex-col gap-1">
              {allowQuestions && (
                <>
                  <div>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input type="checkbox" name="kind" value="QUESTION" className="h-3.5 w-3.5 accent-[var(--accent)]" />
                      {dict.flagQuestion}
                    </label>
                    {/* Sits right above "message facilitator privately" below — without this,
                        checking only this one reads as if it might also narrow the audience. */}
                    <p className="ml-[22px] text-[11px] text-muted-foreground/80">{dict.flagQuestionHint}</p>
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input type="checkbox" name="isAnonymous" value="true" className="h-3.5 w-3.5 accent-[var(--accent)]" />
                      {dict.askAnonymously}
                    </label>
                    <p className="ml-[22px] text-[11px] text-muted-foreground/80">{dict.askAnonymouslyHint}</p>
                  </div>
                </>
              )}
              {canMessageFacilitatorPrivately && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground" htmlFor={learnerPrivateCheckboxId}>
                  <input
                    id={learnerPrivateCheckboxId}
                    type="checkbox"
                    checked={learnerPrivateMode}
                    onChange={(event) => setLearnerPrivateMode(event.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-accent/30"
                    aria-describedby={privateModeStatusId}
                  />
                  {dict.messageFacilitatorPrivately}
                </label>
              )}
              {viewerIsFacilitator && privateRecipientOptions.length > 0 && (
                <label className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor={facilitatorRecipientSelectId}>
                  {dict.recipientLabel}
                  <select
                    id={facilitatorRecipientSelectId}
                    value={selectedRecipientParticipantId}
                    onChange={(event) => setSelectedRecipientParticipantId(event.target.value)}
                    className="rounded-md border border-border-strong bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
                    aria-describedby={privateModeStatusId}
                  >
                    <option value="">{dict.everyone}</option>
                    {privateRecipientOptions.map((option) => (
                      <option key={option.participantId} value={option.participantId}>
                        {option.displayName}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <ChatSendButton label={dict.send} sendingLabel={dict.sending} />
          </div>
        </div>
      </form>
      )}
    </Wrapper>
  );
}
