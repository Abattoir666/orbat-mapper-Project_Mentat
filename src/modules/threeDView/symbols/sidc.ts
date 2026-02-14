export function symbolSetFromSidc(sidc?: string): string | undefined {
  if (typeof sidc !== "string") return undefined;
  const normalized = sidc.trim();
  if (normalized.length < 6) return undefined;
  return normalized.slice(4, 6);
}
