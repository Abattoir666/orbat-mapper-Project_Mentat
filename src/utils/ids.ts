// src/utils/ids.ts

import { customAlphabet } from "nanoid";

// Short random ID generator (existing pattern in repo)
const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const nano10 = customAlphabet(alphabet, 10);
export function nanoid(len = 10): string {
  return len === 10 ? nano10() : customAlphabet(alphabet, len)();
}

/**
 * Default random ID (used everywhere else in Orbat Mapper)
 */
export function newId() {
  return nano10();
}

/**
 * Deterministic short ID generator (same input → same output)
 * Pass a "rich" seed object to avoid collisions.
 */
export function stableId(seed: Record<string, unknown>): string {
  const src = JSON.stringify(seed);

  // DJB2 XOR hash (fast + decent spread)
  let h = 5381;
  for (let i = 0; i < src.length; i++) {
    h = ((h << 5) + h) ^ src.charCodeAt(i);
  }

  // Fold to base62-ish alphabet
  let x = h >>> 0; // convert to unsigned
  let out = "";
  for (let i = 0; i < 10; i++) {
    out += alphabet[x % alphabet.length];
    x = (x * 1315423911) >>> 0;
  }
  return out;
}

/**
 * Prevent accidental ID collision:
 * - If an ID already exists, add a tiny suffix (_1, _2, …)
 */
export function ensureUniqueId(id: string, exists: (id: string) => boolean): string {
  if (!exists(id)) return id;

  let i = 1;
  while (exists(`${id}_${i}`)) i++;
  return `${id}_${i}`.slice(0, 12);
}

/**
 * Build a "rich seed" for stable IDs.
 * This combines side/group/name/SIDC/parent path — not just name alone.
 */
export function makeUnitSeed(row: {
  source: string;  // e.g. "csv", "xml", "manual"
  sideKey: string; // side or faction name/ID
  groupKey: string; // group name or parent key
  parentChain?: Array<{ extId?: string; name?: string }>;
  sidc?: string;
  name?: string;
  ordinal?: number;
  extId?: string;
}) {
  const parentPath = (row.parentChain || [])
    .map((p) => (p.extId?.trim() || p.name?.trim() || ""))
    .filter(Boolean)
    .join("/");

  return {
    src: row.source,
    side: row.sideKey,
    group: row.groupKey,
    parent: parentPath,
    sidc: row.sidc || "",
    name: (row.name || "").trim(),
    ord: row.ordinal ?? 0,
    ext: (row.extId || "").trim(),
  };
}