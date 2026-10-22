import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
      <p className="text-5xl font-bold tracking-tight text-muted">404</p>
      <h1 className="text-lg font-semibold">Offside — this page doesn&apos;t exist</h1>
      <Link href="/" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:bg-accent-strong">
        Back to overview
      </Link>
    </div>
  );
}
