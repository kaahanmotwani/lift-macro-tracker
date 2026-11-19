"use client";

import { useId, useRef, useState } from "react";
import { formatDate } from "@/lib/units";

/**
 * Hand-rolled SVG charts. No charting dependency: this app draws four shapes,
 * and owning them outright is cheaper than a library plus its React-version
 * churn — and lets the "partial log" state be a first-class visual, which is the
 * one thing off-the-shelf charts can't express.
 *
 * Colors are the validated dark-mode categorical slots, assigned in fixed slot
 * order and never cycled. Single-series charts all use slot 1, so a color means
 * the same thing across the app.
 */
export const SERIES = {
  s1: "#3987e5", // blue
  s2: "#d95926", // orange
  s3: "#199e70", // aqua
  s4: "#c98500", // yellow
} as const;

const GRID = "#2c2c2a";
const AXIS = "#383835";
const MUTED = "#898781";

export type Point = {
  date: string;
  value: number | null;
  /** Untracked days break the line; partial days render dimmed. Neither is a zero. */
  state?: "complete" | "partial" | "untracked";
  label?: string;
};

function niceMax(v: number): number {
  if (v <= 0) return 10;
  const mag = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / mag) * mag;
}

// -----------------------------------------------------------------------------
// Line chart — one series over time
// -----------------------------------------------------------------------------

