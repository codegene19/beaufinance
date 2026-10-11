'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Dialog as D } from 'radix-ui';
import {
  LayoutDashboard, Package, Factory, ClipboardList, Ship, Boxes, ShoppingBag, Megaphone, Receipt, Calculator, RefreshCcw, Wallet, FileBarChart, Settings, Menu, X, Leaf, LogOut, ChevronsUpDown, FlaskConical, TrendingUp,
} from 'lucide-react';
import { cn } from '@/components/ui/cn';
import { switchBusinessAction, signOutAction } from '@/app/actions/auth';
import { toast } from 'sonner';

export const NAV = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/products', label: 'Products', icon: Package },
  { href: '/suppliers', label: 'Suppliers', icon: Factory },
  { href: '/purchase-orders', label: 'Purchase orders', icon: ClipboardList },
  { href: '/shipments', label: 'Shipments & import costs', icon: Ship },
  { href: '/inventory', label: 'Inventory & stock lots', icon: Boxes },
  { href: '/sales', label: 'Sales & orders', icon: ShoppingBag },
  { href: '/marketing', label: 'Advertising & marketing', icon: Megaphone },
  { href: '/expenses', label: 'Expenses', icon: Receipt },
  { href: '/pricing', label: 'Pricing calculator', icon: Calculator },
  { href: '/profitability', label: 'Profitability', icon: TrendingUp },
  { href: '/reorder', label: 'Reorder planning', icon: RefreshCcw },
  { href: '/cash-flow', label: 'Cash flow', icon: Wallet },
  { href: '/reports', label: 'Reports', icon: FileBarChart },
  { href: '/settings', label: 'Settings', icon: Settings },
];

type Biz = { id: string; name: string; is_demo: boolean; role: string };

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {NAV.map((n) => {
        const active = n.href === '/' ? path === '/' : path === n.href || path.startsWith(`${n.href}/`);
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition-colors',
              active ? 'bg-sage-700 text-white shadow-sm' : 'text-sage-100/80 hover:bg-sage-700/50 hover:text-white',
            )}
          >
            <n.icon className="size-[17px] shrink-0" />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

function BusinessSwitcher({ businesses, current }: { businesses: Biz[]; current: Biz }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 rounded-lg border border-sage-700 bg-sage-800/60 px-3 py-2 text-left hover:bg-sage-700/40" aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-white">{current.name}</div>
          <div className="text-[11px] text-sage-200/70">{current.is_demo ? 'Demo data' : 'Live business'} · {current.role}</div>
        </div>
        <ChevronsUpDown className="size-4 text-sage-200/70" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-line bg-paper py-1 text-ink shadow-xl">
          {businesses.map((b) => (
            <button
              key={b.id}
              className={cn('flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ivory-deep', b.id === current.id && 'font-semibold')}
              onClick={async () => {
                setOpen(false);
                const r = await switchBusinessAction(b.id);
                if (!r.ok) toast.error(r.error);
                router.push('/');
                router.refresh();
              }}
            >
              {b.is_demo && <FlaskConical className="size-3.5 text-champagne-700" />}
              <span className="truncate">{b.name}</span>
            </button>
          ))}
          <Link href="/settings?tab=data" onClick={() => setOpen(false)} className="block border-t border-line px-3 py-2 text-xs text-sage-700 hover:bg-ivory-deep">
            Create business or demo…
          </Link>
        </div>
      )}
    </div>
  );
}

function SidebarContent({ businesses, current, email, onNavigate }: { businesses: Biz[]; current: Biz; email: string; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <Link href="/" className="flex items-center gap-2 px-2 pt-1 text-white" onClick={onNavigate}>
        <span className="flex size-8 items-center justify-center rounded-full bg-champagne-500/20">
          <Leaf className="size-4 text-champagne-300" />
        </span>
        <span className="font-display text-xl font-semibold tracking-wide">BeauFinance</span>
      </Link>
      <BusinessSwitcher businesses={businesses} current={current} />
      <div className="-mx-1 flex-1 overflow-y-auto px-1">
        <NavLinks onNavigate={onNavigate} />
      </div>
      <div className="border-t border-sage-700 pt-3">
        <div className="truncate px-2 text-xs text-sage-200/70">{email}</div>
        <form action={signOutAction}>
          <button className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-sage-100/80 hover:bg-sage-700/50 hover:text-white">
            <LogOut className="size-4" /> Sign out
          </button>
        </form>
      </div>
    </div>
  );
}

export function AppShell({ businesses, current, email, children }: { businesses: Biz[]; current: Biz; email: string; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 bg-sage-800 lg:block">
        <SidebarContent businesses={businesses} current={current} email={email} />
      </aside>
      <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-ivory/90 px-4 backdrop-blur lg:hidden">
        <D.Root open={open} onOpenChange={setOpen}>
          <D.Trigger className="rounded-md p-1.5 hover:bg-ivory-deep" aria-label="Open menu">
            <Menu className="size-5" />
          </D.Trigger>
          <D.Portal>
            <D.Overlay className="fixed inset-0 z-40 bg-ink/40" />
            <D.Content className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-sage-800 shadow-2xl">
              <D.Title className="sr-only">Navigation</D.Title>
              <D.Description className="sr-only">Main navigation</D.Description>
              <D.Close className="absolute right-3 top-4 rounded p-1 text-sage-100 hover:bg-sage-700" aria-label="Close menu">
                <X className="size-5" />
              </D.Close>
              <SidebarContent businesses={businesses} current={current} email={email} onNavigate={() => setOpen(false)} />
            </D.Content>
          </D.Portal>
        </D.Root>
        <Link href="/" className="font-display text-lg font-semibold">BeauFinance</Link>
        {current.is_demo && <span className="ml-auto rounded-full bg-champagne-100 px-2 py-0.5 text-[11px] font-semibold text-champagne-700">DEMO</span>}
      </header>
      {current.is_demo && (
        <div className="no-print hidden items-center gap-2 border-b border-champagne-300 bg-champagne-100 px-8 py-1.5 text-xs text-champagne-700 lg:flex">
          <FlaskConical className="size-3.5" /> You are viewing a <strong>demo business with sample data</strong>. It is fully separate from your real business — switch businesses in the sidebar.
        </div>
      )}
      <main className="print-full mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
