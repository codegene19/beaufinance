import * as React from 'react';
import { cn } from './cn';

const base =
  'w-full rounded-lg border border-line-strong bg-paper px-3 text-sm text-ink placeholder:text-muted/70 focus:border-sage-500 focus:outline-none focus:ring-2 focus:ring-sage-200 disabled:bg-ivory-deep disabled:text-muted aria-[invalid=true]:border-rose-600';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(base, 'h-10', props.type === 'number' && 'num', className)} {...props} />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(base, 'min-h-20 py-2', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn(base, 'h-10 pr-8 appearance-none bg-[url("data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%236f7275%27 stroke-width=%272%27><path d=%27m6 9 6 6 6-6%27/></svg>")] bg-[right_0.7rem_center] bg-no-repeat', className)} {...props}>
    {children}
  </select>
));
Select.displayName = 'Select';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-[13px] font-medium text-ink-soft', className)} {...props} />;
}

export function Checkbox({ label, hint, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className={cn('flex items-start gap-2.5 text-sm text-ink cursor-pointer', className)}>
      <input type="checkbox" className="mt-0.5 size-4 rounded border-line-strong accent-sage-700" {...props} />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}
