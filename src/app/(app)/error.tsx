'use client';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/misc';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl py-16">
      <Callout tone="danger" title="This page could not be loaded">
        {error.message?.includes('access') ? error.message : 'An unexpected error occurred. Your data has not been changed.'}
        {error.digest && <div className="mt-1 text-xs opacity-70">Reference: {error.digest}</div>}
      </Callout>
      <Button className="mt-4" onClick={reset}>Try again</Button>
    </div>
  );
}
