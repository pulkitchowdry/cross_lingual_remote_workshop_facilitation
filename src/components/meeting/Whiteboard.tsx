"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDataChannel, useRoomInfo } from "@livekit/components-react";
import type { ReceivedDataMessage } from "@livekit/components-core";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI, SceneData } from "@excalidraw/excalidraw/types";
import { saveWhiteboardSnapshot } from "@/app/sessions/actions";
import { parseRoomMetadata, parseSenderRole } from "@/components/meeting/room-metadata";
import { getDictionary } from "@/lib/i18n";
import type { SupportedLanguage } from "@/lib/session-contracts";

// Excalidraw touches canvas/window at import time — must never run during SSR.
const Excalidraw = dynamic(() => import("@excalidraw/excalidraw").then((mod) => mod.Excalidraw), { ssr: false });

const BROADCAST_THROTTLE_MS = 150;
const SNAPSHOT_SAVE_DEBOUNCE_MS = 3_000;
const TEXT_SETTLE_DEBOUNCE_MS = 800;

type WhiteboardCustomData = {
  sourceLanguage?: SupportedLanguage;
  sourceText?: string;
  translations?: Partial<Record<SupportedLanguage, string>>;
};

/** Only text elements carry translation metadata; everything else (shapes, arrows, freedraw) passes through untouched. */
function substituteForViewer(
  elements: readonly ExcalidrawElement[],
  viewerLang: SupportedLanguage,
  viewOnly: boolean,
): ExcalidrawElement[] {
  if (!viewOnly) return elements as ExcalidrawElement[];
  return elements.map((element) => {
    if (element.type !== "text") return element;
    const customData = element.customData as WhiteboardCustomData | undefined;
    if (!customData?.sourceLanguage || customData.sourceLanguage === viewerLang) return element;
    const translated = customData.translations?.[viewerLang];
    if (!translated) return element;
    return { ...element, text: translated } as ExcalidrawElement;
  });
}

/** Upserts incoming partial/full elements by id — a translation result is a `{id, customData}` patch; a drawing update is a full element. */
function mergeElements(existing: readonly ExcalidrawElement[], incoming: unknown[]): ExcalidrawElement[] {
  const byId = new Map(existing.map((element) => [element.id, element]));
  for (const raw of incoming) {
    const patch = raw as Partial<ExcalidrawElement> & { id?: string };
    if (!patch.id) continue;
    const current = byId.get(patch.id);
    byId.set(
      patch.id,
      current
        ? ({ ...current, ...patch, customData: { ...current.customData, ...patch.customData } } as ExcalidrawElement)
        : (patch as ExcalidrawElement),
    );
  }
  return Array.from(byId.values());
}

