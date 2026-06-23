/**
 * compact — pure logic for exporting a conversation and seeding the next one.
 *
 * An LM Studio plugin cannot clear the host's chat history (the SDK's
 * `pullHistory()` hands back a *copy*; there is no truncate/reset API). What it
 * *can* do is read the conversation in a prompt preprocessor and write it to a
 * file. This module holds the dependency-free, host-agnostic half of that:
 * trigger detection, transcript rendering, the summary instruction, reasoning
 * stripping, and filename stamping. The plugin supplies the SDK glue (pull the
 * history, write the files, call the model).
 *
 * Everything here takes plain `{ role, text }` records and instants as inputs so
 * it can be unit-tested without the LM Studio SDK.
 */

/** A single conversation turn, reduced to the fields we serialize. */
export interface TranscriptMessage {
  role: "user" | "assistant" | "system" | "tool";
  text: string;
}

/** Result of matching a user message against the compact trigger. */
export interface TriggerMatch {
  /** True when the message is the trigger (alone, or trigger + trailing note). */
  matched: boolean;
  /** Any text the user typed after the trigger word (trimmed; "" when none). */
  note: string;
}

/**
 * Detect the compact trigger at the very start of a message.
 *
 * Matches when the trimmed text equals the trigger, or begins with the trigger
 * followed by whitespace — so `/compact` and `/compact ship notes` both fire,
 * but `please /compact` and `/compacting` do not. The remainder (a free-text
 * note) is returned trimmed.
 */
export function parseCompactTrigger(
  text: string,
  trigger: string,
): TriggerMatch {
  // Null-safe: the trigger may arrive undefined when LM Studio hasn't
  // materialized the global-config default. Never throw here — this runs
  // outside the plugin's try/catch, so a throw would fail the preprocessor open.
  const trig = (trigger ?? "").trim();
  const body = (text ?? "").trim();
  if (!trig || !body) return { matched: false, note: "" };

  // Scan the whole message AND each line. Earlier prompt-preprocessors in the
  // chain (time, memory, retrieval) prepend content, so the user's trigger line
  // is often no longer at the very start of the message — but it survives as its
  // own line. A line must START with the trigger (alone, or trigger + a note),
  // so a mid-sentence "please /compact" and "/compacting" still don't match.
  for (const candidate of [body, ...body.split(/\r?\n/)]) {
    const line = candidate.trim();
    if (line === trig) return { matched: true, note: "" };
    if (line.startsWith(trig) && /\s/.test(line.charAt(trig.length))) {
      return { matched: true, note: line.slice(trig.length).trim() };
    }
  }
  return { matched: false, note: "" };
}

const ROLE_LABEL: Record<TranscriptMessage["role"], string> = {
  user: "User",
  assistant: "Assistant",
  system: "System",
  tool: "Tool",
};

export interface SerializeOpts {
  /** The conversation's system prompt, rendered as its own section when set. */
  systemPrompt?: string;
  /** Human-readable stamp for the document header (e.g. "2026-06-21 14:32"). */
  generatedAt?: string;
  /** Optional note the user appended to the trigger. */
  note?: string;
}

/**
 * Render a transcript to Markdown: a header, an optional system-prompt section,
 * then one `### N. <Role>` block per turn with the message verbatim in a quote.
 * Blank messages (e.g. an assistant turn that was only tool calls) collapse to a
 * `_(no text)_` placeholder so turn numbering stays faithful to the original.
 */
export function serializeTranscript(
  messages: readonly TranscriptMessage[],
  opts: SerializeOpts = {},
): string {
  const lines: string[] = ["# Conversation export"];
  if (opts.generatedAt) lines.push("", `_Exported ${opts.generatedAt}._`);
  if (opts.note) lines.push("", `**Note:** ${opts.note.replace(/\s+/g, " ")}`);
  lines.push(
    "",
    `_${messages.length} message${messages.length === 1 ? "" : "s"}._`,
  );

  if (opts.systemPrompt && opts.systemPrompt.trim()) {
    lines.push("", "## System prompt", "", quote(opts.systemPrompt));
  }

  lines.push("", "## Transcript");
  messages.forEach((m, i) => {
    const body = m.text.trim() ? quote(m.text) : "_(no text)_";
    lines.push("", `### ${i + 1}. ${ROLE_LABEL[m.role] ?? m.role}`, "", body);
  });

  return lines.join("\n") + "\n";
}

/** Prefix every line with `> ` so multi-line content stays one Markdown quote. */
function quote(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n");
}

