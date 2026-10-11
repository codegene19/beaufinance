export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-9 w-64 rounded-lg bg-ivory-deep" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 rounded-xl bg-ivory-deep" />)}
      </div>
      <div className="h-80 rounded-xl bg-ivory-deep" />
    </div>
  );
}
