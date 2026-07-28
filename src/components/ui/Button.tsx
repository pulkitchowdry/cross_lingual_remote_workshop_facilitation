export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
}) {
  const variantStyles =
    variant === "primary"
      ? "bg-accent-fill text-accent-foreground hover:opacity-90"
      : "border border-border-strong bg-surface text-foreground hover:bg-background";

  return (
    <button
      className={`font-data w-fit rounded-md px-5 py-2 text-xs font-medium uppercase tracking-wider press-scale transition-colors transition-opacity duration-150 disabled:opacity-40 ${variantStyles} ${className}`}
      {...props}
    />
  );
}
