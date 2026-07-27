"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Card } from "@/components/ui/Card";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { SUPPORTED_LANGUAGES } from "@/lib/session-contracts";
import type { Dictionary } from "@/lib/i18n";
import type { GlossaryFormResult, GlossaryUploadResult } from "@/app/sessions/[sessionId]/facilitator/glossary/actions";

export interface GlossaryEntryView {
  id: string;
  sourceTerm: string;
  category: string | null;
  notes: string | null;
  translate: boolean;
  translations: Record<string, string>;
  isBuiltIn: boolean;
}

type Dict = Dictionary["glossary"];

/**
 * The Centralised Technical Glossary management page (issue #131) — search,
 * add/edit/delete, and bulk CSV upload, all client-side state layered over
 * Server Actions passed down from the page. A single component rather than
 * splitting table/form/upload into separate files: the add/edit form and the
 * table share the same `editingId` selection state, and there's no other
 * page that reuses any piece of this in isolation.
 */
export function GlossaryManager({
  entries,
  dict,
  saveAction,
  deleteAction,
  uploadAction,
}: {
  entries: GlossaryEntryView[];
  dict: Dict;
  saveAction: (entryId: string | null, prevState: GlossaryFormResult, formData: FormData) => Promise<GlossaryFormResult>;
  deleteAction: (entryId: string) => Promise<void>;
  uploadAction: (prevState: GlossaryUploadResult, formData: FormData) => Promise<GlossaryUploadResult>;
}) {
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null | "new">(null);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter(
      (entry) =>
        entry.sourceTerm.toLowerCase().includes(needle) ||
        entry.category?.toLowerCase().includes(needle) ||
        Object.values(entry.translations).some((value) => value.toLowerCase().includes(needle)),
    );
  }, [entries, search]);

  const editingEntry = typeof editingId === "string" ? entries.find((entry) => entry.id === editingId) ?? null : null;
  const isFormOpen = editingId !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          className="flex-1 rounded-md border border-border-strong bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          placeholder={dict.searchPlaceholder}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label={dict.searchPlaceholder}
        />
        <button
          type="button"
          onClick={() => setEditingId("new")}
          className="font-data rounded-md bg-accent-fill px-4 py-2 text-xs font-medium uppercase tracking-wider text-accent-foreground"
        >
          {dict.addEntry}
        </button>
      </div>

      {isFormOpen && (
        <GlossaryEntryForm
          key={editingId}
          entry={editingEntry}
          dict={dict}
          saveAction={saveAction}
          onDone={() => setEditingId(null)}
        />
      )}

      <Card>
        {filtered.length === 0 ? (
          <p className="text-muted-foreground">{dict.emptyState}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead>
                <tr className="font-data text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="pb-2 pr-3">{dict.tableSourceTerm}</th>
                  <th className="pb-2 pr-3">{dict.tableCategory}</th>
                  <th className="pb-2 pr-3">{dict.tableTranslations}</th>
                  <th className="pb-2">{dict.tableActions}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr key={entry.id} className="border-t border-border-subtle align-top">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{entry.sourceTerm}</span>
                      {entry.isBuiltIn && (
                        <span className="font-data ml-2 rounded-full border border-border-strong px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                          {dict.builtInBadge}
                        </span>
                      )}
                      {!entry.translate && (
                        <span className="font-data ml-2 rounded-full border border-border-strong px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                          {dict.verbatimBadge}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{entry.category ?? "—"}</td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {entry.translate && Object.keys(entry.translations).length > 0
                        ? Object.entries(entry.translations)
                            .map(([lang, value]) => `${lang}: ${value}`)
                            .join(" · ")
                        : "—"}
                    </td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(entry.id)}
                          className="font-data rounded-md border border-border-strong px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-foreground hover:border-accent hover:text-accent"
                        >
                          {dict.editEntry}
                        </button>
                        <form action={deleteAction.bind(null, entry.id)}>
                          <ConfirmSubmitButton
                            label={dict.deleteEntry}
                            pendingLabel={dict.deleteEntry}
                            title={dict.confirmDeleteTitle}
                            body={dict.confirmDeleteBody.replace("{term}", entry.sourceTerm)}
                            confirmLabel={dict.deleteEntry}
                            cancelLabel={dict.formCancel}
                            variant="danger"
                          />
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <GlossaryUploadForm dict={dict} uploadAction={uploadAction} />
    </div>
  );
}

