'use client';

import { ErrorState } from '../components/ui';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card">
      <ErrorState error={error} onRetry={reset} />
    </div>
  );
}
