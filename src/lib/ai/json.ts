/**
 * Helpers for reading JSON that Claude wrote as plain text (the non-strict path
 * in claude.ts). Pure functions, no API calls, so they can be tested directly.
 */

/** Pulls the JSON object out of a reply, tolerating stray prose or code fences. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: unknown[];
  anyOf?: JsonSchema[];
};

/**
 * Smooths over harmless differences before validation, so a reply isn't
 * rejected over a technicality: a missing text field becomes "", a missing
 * list becomes [], a missing nullable number becomes null, "135" becomes 135.
 * Anything genuinely wrong (a missing required weight, an unknown enum value)
 * is left alone for Zod to report.
 */
export function conformToSchema(schema: JsonSchema | undefined, value: unknown): unknown {
  if (!schema) return value;
  if (schema.anyOf) {
    if (value == null && schema.anyOf.some((s) => s.type === "null")) return null;
    return conformToSchema(schema.anyOf.find((s) => s.type !== "null"), value);
  }
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (value == null && types.includes("null")) return null;

  if (types.includes("object")) {
    const source =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    return Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([key, sub]) => [
        key,
        conformToSchema(sub, source[key]),
      ]),
    );
  }
  if (types.includes("array")) {
    if (value == null) return [];
    return Array.isArray(value) ? value.map((v) => conformToSchema(schema.items, v)) : value;
  }
  if (types.includes("string") && !schema.enum) {
    if (value == null) return "";
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  if (types.includes("number") || types.includes("integer")) {
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  if (types.includes("boolean") && value == null) return false;
  return value;
}
