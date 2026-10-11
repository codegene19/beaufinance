import Link from 'next/link';
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <h1 className="font-display text-4xl font-semibold">Not found</h1>
      <p className="mt-2 text-muted">This page or record does not exist, or you do not have access to it.</p>
      <Link href="/" className="mt-4 text-sage-700 underline">Back to overview</Link>
    </div>
  );
}
