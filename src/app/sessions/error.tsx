"use client";

import { RouteErrorFallback } from "@/components/RouteErrorFallback";

export default function SessionsOverviewError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <RouteErrorFallback error={error} unstable_retry={unstable_retry} />;
}
