export function Card({
  title,
  eyebrow,
  meta,
  accent,
  children,
  className = "",
}: {
  title?: string;
  eyebrow?: string;
  meta?: React.ReactNode;
  accent?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex min-w-0 flex-col gap-2 break-words rounded-lg border border-border-subtle bg-surface-raised p-4 ${className}`}
      style={accent ? { borderLeft: `3px solid ${accent}` } : undefined}
    >
      {(eyebrow || title || meta) && (
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {eyebrow && (
              <p className="font-data text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
                {eyebrow}
              </p>
            )}
            {title && (
              <h3 className="font-heading min-w-0 break-words font-semibold text-foreground">{title}</h3>
            )}
          </div>
          {meta && (
            <span className="font-data shrink-0 text-xs text-muted-foreground">{meta}</span>
          )}
        </div>
      )}
      <div className="min-w-0 text-sm text-foreground">{children}</div>
    </section>
  );
}