export function Whiteboard({
  sessionId,
  uiLang,
  canPresent,
}: {
  sessionId: string;
  uiLang: SupportedLanguage;
  canPresent: boolean;
}) {
  const dict = getDictionary(uiLang).meeting;
  const { metadata } = useRoomInfo();
  const { allowLearnerPresenting } = parseRoomMetadata(metadata);

  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const [initialElements, setInitialElements] = useState<ExcalidrawElement[] | null>(null);

  const isApplyingRemoteRef = useRef(false);
  const lastVersionsRef = useRef(new Map<string, number>());
  const broadcastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBroadcastRef = useRef(new Map<string, ExcalidrawElement>());
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textSettleTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lastTranslatedTextRef = useRef(new Map<string, string>());

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/whiteboard/${sessionId}`)
      .then((response) => response.json())
      .then((data: { elements?: ExcalidrawElement[] }) => {
        if (cancelled) return;
        const elements = data.elements ?? [];
        elements.forEach((element) => lastVersionsRef.current.set(element.id, element.version));
        setInitialElements(elements);
      })
      .catch(() => {
        if (!cancelled) setInitialElements([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const applyIncoming = useCallback(
    (elements: unknown[]) => {
      if (!excalidrawAPI) return;
      const merged = mergeElements(excalidrawAPI.getSceneElementsIncludingDeleted(), elements);
      merged.forEach((element) => lastVersionsRef.current.set(element.id, element.version));
      const display = substituteForViewer(merged, uiLang, !canPresent);
      isApplyingRemoteRef.current = true;
      // "NEVER" == CaptureUpdateAction.NEVER, inlined as a literal so this file never imports
      // @excalidraw/excalidraw's runtime value export — that pulls in the whole package
      // (which touches `window` at module scope) even in a "use client" file, since Next.js
      // still evaluates client component modules during SSR to produce the initial HTML.
      excalidrawAPI.updateScene({ elements: display, captureUpdate: "NEVER" as SceneData["captureUpdate"] });
      queueMicrotask(() => {
        isApplyingRemoteRef.current = false;
      });
    },
    [excalidrawAPI, uiLang, canPresent],
  );

  const { send } = useDataChannel(
    "whiteboard",
    useCallback(
      (message: ReceivedDataMessage<"whiteboard">) => {
        // Server-originated broadcasts (translation results) have no `.from` — always trusted.
        // Client-originated ones only count if the sender currently has drawing rights, so a
        // learner without presenting access can't corrupt everyone else's board by publishing
        // directly (canPublishData is granted symmetrically — see room.ts).
        if (message.from) {
          const senderRole = parseSenderRole(message.from.identity);
          const senderCanPresent = senderRole === "facilitator" || (senderRole === "learner" && allowLearnerPresenting);
          if (!senderCanPresent) return;
        }
        try {
          const parsed = JSON.parse(new TextDecoder().decode(message.payload)) as {
            type?: string;
            elements?: unknown[];
          };
          if (parsed.type !== "whiteboard-elements" || !Array.isArray(parsed.elements)) return;
          applyIncoming(parsed.elements);
        } catch (error) {
          console.error("[whiteboard] failed to apply remote update:", error);
        }
      },
      [allowLearnerPresenting, applyIncoming],
    ),
  );

  const scheduleBroadcast = useCallback(
    (changed: ExcalidrawElement[]) => {
      changed.forEach((element) => pendingBroadcastRef.current.set(element.id, element));
      if (broadcastTimerRef.current) return;
      broadcastTimerRef.current = setTimeout(() => {
        const toSend = Array.from(pendingBroadcastRef.current.values());
        pendingBroadcastRef.current.clear();
        broadcastTimerRef.current = null;
        const payload = new TextEncoder().encode(JSON.stringify({ type: "whiteboard-elements", elements: toSend }));
        void send(payload, { reliable: true });
      }, BROADCAST_THROTTLE_MS);
    },
    [send],
  );

  const scheduleSnapshotSave = useCallback(
    (elements: readonly ExcalidrawElement[]) => {
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
      snapshotTimerRef.current = setTimeout(() => {
        void saveWhiteboardSnapshot(sessionId, elements as unknown[]);
      }, SNAPSHOT_SAVE_DEBOUNCE_MS);
    },
    [sessionId],
  );

  const translateElement = useCallback(
    async (element: ExcalidrawElement) => {
      const text = (element as unknown as { text?: string }).text ?? "";
      if (!text.trim()) return;
      if (lastTranslatedTextRef.current.get(element.id) === text) return;
      lastTranslatedTextRef.current.set(element.id, text);
      try {
        const response = await fetch("/api/whiteboard/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, elementId: element.id, sourceText: text, sourceLanguage: uiLang }),
        });
        if (!response.ok) return;
        const result = (await response.json()) as { elementId: string; customData: WhiteboardCustomData };
        applyIncoming([{ id: result.elementId, customData: result.customData }]);
      } catch (error) {
        console.error("[whiteboard] translation request failed:", error);
      }
    },
    [sessionId, uiLang, applyIncoming],
  );

  const scheduleTextSettleCheck = useCallback(
    (changed: ExcalidrawElement[]) => {
      for (const element of changed) {
        if (element.type !== "text" || element.isDeleted) continue;
        const existing = textSettleTimersRef.current.get(element.id);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
          textSettleTimersRef.current.delete(element.id);
          void translateElement(element);
        }, TEXT_SETTLE_DEBOUNCE_MS);
        textSettleTimersRef.current.set(element.id, timer);
      }
    },
    [translateElement],
  );

  const onChange = useCallback(
    (elements: readonly ExcalidrawElement[]) => {
      // This fire is us applying a remote update to our own scene, not a local edit — the
      // ref guard set in applyIncoming() means we must not re-broadcast it (would echo forever).
      if (isApplyingRemoteRef.current) return;
      const changed: ExcalidrawElement[] = [];
      for (const element of elements) {
        if (lastVersionsRef.current.get(element.id) !== element.version) {
          changed.push(element);
          lastVersionsRef.current.set(element.id, element.version);
        }
      }
      if (changed.length === 0) return;
      scheduleBroadcast(changed);
      scheduleSnapshotSave(elements);
      if (canPresent) scheduleTextSettleCheck(changed);
    },
    [canPresent, scheduleBroadcast, scheduleSnapshotSave, scheduleTextSettleCheck],
  );

  if (initialElements === null) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
        {dict.whiteboardLoading}
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex-1 overflow-hidden rounded-lg border border-border-subtle">
      <Excalidraw
        excalidrawAPI={setExcalidrawAPI}
        initialData={{ elements: substituteForViewer(initialElements, uiLang, !canPresent) }}
        viewModeEnabled={!canPresent}
        onChange={onChange}
      />
    </div>
  );
}
