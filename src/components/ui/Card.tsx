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
      className={`flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-raised p-4 shadow-sm ${className}`}
      style={accent ? { borderLeft: `3px solid ${accent}` } : undefined}
    >
      {(eyebrow || title || meta) && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            {eyebrow && (
              <p className="font-data text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
                {eyebrow}
              </p>
            )}
            {title && (
              <h3 className="font-heading font-semibold text-foreground">{title}</h3>
            )}
          </div>
          {meta && (
            <span className="font-data text-xs text-muted-foreground">{meta}</span>
          )}
        </div>
      )}
      <div className="text-sm text-foreground">{children}</div>
    </section>
  );
}
