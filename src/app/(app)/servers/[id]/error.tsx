'use client';

import {useEffect} from 'react';
import {Button} from '@/components/ui/button';

export default function OverviewError({
  error,
  reset,
}: {
  error: Error & {digest?: string};
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to server logs / devtools without leaking details to the user.
    console.error(error);
  }, [error]);

  return (
    <div className="space-y-3 rounded-xl border p-6">
      <p className="text-sm text-destructive">Failed to load server overview.</p>
      <Button onClick={reset} size="sm">
        Retry
      </Button>
    </div>
  );
}
