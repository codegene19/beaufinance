'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Trash2, Paperclip } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { addDocumentAction, deleteDocumentAction } from '@/app/actions/catalog';

export function Documents({ productId, docs }: { productId: string; docs: { id: string; name: string; url: string }[] }) {
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [pending, start] = React.useTransition();
  return (
    <div className="space-y-3">
      {docs.length === 0 && <p className="text-sm text-muted">No documents yet (specification sheets, certificates, COA, invoices).</p>}
      <ul className="space-y-1">
        {docs.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
            <a href={d.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 text-sage-700 hover:underline"><Paperclip className="size-3.5 shrink-0" /><span className="truncate">{d.name}</span></a>
            <Button variant="ghost" size="icon" aria-label={`Remove ${d.name}`} onClick={() => start(async () => { const r = await deleteDocumentAction(d.id); r.ok ? router.refresh() : toast.error(r.error); })}><Trash2 /></Button>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await addDocumentAction(productId, { name, url });
            if (r.ok) { setName(''); setUrl(''); router.refresh(); toast.success('Document linked'); } else toast.error(r.error);
          });
        }}
      >
        <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
        <Input placeholder="https://drive…" value={url} onChange={(e) => setUrl(e.target.value)} className="h-9" />
        <Button size="sm" variant="secondary" disabled={pending || !name || !url}>Link</Button>
      </form>
    </div>
  );
}
