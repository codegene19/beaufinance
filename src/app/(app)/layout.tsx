import { getAppContext } from '@/lib/app-context';
import { AppShell } from '@/components/app/nav';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAppContext();
  return (
    <AppShell businesses={ctx.memberships} current={ctx.business} email={ctx.user.email}>
      {children}
    </AppShell>
  );
}
