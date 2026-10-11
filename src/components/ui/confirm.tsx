'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Dialog } from './dialog';
import { Button, type ButtonProps } from './button';
import type { ActionResult } from '@/lib/errors';

/** Button that asks for confirmation before running a destructive / irreversible server action. */
export function ConfirmButton({
  action,
  title,
  description,
  confirmLabel = 'Confirm',
  successMessage,
  redirectTo,
  children,
  variant = 'secondary',
  size = 'sm',
  danger = true,
}: {
  action: () => Promise<ActionResult<unknown>>;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  successMessage?: string;
  redirectTo?: string;
  children: React.ReactNode;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  danger?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  const router = useRouter();
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={title}
      trigger={
        <Button variant={variant} size={size}>
          {children}
        </Button>
      }
    >
      <div className="text-sm text-ink-soft">{description}</div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
          Keep as is
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await action();
              if (r.ok) {
                toast.success(successMessage ?? 'Done');
                r.warnings?.forEach((w) => toast.warning(w));
                setOpen(false);
                if (redirectTo) router.push(redirectTo);
                else router.refresh();
              } else toast.error(r.error);
            })
          }
        >
          {pending ? 'Working…' : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
