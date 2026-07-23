export function Card({
  title,
  eyebrow,
  meta,
  children,
  className = "",
}: {
  title?: string;
  eyebrow?: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface p-4 shadow-sm ${className}`}
    >
      {(eyebrow || title || meta) && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            {eyebrow && (
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {eyebrow}
              </p>
            )}
            {title && <h3 className="font-semibold text-foreground">{title}</h3>}
          </div>
          {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
        </div>
      )}
      <div className="text-sm text-foreground">{children}</div>
    </section>
  );
}
