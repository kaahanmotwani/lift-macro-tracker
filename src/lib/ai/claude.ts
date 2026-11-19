import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { blanksToNull, type Blankable } from "@/lib/ai/schemas";
import { decryptSecret } from "@/lib/crypto";
import { getProfile } from "@/lib/supabase/server";

export const DEFAULT_MODEL = "claude-opus-5";

/** Thrown when the user hasn't added an API key. The UI turns this into a link to Settings. */
export class MissingKeyError extends Error {
  constructor() {
    super(
      "No Anthropic API key configured. Add yours in Settings — AI features are billed to your own Anthropic account.",
    );
    this.name = "MissingKeyError";
  }
}

/** Thrown when Claude declines a request. Rare here, but surfaced honestly rather than as a crash. */
export class RefusalError extends Error {
  constructor(detail?: string) {
    super(`Claude declined this request${detail ? `: ${detail}` : "."}`);
    this.name = "RefusalError";
  }
}

/**
 * Builds a Claude client for the *current user*, using the API key they saved in
 * Settings. Each user pays for their own usage; the deployment owner pays
 * nothing. ANTHROPIC_API_KEY is honored as a fallback only if the operator
 * deliberately set one.
 */
export async function getClaude(): Promise<{ client: Anthropic; model: string }> {
  const profile = await getProfile();

  let apiKey: string | undefined;
  if (profile?.anthropic_key_ciphertext) {
    apiKey = decryptSecret(profile.anthropic_key_ciphertext);
  } else if (process.env.ANTHROPIC_API_KEY) {
    apiKey = process.env.ANTHROPIC_API_KEY;
  }

  if (!apiKey) throw new MissingKeyError();

  return {
    // A long import makes many calls back to back; new Anthropic accounts have
    // low per-minute limits, so lean on the SDK's 429 backoff (which honors the
    // server's retry-after) rather than failing a chunk on the first throttle.
    client: new Anthropic({ apiKey, maxRetries: 5 }),
    model: profile?.model || DEFAULT_MODEL,
  };
}

type Content = Anthropic.MessageParam["content"];

/**
 * `stop_details` is only populated when stop_reason is "refusal", and its exact
 * type has moved around across SDK releases — read it defensively so a version
 * bump can't break the build over an error path.
 */
function refusalDetail(response: unknown): string | undefined {
  const details = (response as { stop_details?: { explanation?: string | null } })
    .stop_details;
  return details?.explanation ?? undefined;
}

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Adaptive thinking and the `effort` control exist on the Claude 5 models, but
 * Haiku 4.5 predates both and rejects a request that includes either. Haiku is
 * offered in Settings as the cheap option, so for it we send neither: it simply
 * answers without the extra reasoning pass, which is a large part of why it's
 * cheaper.
 */
function reasoningFor(model: string, effort: Effort) {
  const supported = !model.startsWith("claude-haiku");
  return supported
    ? { thinking: { type: "adaptive" as const }, effort }
    : { thinking: undefined, effort: undefined };
}

/**
 * One structured call to Claude. The Zod schema is enforced by the API, so the
 * return value is already the right shape — no defensive JSON parsing, no
 * "sometimes it wraps it in a code fence".
 */
export async function askForStructure<T extends z.ZodType>(opts: {
  schema: T;
  system: string;
  content: Content;
  effort?: Effort;
  maxTokens?: number;
}): Promise<Blankable<z.infer<T>>> {
  const { client, model } = await getClaude();

  const reasoning = reasoningFor(model, opts.effort ?? "medium");

  const response = await client.messages.parse({
    model,
    max_tokens: opts.maxTokens ?? 16000,
    ...(reasoning.thinking ? { thinking: reasoning.thinking } : {}),
    output_config: {
      ...(reasoning.effort ? { effort: reasoning.effort } : {}),
      format: zodOutputFormat(opts.schema),
    },
    system: opts.system,
    messages: [{ role: "user", content: opts.content }],
  });

  if (response.stop_reason === "refusal") {
    throw new RefusalError(refusalDetail(response));
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      "The response was cut off before it finished. Try importing a smaller chunk of text.",
    );
  }
  if (!response.parsed_output) {
    throw new Error("Claude returned a response that did not match the expected format.");
  }

  // Text fields come back as "" when unknown (see schemas.ts); normalize to null.
  return blanksToNull(response.parsed_output as z.infer<T>);
}

/** One prose (Markdown) call to Claude. Used for insights, where structure would flatten the analysis. */
export async function askForProse(opts: {
  system: string;
  content: Content;
  effort?: Effort;
  maxTokens?: number;
}): Promise<string> {
  const { client, model } = await getClaude();

  const reasoning = reasoningFor(model, opts.effort ?? "high");

  const response = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 16000,
    ...(reasoning.thinking ? { thinking: reasoning.thinking } : {}),
    ...(reasoning.effort ? { output_config: { effort: reasoning.effort } } : {}),
    system: opts.system,
    messages: [{ role: "user", content: opts.content }],
  });

  if (response.stop_reason === "refusal") {
    throw new RefusalError(refusalDetail(response));
  }

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/** Turns SDK/API errors into something a person can act on. */
export function explainAiError(error: unknown): string {
  if (error instanceof MissingKeyError || error instanceof RefusalError) return error.message;
  if (error instanceof Anthropic.AuthenticationError) {
    return "That Anthropic API key was rejected. Check it in Settings — it should start with 'sk-ant-'.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Anthropic rate-limited this request. Wait a minute and try again.";
  }
  if (error instanceof Anthropic.APIError) {
    return `Anthropic API error (${error.status}): ${error.message}`;
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong talking to Claude.";
}
