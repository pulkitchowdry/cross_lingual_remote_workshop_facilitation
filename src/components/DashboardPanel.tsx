export function DashboardPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-black/10 p-4 dark:border-white/10">
      <h2 className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
        {title}
      </h2>
      <div className="text-sm">{children}</div>
    </section>
  );
}
