import { NextRequest } from "next/server";
import { SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { publishTranslatedCaption } from "@/lib/captions";
import { secureCompare } from "@/lib/session-security";
import type { SupportedLanguage } from "@/lib/session-contracts";

/**
 * Internal server-to-server API for the standalone LiveKit Agents worker
 * (`agent/`) — Part 2 of `docs/TRANSLATION_ARCHITECTURE.md`. The worker runs
 * as its own Node process (not bundled by Next.js) and, in an earlier draft
 * of this endpoint, tried importing `@/lib/db` and `@/lib/captions` directly.
 * That failed in testing: the generated Prisma client's `export * from
 * "./enums"` doesn't propagate through tsx/esbuild's module resolution the
 * way it does through Next's bundler, so `SessionStatus` came back
 * `undefined` outside of Next. Routing through HTTP, authenticated with a
 * shared secret, sidesteps that entirely and keeps the worker's only
 * dependency on this codebase to the STT provider (which has no Prisma
 * import and resolves fine under tsx).
 */
function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.CAPTION_AGENT_SECRET;
  const provided = request.headers.get("x-caption-agent-secret");
  if (!expected || !provided) return false;
  return secureCompare(provided, expected);
}

/** Lets the worker check whether a session is live and what language to request from Deepgram. */
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return Response.json({ error: "sessionId is required." }, { status: 400 });
  }

  const session = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!session) return Response.json({ error: "Session not found." }, { status: 404 });

  return Response.json({
    isLive: session.status === SessionStatus.LIVE,
    sourceLanguage: session.sourceLanguage,
    translationMode: session.translationMode,
  });
}

/** Publishes one final transcript segment the worker captured from the facilitator's track. */
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await request.json()) as {
    sessionId?: unknown;
    originalText?: unknown;
    startedAt?: unknown;
    endedAt?: unknown;
  };
  if (
    typeof body.sessionId !== "string" ||
    typeof body.originalText !== "string" ||
    !body.originalText.trim() ||
    typeof body.startedAt !== "string" ||
    typeof body.endedAt !== "string"
  ) {
    return Response.json({ error: "Invalid caption payload." }, { status: 400 });
  }

  const session = await prisma.session.findUnique({ where: { id: body.sessionId } });
  if (!session || session.status !== SessionStatus.LIVE) {
    return Response.json({ error: "Session is not live." }, { status: 409 });
  }

  await publishTranslatedCaption(session, {
    speakerId: "Facilitator",
    originalText: body.originalText.trim(),
    language: session.sourceLanguage as SupportedLanguage,
    startedAt: new Date(body.startedAt),
    endedAt: new Date(body.endedAt),
  });

  return Response.json({ ok: true });
}
