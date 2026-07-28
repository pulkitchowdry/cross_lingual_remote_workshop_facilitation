"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ParticipantRole, SessionStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { learnerCookieName, hashToken, createOpaqueToken } from "@/lib/session-security";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/session-contracts";
import { isSessionRetentionExpired } from "@/lib/session-retention";
import { isRateLimited } from "@/lib/rate-limit";

const languageValues = new Set<string>(SUPPORTED_LANGUAGES.map((language) => language.value));

/** Zero-width/invisible Unicode characters (U+200B ZERO WIDTH SPACE and similar) —
 * `String.prototype.trim()` doesn't strip these, so a displayName made up only of
 * them passed the `!displayName.trim()` emptiness check below unchanged, letting a
 * learner join with a functionally-blank, invisible name no one else in the room
 * could identify them by. Mirrors the identical fix in setup/actions.ts's
 * requiredText(). Stripped from the whole value, not just for the check, so none
 * can survive embedded elsewhere in a name either. */
const ZERO_WIDTH_CHARS = new RegExp("[\\u200B-\\u200D\\uFEFF\\u2060]", "g");

/** Secondary, defense-in-depth layer only — `x-forwarded-for`'s leftmost value is
 * client-controlled unless a trusted proxy strips/overwrites it (this app's own
 * topology doesn't guarantee that; see docker-compose.yml, which exposes `web`
 * directly with nothing in front), so a determined script can rotate this per
 * request and this limit alone never fires. Raised from an earlier, much stricter
 * per-IP-only cap that also had the opposite problem: a real classroom or office
 * joining from behind one NAT'd IP could exhaust it on legitimate traffic alone.
 * JOIN_RATE_LIMIT_PER_LINK below is the primary, bypass-proof control. */
const JOIN_RATE_LIMIT_PER_IP = { max: 20, windowMs: 60_000 };
/** The actual anti-abuse control: a script can spoof its IP but not which invite
 * link it's hammering, so this bounds "a scripted loop hitting the publicly shared
 * learner invite link (a QR code/copyable link meant for a whole room) to mint
 * unlimited learner identities" (the original threat this file was hardened
 * against) regardless of how many IPs it presents. High enough that a large
 * classroom's real students all joining within the same minute never hits it. */
const JOIN_RATE_LIMIT_PER_LINK = { max: 60, windowMs: 60_000 };

