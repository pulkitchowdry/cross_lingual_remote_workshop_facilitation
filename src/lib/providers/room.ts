import { AccessToken, AgentDispatchClient, DataPacket_Kind, RoomAgentDispatch, RoomConfiguration, RoomServiceClient } from "livekit-server-sdk";
import type { SupportedLanguage } from "@/lib/session-contracts";
import { agentCaptureEnabled, CAPTION_AGENT_NAME } from "@/lib/caption-capture-mode";

export type RoomRole = "facilitator" | "learner";

export interface RoomCredentialRequest {
  sessionId: string;
  role: RoomRole;
  identity: string;
  displayName: string;
  preferredLanguage: SupportedLanguage;
  /**
   * The participant's current raised-hand state, to preserve across a token remint.
   * issueCredential is the single path behind every token mint — the participant's very
   * first join *and* every background refresh (LiveSessionRoom's fetchCredentials, on a
   * timer/'visibilitychange'/'online') alike. Defaults to `false`, which is only correct
   * for a genuine first join; a caller reminting a token for an already-connected
   * participant (a background refresh) must pass that participant's live value here, or
   * the reconnect this token triggers will silently lower an already-raised hand for
   * everyone in the room.
   */
  raisedHand?: boolean;
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
  return process.env.LIVEKIT_AGENT_URL || process.env.LIVEKIT_URL!;
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
    raisedHand = false,
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
      // LiveSessionRoom fetches this token exactly once per mount and never
      // refreshes it — a token that expires mid-workshop leaves a reconnect
      // (network blip, laptop sleep/wake) permanently rejected until the
      // participant manually reloads the page. 6h comfortably covers a live
      // workshop session; a real refresh flow (livekit-client's TokenSource)
      // would be the more thorough fix but is a larger, untested change for
      // this prototype's scope. raisedHand defaults to false (a genuine first join) but
      // must reflect the caller-supplied current value on a background refresh — see
      // RoomCredentialRequest.raisedHand's doc comment; canUpdateOwnMetadata below is
      // still how the owning participant changes it live thereafter.
      attributes: { preferredLanguage, raisedHand: String(raisedHand) },
      ttl: "6h",
    });
    // Explicit dispatch, not automatic — see CAPTION_AGENT_NAME's doc comment. Harmless
    // to set on every token (including background refreshes of an already-connected
    // participant): LiveKit only acts on this at the moment a room is first created and
    // silently ignores it on every later token for a room that already exists, so this
    // doesn't need to know whether *this* token happens to be the one that creates the
    // room — whichever one does gets the dispatch, the rest are no-ops.
    if (agentCaptureEnabled()) {
      token.roomConfig = new RoomConfiguration({
        agents: [new RoomAgentDispatch({ agentName: CAPTION_AGENT_NAME })],
      });
    }
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
    } catch (error) {
      // Best-effort: DataChannel push is a latency optimization, not a
      // correctness requirement — polling (SessionAutoRefresh) still delivers
      // captions if the room has no active LiveKit participants yet or the
      // push itself fails. Still log it, though (matching translateWithClaude's
      // pattern) — a *persistently* failing push (bad credentials, LiveKit
      // outage) would otherwise be invisible, silently degrading every caption
      // to polling-speed delivery with nothing in the logs to explain why.
      console.error(`notifyCaptionsChanged: LiveKit sendData failed for session ${sessionId}, falling back to polling:`, error);
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
    } catch (error) {
      // Best-effort, same reasoning as notifyCaptionsChanged — the next
      // client-side snapshot save still captures this element's translation
      // eventually via a future edit/re-render, this is just latency. Still log it,
      // though: a *persistently* failing push would otherwise silently degrade every
      // whiteboard translation for the rest of the session with nothing in the logs
      // to explain why.
      console.error(`sendWhiteboardUpdate: LiveKit sendData failed for session ${sessionId}:`, error);
    }
  }
}

export const roomProvider: RoomProvider = new LiveKitRoomProvider();

// How long to wait between presence checks — both before the very first check (giving
// the token-embedded dispatch request a fair chance) and between each retry after that.
// See ensureAgentDispatched's own doc comment for the evidence behind this number.
const AGENT_DISPATCH_RETRY_DELAY_MS = 10_000;
// Bounds the retry loop so a genuinely broken config (not just a slow/lost delivery)
// doesn't poll forever — 6 attempts * 10s ≈ 60s of total retrying before giving up.
const AGENT_DISPATCH_MAX_ATTEMPTS = 6;
// Per-process, not per-request — see ensureAgentDispatched's doc comment for why this
// must only ever run once per session.
const sessionsCheckedForAgentDispatch = new Set<string>();

// `ParticipantInfo_Kind.AGENT` from `@livekit/protocol` (a transitive dependency via
// `livekit-server-sdk`, not declared directly in package.json, and not re-exported by
// `livekit-server-sdk` itself — `ParticipantInfo.permission.agent` is the alternative but
// is marked `@deprecated` in favor of this `kind` field). Using the raw wire value here
// rather than importing an undeclared package.
const PARTICIPANT_KIND_AGENT = 4;

