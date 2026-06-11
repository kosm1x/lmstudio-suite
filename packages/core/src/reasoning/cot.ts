/** Chain-of-thought scaffolding + self-consistency helpers. */

export type CotMode = "off" | "concise" | "full";

/** Append step-by-step reasoning instructions to a question. */
export function cotScaffold(
  question: string,
  mode: CotMode = "concise",
): string {
  if (mode === "off") return question;
  const instruction =
    mode === "full"
      ? "Think step by step. Show your reasoning explicitly, then end with a line starting with 'Final answer:'."
      : "Think step by step before answering, then give a concise final answer.";
  return `${question}\n\n${instruction}`;
}

export interface VoteResult<T> {
  answer: T;
  count: number;
  total: number;
}

/**
 * Self-consistency: pick the most common answer among samples. `key` maps an
 * answer to a comparison string (default: JSON). Returns null for no samples.
 */
export function majorityVote<T>(
  answers: T[],
  key: (answer: T) => string = (a) => JSON.stringify(a),
): VoteResult<T> | null {
  if (answers.length === 0) return null;
  const buckets = new Map<string, { answer: T; count: number }>();
  for (const answer of answers) {
    const k = key(answer);
    const existing = buckets.get(k);
    if (existing) existing.count += 1;
    else buckets.set(k, { answer, count: 1 });
  }
  let best: { answer: T; count: number } | null = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) best = bucket;
  }
  return best
    ? { answer: best.answer, count: best.count, total: answers.length }
    : null;
}
