// src/modules/threeDView/hydrography/healthProbe.ts
import { HYDROGRAPHY_HEALTH_URL } from "./config";

export type HydrographyHealthResult = {
  ok: boolean;
  upstream?: {
    name: string;
    url: string;
    status?: number;
    layerExpected?: string;
    layerFound?: boolean;
  };
  hint?: string | null;
  error?: string;
};

export async function probeHydrographyUpstream(): Promise<HydrographyHealthResult> {
  const r = await fetch(HYDROGRAPHY_HEALTH_URL, { method: "GET" });
  const json = (await r.json()) as HydrographyHealthResult;
  // Normalize: treat non-2xx as not ok, but still return payload
  return { ...json, ok: !!json.ok && r.ok };
}
