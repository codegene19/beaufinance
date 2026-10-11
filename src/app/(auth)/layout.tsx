import { Leaf } from 'lucide-react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-sage-800 p-12 text-sage-50 lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-sage-700/50" />
        <div className="absolute -bottom-32 -left-20 size-[28rem] rounded-full bg-champagne-500/15" />
        <div className="relative flex items-center gap-2 text-lg font-semibold">
          <Leaf className="size-5 text-champagne-300" /> BeauFinance
        </div>
        <div className="relative max-w-md">
          <h1 className="font-display text-5xl font-semibold leading-tight">Know your true cost. Price with confidence. Reorder on time.</h1>
          <p className="mt-5 text-sage-100/80">Landed costs, margins, stock and cash for natural beauty brands sourcing from Morocco — built on your real transactions, not guesswork.</p>
        </div>
        <div className="relative text-xs text-sage-100/60">Financial figures are management estimates — review tax treatment with your accountant.</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