export async function joinSession(formData: FormData) {
  const token = formData.get("token");
  const displayName = formData.get("displayName");
  const preferredLanguage = formData.get("preferredLanguage");

  if (typeof token !== "string" || typeof displayName !== "string" || typeof preferredLanguage !== "string") {
    throw new Error("Your session details are incomplete.");
  }
  const cleanDisplayName = displayName.replace(ZERO_WIDTH_CHARS, "").trim();
  if (!cleanDisplayName || cleanDisplayName.length > 80 || !languageValues.has(preferredLanguage)) {
    throw new Error("Enter a name and supported preferred language.");
  }
  if (formData.get("consent") !== "on") {
    throw new Error("Consent is required before joining a live session.");
  }

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const tokenHash = hashToken(token);
  if (
    isRateLimited(`join-ip:${ip}`, JOIN_RATE_LIMIT_PER_IP.max, JOIN_RATE_LIMIT_PER_IP.windowMs) ||
    isRateLimited(`join-link:${tokenHash}`, JOIN_RATE_LIMIT_PER_LINK.max, JOIN_RATE_LIMIT_PER_LINK.windowMs)
  ) {
    throw new Error("Too many join attempts. Please wait a moment and try again.");
  }

  const joinLink = await prisma.joinLink.findUnique({ where: { tokenHash } });
  if (
    !joinLink ||
    joinLink.role !== ParticipantRole.LEARNER ||
    joinLink.revokedAt ||
    (joinLink.expiresAt && joinLink.expiresAt < new Date()) ||
    (joinLink.maxUses !== null && joinLink.useCount >= joinLink.maxUses)
  ) {
    throw new Error("This learner invitation is no longer available.");
  }

  const session = await prisma.session.findUnique({ where: { id: joinLink.sessionId } });
  // The join link's own expiry (checked above) is a much longer, independent window
  // (30 days by default) than the session's own retention deadline — a learner could
  // otherwise complete consent and join a session whose data-retention deadline has
  // already passed but hasn't been physically purged yet (the cleanup cron runs
  // hourly at most), immediately hitting a broken "session not found" on the very
  // next page instead of a clear "this invitation is no longer available" here.
  //
  // `status === ENDED` is checked separately from retention: a facilitator ending a
  // session never revokes its (separately-optional) learner invite link, so a leaked
  // or bookmarked link would otherwise keep admitting brand-new learners into an
  // already-concluded workshop for the rest of its (up to 30-day) retention window —
  // landing them on a read-only historical transcript/chat archive they were never
  // part of. DRAFT sessions are intentionally still joinable (learners pre-join and
  // see "Waiting for the facilitator to start" — see learn/page.tsx).
  if (!session || session.status === SessionStatus.ENDED || isSessionRetentionExpired(session)) {
    throw new Error("This session is no longer available.");
  }

  // The learner's ongoing session credential must be a random secret only they
  // ever hold, not `participant.id` — that id is also this participant's
  // LiveKit room identity (see room.ts), which every other participant in the
  // room can read, so using it as the session cookie too would let any
  // co-learner impersonate any other by copying that publicly-visible id.
  const accessToken = createOpaqueToken();

  await prisma.$transaction(async (transaction) => {
    // Re-check inside the transaction, not just once above — a facilitator can end
    // the session (or its retention deadline can pass) in the gap between that first
    // check and this write actually committing, letting a learner join a session
    // that's no longer live (sendChatMessage re-checks for the same reason, right
    // before its own write).
    const current = await transaction.session.findUnique({ where: { id: joinLink.sessionId } });
    if (!current || current.status === SessionStatus.ENDED || isSessionRetentionExpired(current)) {
      throw new Error("This session is no longer available.");
    }
    // Same race as the session check above, applied to the JoinLink itself: the
    // revocation/expiry/maxUses check at line ~56 ran on a read from *before* this
    // transaction started, so a facilitator clicking "Revoke invite" (or the link's
    // own maxUses cap being hit by a concurrent join) in the gap between that read
    // and this transaction committing would otherwise still let this join complete —
    // silently admitting a learner through a link the facilitator believed "stops
    // working right away" (revokeLearnerInvite's own doc comment). An atomic
    // conditional update, not a second plain read: `updateMany`'s `where` clause is
    // evaluated by Postgres against the current committed row at increment time, so
    // a concurrent revoke that commits first is guaranteed to make this `count: 0`
    // instead of both transactions racing on a read-then-write.
    const claimed = await transaction.joinLink.updateMany({
      where: {
        id: joinLink.id,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
        ...(joinLink.maxUses !== null ? { useCount: { lt: joinLink.maxUses } } : {}),
      },
      data: { useCount: { increment: 1 } },
    });
    if (claimed.count === 0) {
      throw new Error("This learner invitation is no longer available.");
    }
    const user = await transaction.user.create({
      data: {
        displayName: cleanDisplayName,
        preferredLanguage: preferredLanguage as SupportedLanguage,
      },
    });
    const createdParticipant = await transaction.sessionParticipant.create({
      data: {
        sessionId: joinLink.sessionId,
        userId: user.id,
        role: ParticipantRole.LEARNER,
        preferredLanguage: preferredLanguage as SupportedLanguage,
        consentedAt: new Date(),
        accessTokenHash: hashToken(accessToken),
      },
    });
    return createdParticipant;
  });

  const cookieStore = await cookies();
  cookieStore.set(learnerCookieName(joinLink.sessionId), accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // Matches the facilitator cookie's 30-day maxAge (setup/actions.ts) and the join
    // link's own 30-day expiry, not a shorter, unrelated 24h window — a learner
    // revisiting their read-only transcript/chat archive (this file's own comment
    // above anticipates exactly that) got silently logged out well before the
    // session/transcript retention it's actually gated on ever expired.
    maxAge: 60 * 60 * 24 * 30,
  });

  redirect(`/sessions/${joinLink.sessionId}/learn`);
}
