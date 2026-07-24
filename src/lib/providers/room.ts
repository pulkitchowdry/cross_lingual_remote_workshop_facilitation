import { AccessToken, DataPacket_Kind, RoomServiceClient } from "livekit-server-sdk";

export type RoomRole = "facilitator" | "learner";

export interface RoomCredentialRequest {
  sessionId: string;
  role: RoomRole;
  identity: string;
  displayName: string;
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
}

class LiveKitRoomProvider implements RoomProvider {
  get isConfigured() {
    return Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
  }

  async issueCredential({ sessionId, role, identity, displayName }: RoomCredentialRequest): Promise<RoomCredential> {
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
      ttl: "15m",
    });
    token.addGrant({
      roomJoin: true,
      room: `workshop-${sessionId}`,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    return { serverUrl, token: await token.toJwt() };
  }

  async notifyCaptionsChanged(sessionId: string): Promise<void> {
    if (!this.isConfigured) return;
    const serverUrl = process.env.LIVEKIT_URL!;
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
}

export const roomProvider: RoomProvider = new LiveKitRoomProvider();