export function LineChart({
  points,
  color = SERIES.s1,
  unit = "",
  title,
  height = 200,
  yFromZero = true,
}: {
  points: Point[];
  color?: string;
  unit?: string;
  title: string;
  height?: number;
  yFromZero?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const clipId = useId();

  const W = 720;
  const H = height;
  const PAD = { top: 14, right: 16, bottom: 26, left: 44 };

  const real = points.filter((p) => p.value !== null) as (Point & { value: number })[];
  if (real.length === 0) {
    return <ChartShell title={title}>Nothing logged in this window yet.</ChartShell>;
  }

  const values = real.map((p) => p.value);
  const rawMax = Math.max(...values);
  const rawMin = Math.min(...values);
  // Weight and 1RM series don't start at zero — a 5 lb change on a 200 lb lift is
  // invisible on a zero-based axis, which is the whole question being asked.
  const max = yFromZero ? niceMax(rawMax) : rawMax + (rawMax - rawMin) * 0.15 + 1;
  const min = yFromZero ? 0 : rawMin - (rawMax - rawMin) * 0.15 - 1;
  const span = max - min || 1;

  const x = (i: number) =>
    PAD.left + (i / Math.max(1, points.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - min) / span) * (H - PAD.top - PAD.bottom);

  // Break the path wherever data is missing, rather than drawing a straight line
  // through days the user never logged.
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
      return;
    }
    current.push(`${current.length === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`);
  });
  if (current.length > 1) segments.push(current.join(" "));

  const ticks = [0, 0.5, 1].map((t) => min + t * span);
  const hovered = hover !== null ? points[hover] : null;

  function onMove(clientX: number) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    const ratio = (px - PAD.left) / (W - PAD.left - PAD.right);
    const idx = Math.round(ratio * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, idx)));
  }

  return (
    <ChartShell title={title} points={points} unit={unit}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        style={{ height }}
        role="img"
        aria-label={title}
        onMouseMove={(e) => onMove(e.clientX)}
        onMouseLeave={() => setHover(null)}
        onTouchStart={(e) => onMove(e.touches[0].clientX)}
        onTouchMove={(e) => onMove(e.touches[0].clientX)}
        onTouchEnd={() => setHover(null)}
      >
        <defs>
          <linearGradient id={clipId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke={GRID}
              strokeWidth="1"
            />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={MUTED}>
              {Math.round(t)}
            </text>
          </g>
        ))}

        {segments.map((d, i) => (
          <path key={`f${i}`} d={`${d} L ${W - PAD.right} ${y(min)} L ${PAD.left} ${y(min)} Z`} fill={`url(#${clipId})`} />
        ))}
        {segments.map((d, i) => (
          <path
            key={`l${i}`}
            d={d}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* Partially-logged days get a hollow marker: the value is real but incomplete. */}
        {points.map((p, i) =>
          p.value !== null && p.state === "partial" ? (
            <circle
              key={`p${i}`}
              cx={x(i)}
              cy={y(p.value)}
              r="4"
              fill="var(--color-surface)"
              stroke={color}
              strokeWidth="2"
            />
          ) : null,
        )}

        {hovered && hovered.value !== null && (
          <g>
            <line
              x1={x(hover!)}
              x2={x(hover!)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke={AXIS}
              strokeWidth="1"
            />
            {/* 2px surface ring keeps the marker legible over the line and fill. */}
            <circle cx={x(hover!)} cy={y(hovered.value)} r="6" fill={color} stroke="var(--color-surface)" strokeWidth="2" />
          </g>
        )}

        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke={AXIS} strokeWidth="1" />
        <text x={PAD.left} y={H - 8} fontSize="11" fill={MUTED}>
          {formatDate(points[0].date, { month: "short", day: "numeric", weekday: undefined })}
        </text>
        <text x={W - PAD.right} y={H - 8} fontSize="11" fill={MUTED} textAnchor="end">
          {formatDate(points[points.length - 1].date, { month: "short", day: "numeric", weekday: undefined })}
        </text>
      </svg>

      <Tooltip point={hovered} unit={unit} />
    </ChartShell>
  );
}

// -----------------------------------------------------------------------------
// Stacked bars — macro breakdown per day
// -----------------------------------------------------------------------------

export type StackRow = {
  date: string;
  values: number[];
  state?: "complete" | "partial" | "untracked";
};

export function StackedBarChart({
  rows,
  seriesNames,
  colors = [SERIES.s1, SERIES.s2, SERIES.s3, SERIES.s4],
  unit = "g",
  title,
  height = 220,
}: {
  rows: StackRow[];
  seriesNames: string[];
  colors?: string[];
  unit?: string;
  title: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const W = 720;
  const H = height;
  const PAD = { top: 14, right: 16, bottom: 26, left: 44 };

  const totals = rows.map((r) => r.values.reduce((a, b) => a + b, 0));
  const max = niceMax(Math.max(1, ...totals));
  const plotH = H - PAD.top - PAD.bottom;
  const plotW = W - PAD.left - PAD.right;
  const slot = plotW / Math.max(1, rows.length);
  const barW = Math.max(3, Math.min(28, slot - 3));

  if (rows.every((r) => r.values.every((v) => !v))) {
    return <ChartShell title={title}>Nothing logged in this window yet.</ChartShell>;
  }

  return (
    <ChartShell title={title}>
      <Legend names={seriesNames} colors={colors} />
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-none" style={{ height }} role="img" aria-label={title}>
        {[0, 0.5, 1].map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={PAD.top + (1 - t) * plotH}
              y2={PAD.top + (1 - t) * plotH}
              stroke={GRID}
              strokeWidth="1"
            />
            <text x={PAD.left - 8} y={PAD.top + (1 - t) * plotH + 4} textAnchor="end" fontSize="11" fill={MUTED}>
              {Math.round(t * max)}
            </text>
          </g>
        ))}

        {rows.map((row, i) => {
          const cx = PAD.left + slot * i + slot / 2;
          let acc = 0;
          const isUntracked = row.state === "untracked" || totals[i] === 0;

          if (isUntracked) {
            // An untracked day is drawn as an explicit gap marker, never a zero bar —
            // "didn't log" and "ate nothing" must not look the same.
            return (
              <line
                key={row.date}
                x1={cx}
                x2={cx}
                y1={PAD.top + plotH - 3}
                y2={PAD.top + plotH}
                stroke={AXIS}
                strokeWidth="2"
                strokeLinecap="round"
              />
            );
          }

          return (
            <g
              key={row.date}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              opacity={row.state === "partial" ? 0.55 : 1}
            >
              {/* Invisible wide hit target — the bar itself is too thin to hover on a phone. */}
              <rect x={cx - slot / 2} y={PAD.top} width={slot} height={plotH} fill="transparent" />
              {row.values.map((v, s) => {
                if (!v) return null;
                const h = (v / max) * plotH;
                const yTop = PAD.top + plotH - acc - h;
                acc += h;
                const isTop = row.values.slice(s + 1).every((x) => !x);
                return (
                  <rect
                    key={s}
                    x={cx - barW / 2}
                    y={yTop}
                    width={barW}
                    // 2px surface gap between stacked segments so adjacent hues never touch.
                    height={Math.max(0, h - 2)}
                    rx={isTop ? 4 : 0}
                    fill={colors[s % colors.length]}
                  />
                );
              })}
            </g>
          );
        })}

        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke={AXIS} strokeWidth="1" />
        <text x={PAD.left} y={H - 8} fontSize="11" fill={MUTED}>
          {formatDate(rows[0].date, { month: "short", day: "numeric", weekday: undefined })}
        </text>
        <text x={W - PAD.right} y={H - 8} fontSize="11" fill={MUTED} textAnchor="end">
          {formatDate(rows[rows.length - 1].date, { month: "short", day: "numeric", weekday: undefined })}
        </text>
      </svg>

      {hover !== null && (
        <div className="mt-2 rounded-lg border border-[--color-line] bg-[--color-surface-2] px-3 py-2 text-xs">
          <div className="mb-1 font-medium">
            {formatDate(rows[hover].date)}
            {rows[hover].state === "partial" && (
              <span className="ml-2 text-amber-300">partially logged</span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {seriesNames.map((n, s) => (
              <span key={n} className="tabular text-[--color-muted]">
                <span
                  className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                  style={{ background: colors[s % colors.length] }}
                />
                {n} {Math.round(rows[hover].values[s] ?? 0)}
                {unit}
              </span>
            ))}
          </div>
        </div>
      )}

      <DataTable
        caption={title}
        head={["Date", ...seriesNames, "Log"]}
        body={rows.map((r) => [
          formatDate(r.date),
          ...r.values.map((v) => String(Math.round(v))),
          r.state ?? "complete",
        ])}
      />
    </ChartShell>
  );
}

// -----------------------------------------------------------------------------
// Horizontal bars — sets per body part
// -----------------------------------------------------------------------------

export function HBarChart({
  items,
  title,
  unit = "sets",
}: {
  items: { label: string; value: number }[];
  title: string;
  unit?: string;
}) {
  if (items.length === 0) {
    return <ChartShell title={title}>No training logged in this window.</ChartShell>;
  }
  const max = Math.max(...items.map((i) => i.value)) || 1;

  return (
    <ChartShell title={title}>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-3">
            <span className="w-24 shrink-0 truncate text-xs capitalize text-[--color-muted]">
              {item.label}
            </span>
            <span className="h-4 flex-1 overflow-hidden rounded-md bg-[--color-surface-2]">
              <span
                className="block h-full rounded-md"
                style={{ width: `${(item.value / max) * 100}%`, background: SERIES.s1 }}
              />
            </span>
            <span className="tabular w-14 shrink-0 text-right text-xs text-[--color-text]">
              {Math.round(item.value * 10) / 10} {unit}
            </span>
          </li>
        ))}
      </ul>
    </ChartShell>
  );
}

