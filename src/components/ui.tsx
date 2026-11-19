import type { ComponentProps, ReactNode } from "react";

/**
 * Small, unstyled-ish primitives. Deliberately not a component library: this app
 * has about a dozen distinct UI shapes, and a dependency would cost more than it
 * saves. Tap targets are sized for a phone held one-handed in a gym.
 */

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-line bg-surface p-4 ${className}`}
    >
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {typeof title === "string" ? (
            <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">
              {title}
            </h2>
          ) : (
            title
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const styles = {
    primary: "bg-accent text-black font-semibold hover:brightness-110",
    secondary: "bg-surface-2 text-fg border border-line hover:bg-line",
    ghost: "text-muted hover:text-fg",
    danger: "bg-transparent text-red-400 border border-red-900/60 hover:bg-red-950/40",
  }[variant];

  return (
    <button
      {...props}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm transition disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

const inputBase =
  "w-full min-h-11 rounded-xl border border-line bg-surface-2 px-3 text-fg placeholder:text-muted/60 outline-none focus:border-accent";

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return <input {...props} className={`${inputBase} ${className}`} />;
}

export function Textarea({ className = "", ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={`${inputBase} py-2 leading-relaxed ${className}`} />;
}

export function Select({ className = "", ...props }: ComponentProps<"select">) {
  return <select {...props} className={`${inputBase} ${className}`} />;
}

export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "accent" | "muted";
}) {
  const valueTone = {
    default: "text-fg",
    accent: "text-accent",
    muted: "text-muted",
  }[tone];
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className={`tabular text-xl font-semibold ${valueTone}`}>{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-4 py-10 text-center">
      <p className="font-medium text-fg">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "warn" | "good" | "muted";
}) {
  const styles = {
    default: "bg-surface-2 text-muted border-line",
    warn: "bg-amber-950/50 text-amber-300 border-amber-900/60",
    good: "bg-emerald-950/50 text-emerald-300 border-emerald-900/60",
    muted: "bg-transparent text-muted border-line",
  }[tone];
  return (
    <span className={`inline-block rounded-md border px-1.5 py-0.5 text-[11px] ${styles}`}>
      {children}
    </span>
  );
}

/** A horizontal progress bar for "how close am I to today's protein target". */
export function TargetBar({
  label,
  value,
  target,
  unit = "g",
  color = "var(--color-accent)",
}: {
  label: string;
  value: number;
  target: number | null;
  unit?: string;
  color?: string;
}) {
  const pct = target ? Math.min(100, (value / target) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular text-fg">
          {Math.round(value)}
          {target ? <span className="text-muted"> / {Math.round(target)}</span> : null}
          <span className="text-muted"> {unit}</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

/** Renders the Markdown subset Claude actually emits for insights. */
export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let bullets: string[] = [];

  const flush = (key: string) => {
    if (!bullets.length) return;
    out.push(
      <ul key={key} className="my-2 list-disc space-y-1 pl-5 text-sm text-fg">
        {bullets.map((b, i) => (
          <li key={i}>{inline(b)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (/^[-*]\s+/.test(trimmed)) {
      bullets.push(trimmed.replace(/^[-*]\s+/, ""));
      return;
    }
    flush(`ul-${i}`);
    if (!trimmed) return;
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      const level = heading[1].length;
      out.push(
        <h3
          key={i}
          className={`mt-4 mb-1 font-semibold ${level <= 2 ? "text-base" : "text-sm"} text-fg`}
        >
          {inline(heading[2])}
        </h3>,
      );
      return;
    }
    out.push(
      <p key={i} className="my-2 text-sm leading-relaxed text-fg">
        {inline(trimmed)}
      </p>,
    );
  });
  flush("ul-end");

  return <div>{out}</div>;
}

/** Bold + inline code only — that's all the insights prompt produces. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-surface-2 px-1 text-[13px]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
