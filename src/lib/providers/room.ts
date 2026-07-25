import { AccessToken, DataPacket_Kind, RoomServiceClient, TrackSource } from "livekit-server-sdk";

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
      // LiveSessionRoom fetches this token exactly once per mount and never
      // refreshes it — a token that expires mid-workshop leaves a reconnect
      // (network blip, laptop sleep/wake) permanently rejected until the
      // participant manually reloads the page. 6h comfortably covers a live
      // workshop session; a real refresh flow (livekit-client's TokenSource)
      // would be the more thorough fix but is a larger, untested change for
      // this prototype's scope.
      ttl: "6h",
    });
    token.addGrant({
      roomJoin: true,
      room: `workshop-${sessionId}`,
      // Both roles publish/subscribe audio+video symmetrically by design —
      // LiveSessionRoom is a full bidirectional room so facilitators and
      // learners can talk during peer discussion / group work, not a
      // facilitator-broadcast-only room. DataChannel publishing is
      // deliberately withheld from every participant: only the server
      // (notifyCaptionsChanged, via RoomServiceClient) ever sends data —
      // no client-side code publishes to the DataChannel, so granting
      // participants that ability would be unused attack surface.
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      // Screen share is a facilitator-to-group broadcast (see
      // LiveSessionRoom's role==="facilitator" ControlBar gate) — that's a
      // client-side UI restriction only, so it must also be enforced here at
      // the token level, or any learner could publish a screen-share track
      // directly via the LiveKit client SDK and take over every viewer's
      // FocusLayout.
      canPublishSources:
        role === "facilitator"
          ? [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]
          : [TrackSource.CAMERA, TrackSource.MICROPHONE],
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
