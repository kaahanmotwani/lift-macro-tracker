/**
 * Splits a long paste into pieces small enough for one AI request each.
 *
 * Splits only *between sessions*: a session is a line that starts with a date
 * ("11/18 legs", "03/05 Shoulders + Triceps", "10/15") and everything up to the
 * next such line. Cutting mid-session would separate exercises from the date that
 * says when they happened. Sessions are then packed greedily up to the target
 * size; a single session larger than the target becomes its own piece.
 *
 * Notes with no date lines fall back to splitting at blank lines.
 *
 * The target is in characters. ~2,500 characters of shorthand notes is about
 * 8–10 sessions, whose structured form fits comfortably inside one response.
 */

const SESSION_START = /^[ \t]*\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/;

export function splitIntoChunks(text: string, target = 2500): string[] {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (normalized.length <= target) return [normalized];

  const lines = normalized.split("\n");
  const sections: string[] = [];
  let current: string[] = [];

  const hasDates = lines.some((l) => SESSION_START.test(l));
  for (const line of lines) {
    const boundary = hasDates ? SESSION_START.test(line) : line.trim() === "";
    if (boundary && current.some((l) => l.trim() !== "")) {
      sections.push(current.join("\n").trim());
      current = [];
    }
    current.push(line);
  }
  if (current.some((l) => l.trim() !== "")) sections.push(current.join("\n").trim());

  const chunks: string[] = [];
  let buffer = "";
  for (const section of sections) {
    if (buffer && buffer.length + section.length + 2 > target) {
      chunks.push(buffer);
      buffer = "";
    }
    buffer = buffer ? `${buffer}\n\n${section}` : section;
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}
