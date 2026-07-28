import type { Metadata } from "next";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { Card } from "@/components/ui/Card";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { SyncUiLanguage } from "@/components/SyncUiLanguage";
import { SessionStatus } from "@/generated/prisma/client";
import type { FacilitatorSessionOverviewItem } from "@/lib/facilitator-session-overview";
import { listFacilitatorSessionOverview } from "@/lib/facilitator-session-overview";
import { detectBrowserLanguage, getDictionary, resolveLanguage } from "@/lib/i18n";

export const metadata: Metadata = { title: "Sessions" };

function formatSessionDate(
  session: FacilitatorSessionOverviewItem,
  formatter: Intl.DateTimeFormat,
  labels: {
    created: string;
    started: string;
    ended: string;
  },
) {
  if (session.status === SessionStatus.ENDED && session.endedAt) {
    return `${labels.ended}: ${formatter.format(session.endedAt)}`;
  }
  if (session.startedAt) return `${labels.started}: ${formatter.format(session.startedAt)}`;
  return `${labels.created}: ${formatter.format(session.createdAt)}`;
}

function SessionCard({
  session,
  actionLabel,
  href,
  dateText,
  statusLabel,
  learnerCountLabel,
}: {
  session: FacilitatorSessionOverviewItem;
  actionLabel: string;
  href: string;
  dateText: string;
  statusLabel: string;
  learnerCountLabel: string;
}) {
  return (
    <Card
      title={session.title}
      eyebrow={statusLabel}
      meta={learnerCountLabel}
      accent={session.status === SessionStatus.LIVE ? "var(--tick-high)" : undefined}
    >
      <div className="flex flex-col gap-3">
        <div className="grid min-w-0 gap-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
          <p className="min-w-0 break-words text-muted-foreground">{session.goal}</p>
          <p className="font-data min-w-0 break-words text-xs text-muted-foreground sm:text-right">{dateText}</p>
        </div>
        <Link
          href={href}
          className="font-data w-fit rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-foreground transition-colors hover:border-accent hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {actionLabel}
        </Link>
      </div>
    </Card>
  );
}

function activeSessionAction(session: FacilitatorSessionOverviewItem, labels: { manageSession: string; joinLiveRoom: string }) {
  if (session.status === SessionStatus.LIVE) {
    return {
      href: `/sessions/${session.id}/facilitator/room`,
      label: labels.joinLiveRoom,
    };
  }

  return {
    href: `/sessions/${session.id}/facilitator`,
    label: labels.manageSession,
  };
}

export default async function SessionsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const { lang: langParam } = await searchParams;
  const browserDefault = langParam ? undefined : detectBrowserLanguage((await headers()).get("accept-language"));
  const lang = resolveLanguage(langParam, browserDefault);
  const dict = getDictionary(lang).sessionsOverview;
  const facilitatorDict = getDictionary(lang).facilitator;
  const sessionCookies = (await cookies()).getAll();
  const overview = await listFacilitatorSessionOverview(sessionCookies);
  const hasSessions = overview.active.length > 0 || overview.completed.length > 0;
  const dateTimeFormatter = new Intl.DateTimeFormat(lang, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const statusLabels = {
    [SessionStatus.DRAFT]: facilitatorDict.statusDraft,
    [SessionStatus.LIVE]: facilitatorDict.statusLive,
    [SessionStatus.ENDED]: facilitatorDict.statusEnded,
  };

  return (
    <div className="flex flex-col gap-6">
      <SyncUiLanguage lang={lang} />
      <LanguageSwitcher current={lang} basePath="/sessions" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading break-words text-2xl font-semibold">{dict.heading}</h1>
          <p className="text-sm text-muted-foreground">{dict.subtitle}</p>
        </div>
        <Link
          href="/setup"
          className="font-data press-scale rounded-md bg-accent-fill px-4 py-2 text-xs font-medium uppercase tracking-wider text-accent-foreground transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {dict.newSession}
        </Link>
      </div>

      {!hasSessions ? (
        <Card eyebrow={dict.emptyHeading}>
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground">{dict.emptyBody}</p>
            <Link
              href="/setup"
              className="font-data w-fit rounded-md border border-border-strong px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-foreground transition-colors hover:border-accent hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {dict.newSession}
            </Link>
          </div>
        </Card>
      ) : (
        <>
          <section className="flex flex-col gap-3" aria-labelledby="active-sessions-heading">
            <div>
              <h2 id="active-sessions-heading" className="font-heading text-xl font-semibold">
                {dict.activeHeading}
              </h2>
              <p className="text-sm text-muted-foreground">{dict.activeHint}</p>
            </div>
            {overview.active.length === 0 ? (
              <Card eyebrow={dict.noActiveHeading}>
                <p className="text-muted-foreground">{dict.noActiveBody}</p>
              </Card>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {overview.active.map((session) => {
                  const action = activeSessionAction(session, dict);
                  return (
                    <SessionCard
                      key={session.id}
                      session={session}
                      actionLabel={action.label}
                      href={action.href}
                      dateText={formatSessionDate(session, dateTimeFormatter, dict.dateLabels)}
                      statusLabel={statusLabels[session.status]}
                      learnerCountLabel={dict.learnerCount(session.learnerCount)}
                    />
                  );
                })}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="completed-sessions-heading">
            <div>
              <h2 id="completed-sessions-heading" className="font-heading text-xl font-semibold">
                {dict.completedHeading}
              </h2>
              <p className="text-sm text-muted-foreground">{dict.completedHint}</p>
            </div>
            {overview.completed.length === 0 ? (
              <Card eyebrow={dict.noCompletedHeading}>
                <p className="text-muted-foreground">{dict.noCompletedBody}</p>
              </Card>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {overview.completed.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    actionLabel={dict.viewResults}
                    href={`/sessions/${session.id}/facilitator/results`}
                    dateText={formatSessionDate(session, dateTimeFormatter, dict.dateLabels)}
                    statusLabel={statusLabels[session.status]}
                    learnerCountLabel={dict.learnerCount(session.learnerCount)}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
