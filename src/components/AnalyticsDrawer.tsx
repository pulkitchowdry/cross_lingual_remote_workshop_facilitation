"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import type { FacilitatorAnalytics } from "@/lib/facilitator-analytics";

export function AnalyticsDrawer({
  analytics,
  isFrozen,
  dict,
}: {
  analytics: FacilitatorAnalytics;
  isFrozen: boolean;
  dict: {
    analyticsDrawerLabel: string;
    analyticsDrawerOpen: string;
    analyticsDrawerClose: string;
    analyticsConfusionTrendHeading: string;
    analyticsParticipationHeading: string;
    analyticsParticipationRow: (displayName: string, messages: number, questions: number) => string;
    analyticsBlockersHeading: string;
    analyticsBlockersSummary: (raised: number, resolved: number, open: number) => string;
    analyticsLanguagesHeading: string;
    analyticsLanguagesRow: (language: string, count: number) => string;
    analyticsEmptyState: string;
  };
}) {
  const [isOpen, setIsOpen] = useState(false);
  const isEmpty =
    analytics.confusionTrend.every((point) => point.count === 0) &&
    analytics.participation.every((entry) => entry.messageCount === 0) &&
    analytics.blockers.raised === 0 &&
    analytics.languages.length === 0;

  return (
    <aside className="flex flex-col gap-2" aria-label={dict.analyticsDrawerLabel}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="font-data w-fit rounded-md border border-border-strong px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-foreground hover:border-[var(--tick-high)] hover:text-[var(--tick-high)]"
      >
        {isOpen ? dict.analyticsDrawerClose : dict.analyticsDrawerOpen}
      </button>
      {isOpen && (
        <div className="flex flex-col gap-3">
          {isEmpty ? (
            <Card>
              <p className="text-muted-foreground">{dict.analyticsEmptyState}</p>
            </Card>
          ) : (
            <>
              <Card eyebrow={dict.analyticsConfusionTrendHeading}>
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
              <Card eyebrow={dict.analyticsParticipationHeading}>
                <ul className="flex flex-col gap-1">
                  {analytics.participation.map((entry) => (
                    <li key={entry.userId} className="text-xs">
                      {dict.analyticsParticipationRow(entry.displayName, entry.messageCount, entry.questionCount)}
                    </li>
                  ))}
                </ul>
              </Card>
              <Card eyebrow={dict.analyticsBlockersHeading}>
                <p className="text-xs">
                  {dict.analyticsBlockersSummary(analytics.blockers.raised, analytics.blockers.resolved, analytics.blockers.open)}
                </p>
              </Card>
              {analytics.languages.length > 0 && (
                <Card eyebrow={dict.analyticsLanguagesHeading}>
                  <ul className="flex flex-col gap-1">
                    {analytics.languages.map((entry) => (
                      <li key={entry.language} className="text-xs">
                        {dict.analyticsLanguagesRow(entry.language, entry.translationCount)}
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
