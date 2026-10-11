import { PageHeader, Callout } from '@/components/ui/misc';
import { ImportForm } from './import-form';
import { IMPORT_TEMPLATE } from '@/lib/services/import';

export const metadata = { title: 'Import orders' };
export default function ImportPage() {
  return (
    <>
      <PageHeader eyebrow="Sales" title="Import orders from CSV" description="One row per order line. Rows sharing an order_number form one order. Existing order numbers are skipped, so re-importing is safe." />
      <Callout tone="info" className="mb-4">Direct Shopify / WooCommerce / TikTok Shop connections are not connected yet — export orders from your platform and map the columns to this template.</Callout>
      <ImportForm template={IMPORT_TEMPLATE} />
    </>
  );
}
