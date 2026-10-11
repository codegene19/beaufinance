'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Select } from '@/components/ui/input';
import type { ActionResult } from '@/lib/errors';

export function StatusSelect({ value, options, action, label = 'Status' }: { value: string; options: { value: string; label: string }[]; action: (v: string) => Promise<ActionResult<unknown>>; label?: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Select
      aria-label={label}
      value={value}
      disabled={pending}
      className="h-8 w-auto text-xs"
      onChange={(e) => {
        const v = e.target.value;
        if (v === 'cancelled' && !confirm('Cancel this record? This cannot be undone.')) return;
        start(async () => {
          const r = await action(v);
          if (r.ok) { toast.success('Status updated'); router.refresh(); } else toast.error(r.error);
        });
      }}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  );
}
