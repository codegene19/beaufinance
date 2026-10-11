import * as React from 'react';
import { cn } from './cn';

export function Table({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}
export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="border-b border-line bg-ivory/60 text-left text-[11.5px] font-semibold uppercase tracking-wide text-muted">{children}</thead>;
}
export function Th({ className, children, right }: { className?: string; children?: React.ReactNode; right?: boolean }) {
  return <th className={cn('px-4 py-2.5 font-semibold whitespace-nowrap', right && 'text-right', className)}>{children}</th>;
}
export function Tr({ className, children, ...p }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn('border-b border-line/70 last:border-0 hover:bg-ivory/50', className)} {...p}>
      {children}
    </tr>
  );
}
export function Td({ className, children, right, muted }: { className?: string; children?: React.ReactNode; right?: boolean; muted?: boolean }) {
  return <td className={cn('px-4 py-3 align-middle', right && 'text-right num whitespace-nowrap', muted && 'text-muted', className)}>{children}</td>;
}
