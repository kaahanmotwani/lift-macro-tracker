import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-3">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-sm text-[--color-muted]">
        That workout, exercise, or import doesn&rsquo;t exist — or isn&rsquo;t yours.
      </p>
      <Link href="/" className="text-[--color-accent]">
        Back to today
      </Link>
    </main>
  );
}
