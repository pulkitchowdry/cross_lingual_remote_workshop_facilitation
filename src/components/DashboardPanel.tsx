import { Card } from "@/components/ui/Card";

export function DashboardPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return <Card eyebrow={title}>{children}</Card>;
}
