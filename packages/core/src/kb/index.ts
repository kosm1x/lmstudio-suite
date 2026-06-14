/**
 * @lmstudio-suite/core/kb — structural "map memory" over a directory of notes.
 *
 * Parses frontmatter + `[[wikilinks]]` into a navigable KbGraph, renders a
 * budgeted map digest, and offers deterministic keyword search. No embeddings:
 * the map is cheap, deterministic, and structure-aware — the complement to the
 * semantic `rag` module.
 */
export * from "./frontmatter";
export * from "./links";
export * from "./node";
export * from "./graph";
export * from "./scan";
export * from "./digest";
export * from "./search";
export * from "./organize";
