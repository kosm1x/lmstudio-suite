/**
 * @lmstudio-suite/core — shared capability library.
 *
 * Capabilities are grouped by domain and re-exported here for convenience.
 * Subpath imports (`@lmstudio-suite/core/web`, `/fs`, `/exec`, `/rag`,
 * `/reasoning`) are also available for narrower dependency graphs.
 */
export * from "./client";
export * from "./web/index";
export * from "./fs/index";
export * from "./exec/index";
export * from "./rag/index";
export * from "./reasoning/index";
export * from "./kb/index";
export * from "./data/index";
export * from "./tools/index";
