import type { CreateSessionInput, JoinSessionInput, SessionRole } from "@/lib/session-contracts";

/**
 * Server-only persistence boundary. Its Prisma implementation is intentionally
 * deferred until Prisma is installed and DATABASE_URL is provisioned.
 * Client components must call route handlers/server actions, never this module.
 */
export interface SessionRepository {
  createSession(input: CreateSessionInput, facilitatorId: string): Promise<{
    sessionId: string;
    learnerJoinToken: string;
  }>;
  joinSession(token: string, input: JoinSessionInput): Promise<{
    sessionId: string;
    role: SessionRole;
  }>;
  revokeJoinLink(sessionId: string, joinLinkId: string, actorId: string): Promise<void>;
}
