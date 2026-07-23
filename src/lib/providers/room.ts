import { AccessToken } from "livekit-server-sdk";

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
}

export const roomProvider: RoomProvider = new LiveKitRoomProvider();
