/**
 * Verifies the AI schemas stay inside Anthropic's structured-output limits:
 *   - at most 16 union-typed properties (every `.nullable()` is a union)
 *   - at most 24 optional properties
 * Run with `npm run check:schemas`. Exits non-zero if a schema is over a limit,
 * so it can gate CI. This is the same counting the API does when it rejects a
 * request with "Schemas contains too many parameters with union types".
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ImportResultSchema, MicroSummarySchema, PhotoEstimateSchema } from "../src/lib/ai/schemas";

const UNION_LIMIT = 16;
const OPTIONAL_LIMIT = 24;

type Counts = { unions: number; optionals: number };

function walk(node: any, defs: Record<string, any>, seen: Set<string>, acc: Counts) {
  if (!node || typeof node !== "object") return;
  if (node.$ref) {
    const key = String(node.$ref).split("/").pop()!;
    if (seen.has(key)) return;
    seen.add(key);
    return walk(defs[key], defs, seen, acc);
  }
  const required = new Set<string>(node.required ?? []);
  for (const [name, prop] of Object.entries<any>(node.properties ?? {})) {
    if (Array.isArray(prop?.type) || Array.isArray(prop?.anyOf)) acc.unions++;
    if (!required.has(name)) acc.optionals++;
    walk(prop, defs, seen, acc);
  }
  if (node.items) walk(node.items, defs, seen, acc);
  for (const alt of node.anyOf ?? []) walk(alt, defs, seen, acc);
}

let failed = false;
for (const [name, schema] of Object.entries({ ImportResultSchema, PhotoEstimateSchema, MicroSummarySchema })) {
  const format: any = zodOutputFormat(schema);
  const json = format.schema;
  const acc: Counts = { unions: 0, optionals: 0 };
  walk(json, json.$defs ?? json.definitions ?? {}, new Set(), acc);
  const ok = acc.unions <= UNION_LIMIT && acc.optionals <= OPTIONAL_LIMIT;
  failed ||= !ok;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name.padEnd(20)} unions ${String(acc.unions).padStart(2)}/${UNION_LIMIT}   optional ${String(acc.optionals).padStart(2)}/${OPTIONAL_LIMIT}`,
  );
}
process.exit(failed ? 1 : 0);