// -----------------------------------------------------------------------------
// Shared chrome
// -----------------------------------------------------------------------------

function ChartShell({
  title,
  children,
  points,
  unit,
}: {
  title: string;
  children: React.ReactNode;
  points?: Point[];
  unit?: string;
}) {
  return (
    <div className="rounded-2xl border border-[--color-line] bg-[--color-surface] p-4">
      <h3 className="mb-3 text-sm font-semibold text-[--color-text]">{title}</h3>
      {typeof children === "string" ? (
        <p className="py-6 text-center text-sm text-[--color-muted]">{children}</p>
      ) : (
        children
      )}
      {points && (
        <DataTable
          caption={title}
          head={["Date", `Value${unit ? ` (${unit})` : ""}`, "Log"]}
          body={points.map((p) => [
            formatDate(p.date),
            p.value === null ? "—" : String(Math.round(p.value * 10) / 10),
            p.state ?? "complete",
          ])}
        />
      )}
    </div>
  );
}

function Legend({ names, colors }: { names: string[]; colors: string[] }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
      {names.map((n, i) => (
        <li key={n} className="flex items-center gap-1.5 text-xs text-[--color-muted]">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: colors[i % colors.length] }}
          />
          {n}
        </li>
      ))}
    </ul>
  );
}

function Tooltip({ point, unit }: { point: Point | null; unit?: string }) {
  if (!point || point.value === null) {
    return <div className="mt-2 h-8" aria-hidden />;
  }
  return (
    <div className="mt-2 rounded-lg border border-[--color-line] bg-[--color-surface-2] px-3 py-1.5 text-xs">
      <span className="text-[--color-muted]">{formatDate(point.date)}</span>{" "}
      <span className="tabular font-medium text-[--color-text]">
        {Math.round(point.value * 10) / 10}
        {unit}
      </span>
      {point.label && <span className="ml-2 text-[--color-muted]">{point.label}</span>}
      {point.state === "partial" && <span className="ml-2 text-amber-300">partial log</span>}
    </div>
  );
}

/** Every chart ships a text equivalent — this is the accessibility path, not a debug view. */
function DataTable({
  caption,
  head,
  body,
}: {
  caption: string;
  head: string[];
  body: string[][];
}) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs text-[--color-muted]">View as table</summary>
      <div className="mt-2 max-h-56 overflow-auto rounded-lg border border-[--color-line]">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-[--color-surface-2] text-[--color-muted]">
            <tr>
              {head.map((h) => (
                <th key={h} className="px-2 py-1 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular">
            {body.map((row, i) => (
              <tr key={i} className="border-t border-[--color-line]">
                {row.map((cell, j) => (
                  <td key={j} className="px-2 py-1">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
