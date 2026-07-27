"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import type { FacilitatorAnalytics } from "@/lib/facilitator-analytics";
import type { FacilitatorAnalyticsLabels } from "@/lib/facilitator-analytics-view";

interface AnalyticsPanelProps {
  analytics: FacilitatorAnalytics;
  isFrozen: boolean;
  labels: FacilitatorAnalyticsLabels;
  // Precomputed server-side (dict.analyticsParticipationRow/analyticsLanguagesRow/
  // analyticsBlockersSummary/analyticsConfidenceSummary called in the RSC page, not
  // passed here) — functions cannot cross the server->client prop boundary this
  // component sits behind, so only their plain-string return values are passed in.
  // Order matches analytics.participation / analytics.languages 1:1; the entries
  // themselves are still used for React `key`s.
  participationRows: string[];
  blockersSummary: string;
  languageRows: string[];
  confidenceSummary: string;
}

/**
 * The actual analytics cards (confusion trend, participation, blockers, confidence,
 * languages) — split out from `AnalyticsDrawer` so a second consumer (the live
 * meeting room's sidebar "Analytics" tab, see MeetingSidebar) can render it directly
 * without a redundant second "show analytics" toggle on top of the tab selection
 * that already IS the reveal action there. `AnalyticsDrawer` below is the original
 * collapsible-button wrapper, used unchanged on the facilitator dashboard.
 */
export function AnalyticsPanelContent({
  analytics,
  isFrozen,
  labels,
  participationRows,
  blockersSummary,
  languageRows,
  confidenceSummary,
}: AnalyticsPanelProps) {
  const isEmpty =
    analytics.confusionTrend.every((point) => point.count === 0) &&
    analytics.participation.every((entry) => entry.messageCount === 0) &&
    analytics.blockers.raised === 0 &&
    analytics.languages.length === 0 &&
    analytics.confidence.mediumCount === 0 &&
    analytics.confidence.lowCount === 0;

  return (
    <div className="flex flex-col gap-3">
      {isFrozen && <p className="text-muted-foreground text-xs">{labels.analyticsFrozenNotice}</p>}
      {isEmpty ? (
        <Card>
          <p className="text-muted-foreground">{labels.analyticsEmptyState}</p>
        </Card>
      ) : (
        <>
          <Card eyebrow={labels.analyticsConfusionTrendHeading}>
            <p className="sr-only">{labels.analyticsConfusionTrendSummary}</p>
            <div className="flex items-end gap-1 overflow-x-auto" aria-hidden="true">
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
                <li key={entry.userId} className="break-words text-xs">
                  {participationRows[index]}
                </li>
              ))}
            </ul>
          </Card>
          <Card eyebrow={labels.analyticsBlockersHeading}>
            <p className="text-xs">{blockersSummary}</p>
          </Card>
          {(analytics.confidence.mediumCount > 0 || analytics.confidence.lowCount > 0) && (
            <Card eyebrow={labels.analyticsConfidenceHeading}>
              <p className="text-xs">{confidenceSummary}</p>
            </Card>
          )}
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
  );
}

export function AnalyticsDrawer(props: AnalyticsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <aside className="flex flex-col gap-2" aria-label={props.labels.analyticsDrawerLabel}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="font-data w-fit rounded-md border border-border-strong px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-foreground hover:border-[var(--tick-high)] hover:text-[var(--tick-high)]"
      >
        {isOpen ? props.labels.analyticsDrawerClose : props.labels.analyticsDrawerOpen}
      </button>
      {isOpen && <AnalyticsPanelContent {...props} />}
    </aside>
  );
}
