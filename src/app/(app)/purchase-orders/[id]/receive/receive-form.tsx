'use client';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { formatISO } from 'date-fns';
import { receiveGoodsAction } from '@/app/actions/purchasing';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field, useActionSubmit, newKey } from '@/components/app/form';
import { Table, THead, Th, Tr, Td } from '@/components/ui/table';
import { Callout } from '@/components/ui/misc';

type Line = { po_item_id: string; label: string; sku: string; outstanding: number; has_expiry: boolean; shipment_lines: { shipment_id: string; shipment_item_id: string; outstanding: number }[] };

export function ReceiveForm({ poId, lines, shipments }: { poId: string; lines: Line[]; shipments: { id: string; reference: string }[] }) {
  const [shipmentId, setShipmentId] = React.useState(shipments[0]?.id ?? '');
  const rows = lines
    .map((l) => {
      const sl = l.shipment_lines.find((s) => s.shipment_id === shipmentId);
      return { ...l, shipment_item_id: sl?.shipment_item_id ?? null, max: shipmentId ? (sl ? Math.min(sl.outstanding, l.outstanding) : 0) : l.outstanding };
    })
    .filter((l) => l.max > 0);
  const form = useForm<any>({ defaultValues: { received_date: formatISO(new Date(), { representation: 'date' }), notes: '', lines: {} } });
  const { submit, pending } = useActionSubmit(form, receiveGoodsAction, { success: 'Goods received into stock', redirect: () => `/purchase-orders/${poId}` });
  const key = React.useMemo(() => newKey(), []);
  const r = form.register;
  return (
    <form
      onSubmit={form.handleSubmit((v) =>
        submit({
          purchase_order_id: poId, shipment_id: shipmentId || null, received_date: v.received_date, notes: v.notes, idempotency_key: key,
          lines: rows.map((l) => {
            const x = v.lines[l.po_item_id] ?? {};
            return { purchase_order_item_id: l.po_item_id, shipment_item_id: l.shipment_item_id, qty_received: x.received ?? 0, qty_damaged: x.damaged || 0, qty_rejected: x.rejected || 0, qty_missing: x.missing || 0, expiry_date: x.expiry || null, lot_code: x.lot || null };
          }),
        } as any),
      )}
    >
      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          {shipments.length > 0 && (
            <Field label="Shipment" hint="Receiving against a shipment links its freight & customs to these lots">
              <Select value={shipmentId} onChange={(e) => setShipmentId(e.target.value)}>
                {shipments.map((s) => <option key={s.id} value={s.id}>{s.reference}</option>)}
                <option value="">No shipment (direct delivery)</option>
              </Select>
            </Field>
          )}
          <Field label="Received date"><Input type="date" {...r('received_date')} /></Field>
          <Field label="Notes"><Textarea {...r('notes')} className="min-h-10" /></Field>
        </div>
      </Card>
      <Card className="mt-4">
        {rows.length === 0 ? <div className="p-5"><Callout tone="info">Nothing left to receive{shipmentId ? ' on this shipment' : ''}.</Callout></div> : (
          <Table>
            <THead><tr><Th>Product</Th><Th right>Outstanding</Th><Th>Received (counted)</Th><Th>Of which damaged</Th><Th>Rejected</Th><Th>Missing</Th><Th>Expiry date</Th><Th>Lot code</Th></tr></THead>
            <tbody>
              {rows.map((l) => (
                <Tr key={l.po_item_id}>
                  <Td><div className="font-medium">{l.label}</div><div className="text-xs text-muted">{l.sku}</div></Td>
                  <Td right>{l.max}</Td>
                  <Td><Input type="number" min={0} max={l.max} defaultValue={l.max} {...r(`lines.${l.po_item_id}.received`, { valueAsNumber: true })} className="h-9 w-24" /></Td>
                  <Td><Input type="number" min={0} defaultValue={0} {...r(`lines.${l.po_item_id}.damaged`, { valueAsNumber: true })} className="h-9 w-20" /></Td>
                  <Td><Input type="number" min={0} defaultValue={0} {...r(`lines.${l.po_item_id}.rejected`, { valueAsNumber: true })} className="h-9 w-20" /></Td>
                  <Td><Input type="number" min={0} defaultValue={0} {...r(`lines.${l.po_item_id}.missing`, { valueAsNumber: true })} className="h-9 w-20" /></Td>
                  <Td><Input type="date" {...r(`lines.${l.po_item_id}.expiry`)} className="h-9 w-40" required={false} /></Td>
                  <Td><Input {...r(`lines.${l.po_item_id}.lot`)} placeholder="auto" className="h-9 w-32" /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="border-t border-line px-5 py-3 text-xs text-muted">
          Only sellable units (received − damaged − rejected) enter stock. Missing units are recorded but never stocked; their cost is absorbed by the sellable units.
          Products with a shelf life get an estimated expiry if left blank.
        </div>
      </Card>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => history.back()}>Cancel</Button>
        <Button type="submit" disabled={pending || rows.length === 0}>{pending ? 'Receiving…' : 'Receive into inventory'}</Button>
      </div>
    </form>
  );
}
