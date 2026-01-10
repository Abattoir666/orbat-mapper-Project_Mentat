import type { SurfaceHeightSampler } from "@/geo/altitude";
import { sampleSurfaceHeightMetersCesium } from "@/geo/surfaceHeightCesium";

let sampler: SurfaceHeightSampler | undefined;

export function setSurfaceHeightSampler(fn: SurfaceHeightSampler | undefined) {
    sampler = fn;
}

export function getSurfaceHeightSampler(): SurfaceHeightSampler | undefined {
    return sampler;
}

export async function trySampleSurfaceHeightMeters(lon: number, lat: number): Promise<number | undefined> {
    // 1) Prefer a registered sampler (e.g., if you ever change UI to allow simultaneous 2D/3D)
    if (sampler) {
        try {
            const h = await sampler(lon, lat);
            return typeof h === "number" && Number.isFinite(h) ? h : undefined;
        } catch {
            // fall through
        }
    }

    // 2) Always-available fallback (no viewer required)
    return await sampleSurfaceHeightMetersCesium(lon, lat);
}