function GlossaryEntryForm({
  entry,
  dict,
  saveAction,
  onDone,
}: {
  entry: GlossaryEntryView | null;
  dict: Dict;
  saveAction: (entryId: string | null, prevState: GlossaryFormResult, formData: FormData) => Promise<GlossaryFormResult>;
  onDone: () => void;
}) {
  const boundAction = saveAction.bind(null, entry?.id ?? null);
  const [state, formAction, isPending] = useActionState<GlossaryFormResult, FormData>(boundAction, { error: null });
  const [translate, setTranslate] = useState(entry?.translate ?? true);
  // Closes the form once a submission finishes without error — can't just await
  // formAction (useActionState's dispatcher returns void, not the action's result),
  // so this watches the pending->settled transition instead.
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && !state.error) onDone();
    wasPending.current = isPending;
  }, [isPending, state.error, onDone]);

  return (
    <Card eyebrow={entry ? dict.editEntry : dict.addEntry}>
      <form action={formAction} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {dict.formSourceTermLabel}
          <input
            name="sourceTerm"
            required
            defaultValue={entry?.sourceTerm}
            className="rounded-md border border-border-strong bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            {dict.formCategoryLabel}
            <input
              name="category"
              defaultValue={entry?.category ?? ""}
              className="rounded-md border border-border-strong bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {dict.formNotesLabel}
            <input
              name="notes"
              defaultValue={entry?.notes ?? ""}
              className="rounded-md border border-border-strong bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
          </label>
        </div>
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="mb-1">{dict.formTranslateLabel}</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="translate"
              value="translate"
              checked={translate}
              onChange={() => setTranslate(true)}
            />
            {dict.formTranslateNormally}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="translate"
              value="verbatim"
              checked={!translate}
              onChange={() => setTranslate(false)}
            />
            {dict.formTranslateVerbatim}
          </label>
        </fieldset>
        {translate && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">{dict.formTranslationsHint}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {SUPPORTED_LANGUAGES.map(({ value, label }) => (
                <label key={value} className="flex flex-col gap-1 text-sm">
                  {label}
                  <input
                    name={`translation_${value}`}
                    defaultValue={entry?.translations[value] ?? ""}
                    className="rounded-md border border-border-strong bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
                  />
                </label>
              ))}
            </div>
          </div>
        )}
        {state.error && (
          <p className="text-xs" role="alert" style={{ color: "var(--tick-low)" }}>
            {state.error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onDone}
            className="font-data rounded-md border border-border-strong px-4 py-2 text-xs font-medium uppercase tracking-wider text-foreground hover:bg-background"
          >
            {dict.formCancel}
          </button>
          <SubmitButton label={dict.formSave} />
        </div>
      </form>
    </Card>
  );
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="font-data rounded-md bg-accent-fill px-4 py-2 text-xs font-medium uppercase tracking-wider text-accent-foreground disabled:opacity-40"
    >
      {label}
    </button>
  );
}

function GlossaryUploadForm({
  dict,
  uploadAction,
}: {
  dict: Dict;
  uploadAction: (prevState: GlossaryUploadResult, formData: FormData) => Promise<GlossaryUploadResult>;
}) {
  const [state, formAction] = useActionState<GlossaryUploadResult, FormData>(uploadAction, {
    error: null,
    addedOrUpdated: 0,
  });

  return (
    <Card eyebrow={dict.uploadHeading}>
      <form action={formAction} className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">{dict.uploadHint}</span>
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            className="rounded-md border border-border-strong bg-background px-3 py-2 text-sm text-foreground"
          />
        </label>
        <SubmitButton label={dict.uploadButton} />
      </form>
      {state.error && (
        <p className="mt-2 text-xs" role="alert" style={{ color: "var(--tick-low)" }}>
          {state.error}
        </p>
      )}
      {!state.error && state.addedOrUpdated > 0 && (
        <p className="mt-2 text-xs" style={{ color: "var(--tick-high)" }}>
          {dict.uploadSuccess.replace("{count}", String(state.addedOrUpdated))}
        </p>
      )}
    </Card>
  );
}
