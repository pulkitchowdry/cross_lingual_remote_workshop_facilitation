export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
}) {
  const variantStyles =
    variant === "primary"
      ? "bg-accent text-accent-foreground hover:opacity-90"
      : "border border-border-strong bg-surface text-foreground hover:bg-background";

  return (
    <button
      className={`w-fit rounded-full px-5 py-2 text-sm font-medium transition-opacity disabled:opacity-40 ${variantStyles} ${className}`}
      {...props}
    />
  );
}
