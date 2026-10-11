'use client';
import * as React from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { setShipmentItemsAction } from '@/app/actions/purchasing';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, THead, Th, Tr, Td } from '@/components/ui/table';

type Line = { po_item_id: string; po_number: string; product_name: string; variant_name: string; sku: string; quantity: number; qty_shipped: number; in_this_shipment: number | null; weight_kg: string | null; total_weight_kg?: string | null; total_volume_m3?: string | null };

export function ItemsEditor({ shipmentId, lines, preselectPo }: { shipmentId: string; lines: Line[]; preselectPo?: string }) {
  const router = useRouter();
  const [state, setState] = React.useState(() =>
    Object.fromEntries(lines.map((l) => {
      const other = l.qty_shipped - (l.in_this_shipment ?? 0);
      const pre = l.in_this_shipment ?? (preselectPo && (l as any).purchase_order_id === preselectPo ? l.quantity - other : 0);
      return [l.po_item_id, { qty: String(pre), weight: l.total_weight_kg ?? '', volume: l.total_volume_m3 ?? '' }];
    })),
  );
  const [pending, start] = React.useTransition();
  if (lines.length === 0) return <p className="p-5 text-sm text-muted">No open purchase order lines. Create a purchase order (status ordered or later) first.</p>;
  return (
    <div>
      <Table>
        <THead><tr><Th>PO</Th><Th>Product</Th><Th right>Ordered</Th><Th right>In other shipments</Th><Th>Qty in this shipment</Th><Th>Total weight kg (override)</Th><Th>Total volume m³</Th></tr></THead>
        <tbody>
          {lines.map((l) => {
            const other = l.qty_shipped - (l.in_this_shipment ?? 0);
            const s = state[l.po_item_id];
            return (
              <Tr key={l.po_item_id}>
                <Td muted>{l.po_number}</Td>
                <Td><span className="font-medium">{l.product_name}</span> — {l.variant_name}<div className="text-xs text-muted">{l.sku}{l.weight_kg ? ` · ${l.weight_kg} kg/unit` : ' · no unit weight'}</div></Td>
                <Td right>{l.quantity}</Td>
                <Td right>{other}</Td>
                <Td><Input type="number" min={0} max={l.quantity - other} value={s.qty} onChange={(e) => setState({ ...state, [l.po_item_id]: { ...s, qty: e.target.value } })} className="h-9 w-24" aria-label={`Quantity ${l.sku}`} /></Td>
                <Td><Input inputMode="decimal" value={s.weight} placeholder={l.weight_kg ? `${(Number(l.weight_kg) * Number(s.qty || 0)).toFixed(2)} (calc.)` : 'required for weight'} onChange={(e) => setState({ ...state, [l.po_item_id]: { ...s, weight: e.target.value } })} className="h-9 w-36" /></Td>
                <Td><Input inputMode="decimal" value={s.volume} onChange={(e) => setState({ ...state, [l.po_item_id]: { ...s, volume: e.target.value } })} className="h-9 w-28" /></Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
      <div className="flex justify-end border-t border-line px-5 py-3">
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const items = Object.entries(state).map(([id, s]) => ({ purchase_order_item_id: id, quantity: Number(s.qty || 0), total_weight_kg: s.weight || null, total_volume_m3: s.volume || null }));
              const r = await setShipmentItemsAction(shipmentId, { items });
              if (r.ok) { toast.success('Shipment contents saved; landed costs recalculated'); router.refresh(); } else toast.error(r.error);
            })
          }
        >
          {pending ? 'Saving…' : 'Save shipment contents'}
        </Button>
      </div>
    </div>
  );
}
