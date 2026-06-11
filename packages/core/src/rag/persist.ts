/** Save/load a VectorStore to/from a JSON file. */
import { promises as fsp } from "node:fs";
import { VectorStore, type SerializedStore } from "./vector-store";

export async function saveStore(
  store: VectorStore,
  filePath: string,
): Promise<void> {
  await fsp.writeFile(filePath, JSON.stringify(store.toJSON()), "utf-8");
}

/** Load a store, or return null if the file is missing/unreadable/corrupt. */
export async function loadStore(filePath: string): Promise<VectorStore | null> {
  try {
    const raw = await fsp.readFile(filePath, "utf-8");
    return VectorStore.fromJSON(JSON.parse(raw) as SerializedStore);
  } catch {
    return null;
  }
}
