import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function Pagination({ page, pageSize, total, basePath, params }: { page: number; pageSize: number; total: number; basePath: string; params: Record<string, string | string[] | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return <div className="px-4 py-3 text-xs text-muted">{total} record{total === 1 ? '' : 's'}</div>;
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (typeof v === 'string' && k !== 'page') q.set(k, v);
    q.set('page', String(p));
    return `${basePath}?${q.toString()}`;
  };
  return (
    <div className="no-print flex items-center justify-between px-4 py-3 text-sm text-muted">
      <span>
        {total} records · page {page} of {pages}
      </span>
      <div className="flex gap-1">
        {page > 1 && (
          <Link className="inline-flex items-center rounded-md border border-line px-2 py-1 hover:bg-ivory-deep" href={href(page - 1)} aria-label="Previous page">
            <ChevronLeft className="size-4" />
          </Link>
        )}
        {page < pages && (
          <Link className="inline-flex items-center rounded-md border border-line px-2 py-1 hover:bg-ivory-deep" href={href(page + 1)} aria-label="Next page">
            <ChevronRight className="size-4" />
          </Link>
        )}
      </div>
    </div>
  );
}