/**
 * Default seed directive: a hand-off briefing written FOR the agent that will
 * resume the work in a fresh chat. Prose, concrete, no reasoning. Override it
 * per-chat via the plugin's "Summary instructions" config field (e.g. a
 * creative-writing recap). Whatever the directive, the transcript is appended
 * fenced as data.
 */
export const DEFAULT_SUMMARY_DIRECTIVE = [
  "Write a hand-off briefing for the AI agent that will continue this work in a",
  "fresh chat with NONE of the prior context. Address it directly to that agent",
  "as clear, well-structured prose with short headed sections, so it can pick up",
  "seamlessly. Cover the who / what / why / how / when: a recap of the project and",
  "what has happened or been written so far; the key people or characters (names,",
  "roles, voices, relationships); the setting and timeline; the important decisions",
  "made and the reasoning behind them; any constraints or threads to honor; and",
  "exactly where things were left off with the immediate next step. Be concrete —",
  "real names, facts, and specifics, not generic platitudes. Write the briefing",
  "directly: no reasoning, no analysis, no <think> blocks, no preamble.",
].join("\n");

/**
 * Build the instruction sent to the local model to summarize the conversation
 * into a "seed" the user pastes into a fresh chat. `directive` is the style/scope
 * of the seed (defaults to {@link DEFAULT_SUMMARY_DIRECTIVE}); the transcript is
 * always fenced so the model treats it as data, not instructions to follow.
 */
export function buildSummaryInstruction(
  transcript: string,
  directive?: string,
): string {
  // Neutralize the fence markers inside the payload so conversation text can't
  // forge an end-of-transcript and smuggle in top-level instructions.
  const fenced = transcript
    .trim()
    .replace(/<<<TRANSCRIPT|TRANSCRIPT>>>/g, "[…]");
  return [
    (directive ?? "").trim() || DEFAULT_SUMMARY_DIRECTIVE,
    "",
    "Read the conversation between the markers and write the briefing from it.",
    "",
    "<<<TRANSCRIPT",
    fenced,
    "TRANSCRIPT>>>",
  ].join("\n");
}

/** The conversation as plain `role: text` blocks — the summary payload. */
export function plainTranscript(
  messages: readonly TranscriptMessage[],
): string {
  return messages.map((m) => `${m.role}: ${m.text}`).join("\n\n");
}

/**
 * Pack the conversation into transcript chunks, each at most `maxChars` long,
 * splitting on turn boundaries so a chunk never cuts mid-message — unless a
 * single turn is itself larger than `maxChars`, in which case that one turn is
 * hard-split. Used to keep each summary model-call within the context window.
 */
export function chunkTranscript(
  messages: readonly TranscriptMessage[],
  maxChars: number,
): string[] {
  const budget = Math.max(1, Math.floor(maxChars));
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current) chunks.push(current);
    current = "";
  };
  for (const m of messages) {
    const block = `${m.role}: ${m.text}`;
    if (block.length > budget) {
      // A single turn bigger than the budget: emit what we have, then slice it.
      flush();
      for (let i = 0; i < block.length; i += budget) {
        chunks.push(block.slice(i, i + budget));
      }
      continue;
    }
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length > budget) {
      flush();
      current = block;
    } else {
      current = candidate;
    }
  }
  flush();
  return chunks;
}

/** Instruction to summarize one part of a chunked conversation (the map step). */
export function buildChunkSummaryInstruction(
  chunk: string,
  index: number,
  total: number,
): string {
  const fenced = chunk.trim().replace(/<<<TRANSCRIPT|TRANSCRIPT>>>/g, "[…]");
  return [
    "You are compacting a long conversation in parts so it can continue in a",
    `fresh chat. This is part ${index} of ${total}. Summarize THIS part into`,
    "concise notes: the goal, key decisions and their reasons, the state, and any",
    "open threads. Keep names, numbers, and specifics. Write only the notes — no",
    "preamble, no markers.",
    "",
    "<<<TRANSCRIPT",
    fenced,
    "TRANSCRIPT>>>",
  ].join("\n");
}

/** Instruction to merge ordered part-notes into one seed (the reduce step). */
export function buildReduceInstruction(
  partialNotes: string,
  directive?: string,
): string {
  const fenced = partialNotes.trim().replace(/<<<NOTES|NOTES>>>/g, "[…]");
  return [
    (directive ?? "").trim() || DEFAULT_SUMMARY_DIRECTIVE,
    "",
    "Below are ordered notes from consecutive parts of the conversation. Merge",
    "them into the single briefing described above — remove redundancy, keep the",
    "chronological thread.",
    "",
    "<<<NOTES",
    fenced,
    "NOTES>>>",
  ].join("\n");
}

