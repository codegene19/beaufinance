import { tenant } from '@/lib/app-context';
import { PageHeader } from '@/components/ui/misc';
import { Card } from '@/components/ui/card';
import { Table, THead, Th, Tr, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export const metadata = { title: 'Audit log' };
export default async function Audit() {
  const rows = await tenant((tx) => tx.many(`select a.id, a.created_at, a.table_name, a.action, a.record_id, a.user_id, a.new_data, a.old_data from audit_logs a where a.business_id = $1 order by a.id desc limit 300`, [tx.businessId]));
  return (
    <>
      <PageHeader eyebrow="Settings" title="Audit log" description="Append-only record of inserts, updates and deletes on financial and inventory data (last 300)." />
      <Card>
        <Table><THead><tr><Th>When</Th><Th>Table</Th><Th>Action</Th><Th>Record</Th><Th>Summary</Th></tr></THead>
          <tbody>{rows.map((r: any) => {
            const d = r.new_data ?? r.old_data ?? {};
            const summary = [d.name, d.po_number, d.order_number, d.reference, d.lot_code, d.movement_type, d.amount && `amount ${d.amount}`, d.quantity && `qty ${d.quantity}`, d.status && `status ${d.status}`].filter(Boolean).join(' · ');
            return <Tr key={r.id}><Td muted className="whitespace-nowrap text-xs">{String(r.created_at).slice(0, 19)}</Td><Td>{r.table_name}</Td><Td><Badge tone={r.action === 'delete' ? 'rose' : r.action === 'insert' ? 'sage' : 'sky'}>{r.action}</Badge></Td><Td muted className="font-mono text-[11px]">{String(r.record_id).slice(0, 8)}</Td><Td className="text-xs">{summary}</Td></Tr>;
          })}</tbody>
        </Table>
      </Card>
    </>
  );
}
