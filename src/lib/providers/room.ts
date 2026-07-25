import { AccessToken, DataPacket_Kind, RoomServiceClient } from "livekit-server-sdk";
import type { SupportedLanguage } from "@/lib/session-contracts";

export type RoomRole = "facilitator" | "learner";

export interface RoomCredentialRequest {
  sessionId: string;
  role: RoomRole;
  identity: string;
  displayName: string;
  preferredLanguage: SupportedLanguage;
}

export interface RoomCredential {
  serverUrl: string;
  token: string;
}

/**
 * Server-only boundary for issuing short-lived room credentials. Application
 * code depends on this interface, never on the LiveKit SDK directly, so the
 * live-transport vendor can change without touching call sites.
 */
export interface RoomProvider {
  readonly isConfigured: boolean;
  issueCredential(request: RoomCredentialRequest): Promise<RoomCredential>;
  /**
   * Pushes a "captions changed" signal to every participant in the session's
   * room over a LiveKit DataChannel, so clients can react immediately instead
   * of waiting for the next poll. The payload is a lightweight signal, not the
   * caption itself — clients still refetch from the server on receipt.
   */
  notifyCaptionsChanged(sessionId: string): Promise<void>;
  /**
   * Facilitator-only room-wide toggle: whether learners' screen-share and
   * whiteboard controls are unlocked. Stored as LiveKit room metadata (not
   * Prisma — purely a live-session concern) so every connected client's
   * `useRoomInfo()` picks it up immediately via LiveKit's own
   * RoomMetadataChanged event, no DataChannel signal or poll needed.
   */
  setPresenterAccess(sessionId: string, allowLearnerPresenting: boolean): Promise<void>;
  /**
   * Server-authoritative whiteboard broadcast: pushes updated Excalidraw
   * elements (typically the result of translating a text element) to every
   * connected client over the same `"whiteboard"` DataChannel topic clients
   * use for their own live drawing sync — see Whiteboard.tsx. This is the
   * one whiteboard update path that must come from the server rather than a
   * client, since translation happens server-side.
   */
  sendWhiteboardUpdate(sessionId: string, elements: unknown[]): Promise<void>;
}

/**
 * Server-to-server RoomServiceClient calls (updateRoomMetadata, sendData) must hit LiveKit
 * over the Compose-internal network, not the browser-facing LIVEKIT_URL — those two are
 * different addresses whenever this runs in Docker (see docker-compose.yml's LIVEKIT_URL
 * comment: the web container's own LIVEKIT_URL is deliberately `localhost` so the *browser*
 * can reach it, which means "localhost" from inside that same container). Falls back to
 * LIVEKIT_URL for native `npm run dev`, where both addresses are the same host.
 */
function internalLiveKitUrl(): string {
  return process.env.LIVEKIT_INTERNAL_URL || process.env.LIVEKIT_URL!;
}

class LiveKitRoomProvider implements RoomProvider {
  get isConfigured() {
    return Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
  }

  async issueCredential({
    sessionId,
    role,
    identity,
    displayName,
    preferredLanguage,
  }: RoomCredentialRequest): Promise<RoomCredential> {
    const serverUrl = process.env.LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!serverUrl || !apiKey || !apiSecret) {
      throw new Error("LiveKit is not configured.");
    }

    const token = new AccessToken(apiKey, apiSecret, {
      identity: `${role}:${identity}`,
      name: displayName,
      metadata: JSON.stringify({ sessionId, role }),
      // Seeds room state every client can read via Participant.attributes
      // (e.g. the meeting shell's participant strip) without an extra Prisma
      // round-trip. raisedHand starts false; only the owning participant can
      // change it later, via canUpdateOwnMetadata below.
      attributes: { preferredLanguage, raisedHand: "false" },
      ttl: "15m",
    });
    token.addGrant({
      roomJoin: true,
      room: `workshop-${sessionId}`,
      // Both roles publish/subscribe audio+video symmetrically by design —
      // LiveSessionRoom is a full bidirectional room so facilitators and
      // learners can talk during peer discussion / group work, not a
      // facilitator-broadcast-only room.
      canPublish: true,
      canSubscribe: true,
      // Whiteboard drawing needs clients to publish DataChannel messages
      // directly (topic "whiteboard") — a server round-trip per stroke would
      // be far too slow. Granted symmetrically to both roles, same as
      // canPublish above; actual draw access is gated client-side only, by
      // the same `canPresent` check that already gates screen-share (see
      // MeetingToolbar's `disabled={!canPresent}`) — there's no separate
      // server-side grant for screen-share either, so this isn't a new
      // pattern. Captions still only ever get pushed by the server
      // (notifyCaptionsChanged/sendWhiteboardUpdate via RoomServiceClient);
      // this just adds a second, client-originated topic alongside that.
      canPublishData: true,
      // Lets a participant update their own attributes (e.g. toggling
      // raisedHand from the meeting toolbar) — LiveKit replicates the change
      // to every other client in the room automatically, no server round-trip.
      canUpdateOwnMetadata: true,
    });

    return { serverUrl, token: await token.toJwt() };
  }

  async notifyCaptionsChanged(sessionId: string): Promise<void> {
    if (!this.isConfigured) return;
    const serverUrl = internalLiveKitUrl();
    const apiKey = process.env.LIVEKIT_API_KEY!;
    const apiSecret = process.env.LIVEKIT_API_SECRET!;
    const client = new RoomServiceClient(serverUrl, apiKey, apiSecret);
    const payload = new TextEncoder().encode(JSON.stringify({ type: "captions-changed" }));
    try {
      await client.sendData(`workshop-${sessionId}`, payload, DataPacket_Kind.RELIABLE, { topic: "captions" });
    } catch {
      // Best-effort: DataChannel push is a latency optimization, not a
      // correctness requirement — polling (SessionAutoRefresh) still delivers
      // captions if the room has no active LiveKit participants yet or the
      // push itself fails.
    }
  }

  async setPresenterAccess(sessionId: string, allowLearnerPresenting: boolean): Promise<void> {
    if (!this.isConfigured) return;
    const serverUrl = internalLiveKitUrl();
    const apiKey = process.env.LIVEKIT_API_KEY!;
    const apiSecret = process.env.LIVEKIT_API_SECRET!;
    const client = new RoomServiceClient(serverUrl, apiKey, apiSecret);
    await client.updateRoomMetadata(`workshop-${sessionId}`, JSON.stringify({ allowLearnerPresenting }));
  }

  async sendWhiteboardUpdate(sessionId: string, elements: unknown[]): Promise<void> {
    if (!this.isConfigured) return;
    const serverUrl = internalLiveKitUrl();
    const apiKey = process.env.LIVEKIT_API_KEY!;
    const apiSecret = process.env.LIVEKIT_API_SECRET!;
    const client = new RoomServiceClient(serverUrl, apiKey, apiSecret);
    const payload = new TextEncoder().encode(JSON.stringify({ type: "whiteboard-elements", elements }));
    try {
      await client.sendData(`workshop-${sessionId}`, payload, DataPacket_Kind.RELIABLE, { topic: "whiteboard" });
    } catch {
      // Best-effort, same reasoning as notifyCaptionsChanged — the next
      // client-side snapshot save still captures this element's translation
      // eventually via a future edit/re-render, this is just latency.
    }
  }
}

export const roomProvider: RoomProvider = new LiveKitRoomProvider();