/**
 * Defensive fallback for a confirmed LiveKit Cloud dispatch-delivery gap (2026-07-31):
 * `issueCredential`'s token-embedded `RoomConfiguration.agents` request is one-shot, fired
 * the instant a room is created. `lk dispatch list <room>` has repeatedly confirmed
 * LiveKit Cloud *does* create the dispatch record, but the "received job request" push to
 * our registered worker sometimes never arrives — the leading theory, from live evidence,
 * is a race against this worker's own idle-process-pool warm-up (`numIdleProcesses`, ~4
 * subprocesses, observed taking several real seconds after registration), with no retry
 * once a worker becomes ready. This doesn't fix that gap — it's on LiveKit Cloud's side,
 * out of reach from here — it polls for up to `AGENT_DISPATCH_MAX_ATTEMPTS` rounds,
 * re-requesting dispatch via `AgentDispatchClient.createDispatch()` on each round the agent
 * still hasn't joined, giving the room repeated chances at the race window above instead
 * of just one.
 *
 * **Known tradeoff, accepted deliberately:** each retry re-checks presence immediately
 * before calling `createDispatch` again, so the loop stops the round *after* an agent
 * successfully joins — but there's no way from here to know whether an *earlier* attempt
 * is still silently in flight (that's exactly the undetectable state this whole mitigation
 * exists to route around). If two separate dispatch attempts both eventually land, two
 * agent instances would join and duplicate every caption line — the same class of bug
 * `caption-agent.ts`'s own duplicate-subscription guards exist to prevent, but this path
 * has no equivalent guard against it. Accepted because the observed failure mode is
 * "never delivered at all", not "delivered twice" — if that changes, this needs a real
 * fix (e.g. checking `AgentDispatchClient.listDispatch()` for an already-outstanding
 * dispatch before creating another), not just a shorter retry window.
 *
 * Fire-and-forget by design — callers never await this, and it must never block or fail a
 * token request over what is, worst case, a redundant check. Deduped per `sessionId` via
 * an in-memory `Set` for this process's lifetime: `/api/livekit/token` calls this on every
 * join *and* every background token refresh, but only the very first caller for a given
 * session needs to actually run the check/retry loop.
 */
export function ensureAgentDispatched(sessionId: string): void {
  if (!agentCaptureEnabled()) return; // browser-only: no agent to ever dispatch
  if (sessionsCheckedForAgentDispatch.has(sessionId)) return;
  sessionsCheckedForAgentDispatch.add(sessionId);

  const roomName = `workshop-${sessionId}`;
  const serverUrl = internalLiveKitUrl();
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) return;

  let attempt = 0;
  const checkAndRetry = () => {
    void (async () => {
      attempt++;
      try {
        const roomClient = new RoomServiceClient(serverUrl, apiKey, apiSecret);
        const participants = await roomClient.listParticipants(roomName);
        const agentAlreadyPresent = participants.some((participant) => participant.kind === PARTICIPANT_KIND_AGENT);
        if (agentAlreadyPresent) {
          if (attempt > 1) console.log(`[room] agent joined ${roomName} after ${attempt} presence check(s).`);
          return;
        }

        if (attempt > AGENT_DISPATCH_MAX_ATTEMPTS) {
          console.error(
            `[room] no agent joined ${roomName} after ${AGENT_DISPATCH_MAX_ATTEMPTS} dispatch retries ` +
              `(~${(AGENT_DISPATCH_MAX_ATTEMPTS * AGENT_DISPATCH_RETRY_DELAY_MS) / 1000}s); giving up.`,
          );
          return;
        }

        console.warn(`[room] no agent participant in ${roomName} (attempt ${attempt}/${AGENT_DISPATCH_MAX_ATTEMPTS}); retrying explicit dispatch.`);
        const dispatchClient = new AgentDispatchClient(serverUrl, apiKey, apiSecret);
        const dispatch = await dispatchClient.createDispatch(roomName, CAPTION_AGENT_NAME);
        console.log(`[room] retry dispatch created for ${roomName} (attempt ${attempt}): dispatchId=${dispatch.id}`);
        setTimeout(checkAndRetry, AGENT_DISPATCH_RETRY_DELAY_MS);
      } catch (error) {
        // Best-effort — a session already ended (room gone), a transient LiveKit API
        // hiccup, or the room simply never having been created (nobody ever actually
        // connected with this token) are all fine to just log and move past, but still
        // worth another round rather than giving up on a single transient failure.
        console.error(`[room] ensureAgentDispatched check failed for session ${sessionId} (attempt ${attempt}):`, error);
        if (attempt <= AGENT_DISPATCH_MAX_ATTEMPTS) setTimeout(checkAndRetry, AGENT_DISPATCH_RETRY_DELAY_MS);
      }
    })();
  };

  setTimeout(checkAndRetry, AGENT_DISPATCH_RETRY_DELAY_MS);
}
