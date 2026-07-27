import { ParticipantRole, SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/session-security";
import { isSessionRetentionExpired } from "@/lib/session-retention";

const FACILITATOR_COOKIE_PREFIX = "workshop-facilitator-";

export type SessionOverviewCookie = {
  name: string;
  value: string;
};

export type FacilitatorSessionOverviewItem = {
  id: string;
  title: string;
  goal: string;
  status: SessionStatus;
  sourceLanguage: string;
  learnerCount: number;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
};

export type FacilitatorSessionOverview = {
  active: FacilitatorSessionOverviewItem[];
  completed: FacilitatorSessionOverviewItem[];
};

type VerifiedCookie = {
  sessionId: string;
  tokenHash: string;
};

function facilitatorSessionIdFromCookieName(name: string) {
  if (!name.startsWith(FACILITATOR_COOKIE_PREFIX)) return null;
  const sessionId = name.slice(FACILITATOR_COOKIE_PREFIX.length);
  return sessionId.length > 0 ? sessionId : null;
}

function uniqueVerifiedCookies(cookies: SessionOverviewCookie[]): VerifiedCookie[] {
  const bySessionId = new Map<string, VerifiedCookie>();

  for (const cookie of cookies) {
    const sessionId = facilitatorSessionIdFromCookieName(cookie.name);
    if (!sessionId || !cookie.value) continue;
    bySessionId.set(sessionId, { sessionId, tokenHash: hashToken(cookie.value) });
  }

  return [...bySessionId.values()];
}

function descendingTimestamp(date: Date | null | undefined) {
  return date?.getTime() ?? 0;
}

function sortActiveSessions(a: FacilitatorSessionOverviewItem, b: FacilitatorSessionOverviewItem) {
  const statusPriority = {
    [SessionStatus.LIVE]: 0,
    [SessionStatus.DRAFT]: 1,
    [SessionStatus.ENDED]: 2,
  };
  const priorityDelta = statusPriority[a.status] - statusPriority[b.status];
  if (priorityDelta !== 0) return priorityDelta;
  return descendingTimestamp(b.startedAt ?? b.createdAt) - descendingTimestamp(a.startedAt ?? a.createdAt);
}

function sortCompletedSessions(a: FacilitatorSessionOverviewItem, b: FacilitatorSessionOverviewItem) {
  return descendingTimestamp(b.endedAt ?? b.createdAt) - descendingTimestamp(a.endedAt ?? a.createdAt);
}

export async function listFacilitatorSessionOverview(
  cookies: SessionOverviewCookie[],
  now: Date = new Date(),
): Promise<FacilitatorSessionOverview> {
  const cookieCredentials = uniqueVerifiedCookies(cookies);
  if (cookieCredentials.length === 0) return { active: [], completed: [] };

  const validLinks = await prisma.joinLink.findMany({
    where: {
      role: ParticipantRole.FACILITATOR,
      revokedAt: null,
      tokenHash: { in: cookieCredentials.map((cookie) => cookie.tokenHash) },
      OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
    },
    select: { sessionId: true, tokenHash: true },
  });

  const validSessionIds = new Set(
    cookieCredentials
      .filter((cookie) =>
        validLinks.some((link) => link.sessionId === cookie.sessionId && link.tokenHash === cookie.tokenHash),
      )
      .map((cookie) => cookie.sessionId),
  );

  if (validSessionIds.size === 0) return { active: [], completed: [] };

  const sessions = await prisma.session.findMany({
    where: { id: { in: [...validSessionIds] } },
    select: {
      id: true,
      title: true,
      goal: true,
      status: true,
      sourceLanguage: true,
      retentionDays: true,
      createdAt: true,
      startedAt: true,
      endedAt: true,
    },
  });

  if (sessions.length === 0) return { active: [], completed: [] };

  const learnerCounts = await prisma.sessionParticipant.groupBy({
    by: ["sessionId"],
    where: { sessionId: { in: sessions.map((session) => session.id) }, role: ParticipantRole.LEARNER },
    _count: { _all: true },
  });
  const learnerCountBySessionId = new Map(learnerCounts.map((row) => [row.sessionId, row._count._all]));

  const visibleSessions = sessions
    .filter((session) => !isSessionRetentionExpired(session, now))
    .map((session) => ({
      id: session.id,
      title: session.title,
      goal: session.goal,
      status: session.status,
      sourceLanguage: session.sourceLanguage,
      learnerCount: learnerCountBySessionId.get(session.id) ?? 0,
      createdAt: session.createdAt,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
    }));

  return {
    active: visibleSessions
      .filter((session) => session.status === SessionStatus.DRAFT || session.status === SessionStatus.LIVE)
      .sort(sortActiveSessions),
    completed: visibleSessions
      .filter((session) => session.status === SessionStatus.ENDED)
      .sort(sortCompletedSessions),
  };
}
