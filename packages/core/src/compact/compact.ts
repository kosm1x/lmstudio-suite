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
  const body = text.trim();
  const trig = trigger.trim();
  if (!trig || !body) return { matched: false, note: "" };
  if (body === trig) return { matched: true, note: "" };
  // trigger must be followed by whitespace to count (avoids "/compacting").
  if (body.startsWith(trig) && /\s/.test(body.charAt(trig.length))) {
    return { matched: true, note: body.slice(trig.length).trim() };
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
 * Build the instruction sent to the local model to summarize the conversation
 * into a "seed" the user pastes into a fresh chat. Kept terse and directive
 * because small local models drift on long meta-prompts. The transcript is
 * fenced so the model treats it as data, not instructions to follow.
 */
export function buildSummaryInstruction(transcript: string): string {
  // Neutralize the fence markers inside the payload so conversation text can't
  // forge an end-of-transcript and smuggle in top-level instructions.
  const fenced = transcript
    .trim()
    .replace(/<<<TRANSCRIPT|TRANSCRIPT>>>/g, "[…]");
  return [
    "You are compacting a conversation so it can continue in a fresh chat with",
    "less context. Read the transcript between the markers and write a concise",
    "hand-off summary (a few short paragraphs or bullet points) capturing:",
    "the goal, key decisions and their reasons, the current state, and the",
    "immediate next step. Write only the summary — no preamble, no markers.",
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
export function buildReduceInstruction(partialNotes: string): string {
  const fenced = partialNotes.trim().replace(/<<<NOTES|NOTES>>>/g, "[…]");
  return [
    "Below are ordered notes summarizing consecutive parts of one conversation.",
    "Merge them into a single concise hand-off summary (a few short paragraphs or",
    "bullet points) capturing: the goal, key decisions and their reasons, the",
    "current state, and the immediate next step. Remove redundancy; keep the",
    "chronological thread. Write only the summary — no preamble, no markers.",
    "",
    "<<<NOTES",
    fenced,
    "NOTES>>>",
  ].join("\n");
}

/**
 * Summarize a conversation into one hand-off seed that fits a small model's
 * context. When the whole transcript fits within `maxChars` it's a single call.
 * Otherwise it's map-reduce: summarize each chunk, then merge the part-notes —
 * so a long conversation (exactly when compaction matters) still summarizes
 * instead of overflowing the context. `summarize` runs one model call on an
 * instruction and returns the cleaned (reasoning-stripped) text, or "".
 */
export async function summarizeTranscript(
  messages: readonly TranscriptMessage[],
  summarize: (instruction: string) => Promise<string>,
  maxChars: number,
): Promise<string> {
  const plain = plainTranscript(messages);
  if (buildSummaryInstruction(plain).length <= maxChars) {
    return (await summarize(buildSummaryInstruction(plain))).trim();
  }

  const chunks = chunkTranscript(messages, maxChars);
  const partials: string[] = [];
  for (const [i, chunk] of chunks.entries()) {
    const note = (
      await summarize(buildChunkSummaryInstruction(chunk, i + 1, chunks.length))
    ).trim();
    if (note) partials.push(note);
  }
  if (partials.length <= 1) return partials[0] ?? "";

  // Part-notes are small, but guard the pathological case where even their
  // concatenation overflows the budget before the merge call.
  let combined = partials.join("\n\n");
  if (combined.length > maxChars) combined = combined.slice(0, maxChars);
  return (await summarize(buildReduceInstruction(combined))).trim();
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
