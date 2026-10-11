import { tenant } from '@/lib/app-context';
import { PageHeader } from '@/components/ui/misc';
import { CampaignForm } from '../campaign-form';
import { variantOptions } from '../variants';

export const metadata = { title: 'New campaign' };
export default async function NewCampaign() {
  const variants = await tenant(variantOptions);
  const initial = { name: '', channel: 'meta', start_date: '', end_date: '', planned_budget: '0', is_prelaunch: false, allocation_method: 'delivered_orders', sessions: '', notes: '', products: [] };
  return (<><PageHeader eyebrow="Marketing" title="New campaign" description="Record spend as expenses linked to this campaign; attribute orders to it when recording sales." /><CampaignForm initial={initial} variants={variants} /></>);
}
