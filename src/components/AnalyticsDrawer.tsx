"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import type { FacilitatorAnalytics } from "@/lib/facilitator-analytics";

export function AnalyticsDrawer({
  analytics,
  isFrozen,
  labels,
  participationRows,
  blockersSummary,
  languageRows,
}: {
  analytics: FacilitatorAnalytics;
  isFrozen: boolean;
  labels: {
    analyticsDrawerLabel: string;
    analyticsDrawerOpen: string;
    analyticsDrawerClose: string;
    analyticsConfusionTrendHeading: string;
    analyticsParticipationHeading: string;
    analyticsBlockersHeading: string;
    analyticsLanguagesHeading: string;
    analyticsEmptyState: string;
  };
  // Precomputed server-side (dict.analyticsParticipationRow/analyticsLanguagesRow/
  // analyticsBlockersSummary called in the RSC page, not passed here) — functions
  // cannot cross the server->client prop boundary this component sits behind, so only
  // their plain-string return values are passed in. Order matches
  // analytics.participation / analytics.languages 1:1; the entries themselves are still
  // used for React `key`s.
  participationRows: string[];
  blockersSummary: string;
  languageRows: string[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const isEmpty =
    analytics.confusionTrend.every((point) => point.count === 0) &&
    analytics.participation.every((entry) => entry.messageCount === 0) &&
    analytics.blockers.raised === 0 &&
    analytics.languages.length === 0;

  return (
    <aside className="flex flex-col gap-2" aria-label={labels.analyticsDrawerLabel}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="font-data w-fit rounded-md border border-border-strong px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-foreground hover:border-[var(--tick-high)] hover:text-[var(--tick-high)]"
      >
        {isOpen ? labels.analyticsDrawerClose : labels.analyticsDrawerOpen}
      </button>
      {isOpen && (
        <div className="flex flex-col gap-3">
          {isEmpty ? (
            <Card>
              <p className="text-muted-foreground">{labels.analyticsEmptyState}</p>
            </Card>
          ) : (
            <>
              <Card eyebrow={labels.analyticsConfusionTrendHeading}>
                <div className="flex items-end gap-1" aria-hidden="true">
                  {analytics.confusionTrend.map((point) => (
                    <div
                      key={point.bucketStart.toISOString()}
                      className="w-3 rounded-sm"
                      style={{
                        height: `${4 + point.count * 6}px`,
                        backgroundColor:
                          point.groupLevel === "HIGH"
                            ? "var(--tick-low)"
                            : point.groupLevel === "SOME"
                              ? "var(--tick-medium)"
                              : "var(--tick-high)",
                      }}
                    />
                  ))}
                </div>
              </Card>
              <Card eyebrow={labels.analyticsParticipationHeading}>
                <ul className="flex flex-col gap-1">
                  {analytics.participation.map((entry, index) => (
                    <li key={entry.userId} className="text-xs">
                      {participationRows[index]}
                    </li>
                  ))}
                </ul>
              </Card>
              <Card eyebrow={labels.analyticsBlockersHeading}>
                <p className="text-xs">{blockersSummary}</p>
              </Card>
              {analytics.languages.length > 0 && (
                <Card eyebrow={labels.analyticsLanguagesHeading}>
                  <ul className="flex flex-col gap-1">
                    {analytics.languages.map((entry, index) => (
                      <li key={entry.language} className="text-xs">
                        {languageRows[index]}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}
        </div>
      )}
    </aside>
  );
}
