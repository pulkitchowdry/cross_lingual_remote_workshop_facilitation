import { Card } from "@/components/ui/Card";
import type { ParticipationSnapshot, ParticipationStatus } from "@/lib/types";

const STATUS_LABEL: Record<ParticipationStatus, string> = {
  active: "Active",
  quiet: "Quiet",
  confused: "Confused",
};

const STATUS_COLOR: Record<ParticipationStatus, string> = {
  active: "var(--tick-high)",
  quiet: "var(--muted-foreground, #8a8a8a)",
  confused: "var(--tick-low)",
};

function countByStatus(snapshot: ParticipationSnapshot, status: ParticipationStatus) {
  return snapshot.learners.filter((learner) => learner.status === status).length;
}

function StatTile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border-subtle bg-background px-3 py-2">
      <span className="font-data text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="font-heading text-xl font-semibold" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

export function ParticipationDashboard({ snapshot }: { snapshot: ParticipationSnapshot }) {
  const total = snapshot.learners.length;
  const active = countByStatus(snapshot, "active");
  const quiet = countByStatus(snapshot, "quiet");
  const confused = countByStatus(snapshot, "confused");
  const avgScore =
    total === 0
      ? 0
      : Math.round(
          snapshot.learners.reduce((sum, learner) => sum + learner.participationScore, 0) / total
        );

  const languageCounts = snapshot.learners.reduce<Record<string, number>>((acc, learner) => {
    acc[learner.language] = (acc[learner.language] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Card eyebrow="Participation" title="Classroom overview">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Active" value={`${active}/${total}`} color={STATUS_COLOR.active} />
        <StatTile label="Quiet" value={`${quiet}/${total}`} color={STATUS_COLOR.quiet} />
        <StatTile label="Confused" value={`${confused}/${total}`} color={STATUS_COLOR.confused} />
        <StatTile label="Participation score" value={`${avgScore}%`} />
        <StatTile label="Poll accuracy" value={`${snapshot.pollAccuracy}%`} />
        <StatTile
          label="Avg. translation confidence"
          value={`${snapshot.translationConfidenceAvg}%`}
        />
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <p className="font-data text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
          Language distribution
        </p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(languageCounts).map(([language, count]) => (
            <span
              key={language}
              className="font-data rounded-full border border-border-subtle bg-background px-2.5 py-1 text-xs"
            >
              {language} · {count}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <p className="font-data text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
          Learners needing attention
        </p>
        <ul className="flex flex-col gap-1.5">
          {snapshot.learners
            .filter((learner) => learner.status !== "active")
            .map((learner) => (
              <li
                key={learner.id}
                className="flex items-center justify-between rounded-md border border-border-subtle bg-background px-2.5 py-1.5 text-sm"
              >
                <span>{learner.name}</span>
                <span className="flex items-center gap-2">
                  {learner.status === "quiet" && (
                    <span className="font-data text-[0.6875rem] text-muted-foreground">
                      {learner.reminderSent ? "Reminder sent — still quiet" : "Reminder pending"}
                    </span>
                  )}
                  <span
                    className="font-data text-xs font-medium uppercase tracking-wider"
                    style={{ color: STATUS_COLOR[learner.status] }}
                  >
                    {STATUS_LABEL[learner.status]}
                  </span>
                </span>
              </li>
            ))}
          {snapshot.learners.every((learner) => learner.status === "active") && (
            <li className="text-sm text-muted-foreground">Everyone is engaged right now.</li>
          )}
        </ul>
      </div>
    </Card>
  );
}
