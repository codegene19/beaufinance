'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { cn } from '@/components/ui/cn';
import type { ActionResult } from '@/lib/errors';

export function Field({ label, error, hint, children, className, required }: { label: React.ReactNode; error?: string; hint?: React.ReactNode; children: React.ReactNode; className?: string; required?: boolean }) {
  // Wrapping the control in <label> associates the text with the input for assistive technology.
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-[13px] font-medium text-ink-soft">
        {label}
        {required && <span className="ml-0.5 text-rose-600" aria-hidden>*</span>}
      </span>
      {children}
      {error ? <span className="text-xs text-rose-600" role="alert">{error}</span> : hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function FormSection({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-x-8 gap-y-4 border-b border-line py-6 last:border-0 lg:grid-cols-[220px_1fr]">
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {description && <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function newKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Submits through a server action; shows toasts; maps server-side field errors back onto the form.
 */
export function useActionSubmit<T extends FieldValues, R>(
  form: UseFormReturn<T> | null,
  action: (values: T) => Promise<ActionResult<R>>,
  opts: { success?: string; redirect?: (data: R) => string | null; onSuccess?: (data: R) => void } = {},
) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const submit = React.useCallback(
    (values: T) =>
      new Promise<void>((resolve) =>
        start(async () => {
          const r = await action(values);
          if (r.ok) {
            toast.success(opts.success ?? 'Saved');
            r.warnings?.forEach((w) => toast.warning(w, { duration: 9000 }));
            opts.onSuccess?.(r.data);
            const to = opts.redirect?.(r.data);
            if (to) router.push(to);
            else router.refresh();
          } else {
            toast.error(r.error);
            if (form && r.fieldErrors) for (const [k, msgs] of Object.entries(r.fieldErrors)) if (k !== '_form') form.setError(k as Path<T>, { message: msgs[0] });
          }
          resolve();
        }),
      ),
    [action, form, opts, router],
  );
  return { submit, pending };
}

export const err = (form: UseFormReturn<any>, name: string): string | undefined => {
  const parts = name.split('.');
  let e: any = form.formState.errors;
  for (const p of parts) e = e?.[p];
  return e?.message as string | undefined;
};