/** Dependencies for {@link summarizeTranscript} — the model calls it needs. */
export interface SummarizeDeps {
  /** Run one model call on an instruction; returns cleaned text (or ""). */
  summarize: (instruction: string) => Promise<string>;
  /** Count tokens in a string with the model's own tokenizer. */
  countTokens: (text: string) => Promise<number>;
  /**
   * Max input tokens for a single summary call. Must be derived from the
   * model's **loaded** context window (with output headroom already reserved),
   * NOT the model's maximum — otherwise a single call can overflow the loaded
   * window. See the plugin's budget helper.
   */
  budgetTokens: number;
  /** Seed style/scope directive; defaults to {@link DEFAULT_SUMMARY_DIRECTIVE}. */
  directive?: string;
}

/**
 * Summarize a conversation into one hand-off seed that fits the model's loaded
 * context. The fit check and chunk sizing are measured with the model's real
 * tokenizer (`countTokens`) against `budgetTokens`, so neither a context probe
 * that reports the model maximum nor token-dense text can make a single call
 * exceed the window. When the whole transcript fits it's one call; otherwise
 * it's map-reduce: summarize each chunk, then merge the part-notes — so a long
 * conversation (exactly when compaction matters) still summarizes instead of
 * overflowing. `summarize` returns the cleaned (reasoning-stripped) text, or "".
 */
export async function summarizeTranscript(
  messages: readonly TranscriptMessage[],
  deps: SummarizeDeps,
): Promise<string> {
  const { summarize, countTokens, budgetTokens, directive } = deps;
  const plain = plainTranscript(messages);

  if (
    (await countTokens(buildSummaryInstruction(plain, directive))) <=
    budgetTokens
  ) {
    return (await summarize(buildSummaryInstruction(plain, directive))).trim();
  }

  // Reserve the chunk instruction's fixed wrapper overhead, then size char-based
  // chunks to THIS content's real token ratio — so each chunk call (wrapper +
  // chunk) lands within budgetTokens however densely the text tokenizes.
  const charsPerToken = plain.length / Math.max(1, await countTokens(plain));
  const chunkWrapperTokens = await countTokens(
    buildChunkSummaryInstruction("", 1, 9),
  );
  const chunkBudget = Math.max(1, budgetTokens - chunkWrapperTokens);
  const maxChars = Math.max(1, Math.floor(chunkBudget * charsPerToken));
  const chunks = chunkTranscript(messages, maxChars);

  const partials: string[] = [];
  for (const [i, chunk] of chunks.entries()) {
    const note = (
      await summarize(buildChunkSummaryInstruction(chunk, i + 1, chunks.length))
    ).trim();
    if (note) partials.push(note);
  }
  if (partials.length <= 1) return partials[0] ?? "";

  // Part-notes are small; only if their merge would still overflow do we trim
  // (by the measured ratio, reserving the reduce wrapper) so the final call
  // stays within budget.
  let combined = partials.join("\n\n");
  const reduceWrapperTokens = await countTokens(
    buildReduceInstruction("", directive),
  );
  const reduceBudget = Math.max(1, budgetTokens - reduceWrapperTokens);
  const combinedTokens = await countTokens(combined);
  if (combinedTokens > reduceBudget) {
    const ratio = combined.length / Math.max(1, combinedTokens);
    combined = combined.slice(0, Math.max(1, Math.floor(reduceBudget * ratio)));
  }
  return (await summarize(buildReduceInstruction(combined, directive))).trim();
}

/**
 * Strip chain-of-thought a local model may emit: balanced `<think>…</think>`
 * blocks (including ones carrying attributes, e.g. `<think type="x">`), plus a
 * dangling open/close tag if the pair is unbalanced. Returns the remaining text
 * trimmed, so a reasoning-only response collapses to "". Not nesting-aware —
 * the SDK's `nonReasoningContent` is the primary separation; this is a backstop.
 */
export function stripReasoning(text: string): string {
  return text
    .replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, "")
    .replace(/<\/?think\b[^>]*>/gi, "")
    .trim();
}

/**
 * A filesystem-safe `YYYY-MM-DD-HHMM` stamp for the given instant in `tz`.
 * Uses Intl so the stamp reflects the configured wall-clock zone, not UTC.
 * Throws on an invalid timezone (the caller treats that as a config error).
 */
export function compactStamp(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  // Intl can emit "24" for midnight hour in some environments; normalize to 00.
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}-${hour}${get("minute")}`;
}

/** Dump + seed filenames for a stamp, e.g. `compact-2026-06-21-1432.md`. */
export function compactFilenames(stamp: string): {
  dump: string;
  seed: string;
} {
  return { dump: `compact-${stamp}.md`, seed: `compact-${stamp}.seed.md` };
}
