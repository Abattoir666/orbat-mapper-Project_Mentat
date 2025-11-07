// Caches SIDC icons as data URLs (PNG) so Cesium billboards can use them.
// Uses milsymbol to generate on demand.

import type { Unit } from "@/types/scenarioModels";
import ms from "milsymbol";

type SymOptions = Record<string, any>;

function stableKey(sidc: string, opts?: SymOptions, size = 40) {
    const pick: SymOptions = {};
    if (opts) {
        const keys = Object.keys(opts).sort();
        for (const k of keys) {
            const v = (opts as any)[k];
            if (v == null) continue;
            if (typeof v === "object") continue;
            pick[k] = v;
        }
    }
    return JSON.stringify({ sidc, size, opts: pick });
}

// ─── Async cache (unchanged behavior) ─────────────────────────────────────────
const cache = new Map<string, Promise<string>>();
const resolved = new Map<string, string>();

/** Existing async API (kept for 2-D & callers that await). */
export function getSidcIcon(unit: Unit, size = 40): Promise<string> {
    const sidc: string | undefined =
        (unit as any).sidc || (unit as any).symbol || (unit as any).symbolCode;
    if (!sidc) return Promise.reject(new Error("Unit missing SIDC"));

    const opts: SymOptions | undefined =
        (unit as any).symbolOptions || (unit as any).symbolOpts;
    const key = stableKey(sidc, opts, size);

    const hit = cache.get(key);
    if (hit) return hit;

    const p = new Promise<string>((resolve, reject) => {
        try {
            const symbol = new ms.Symbol(sidc, { size, ...opts });
            const canvas = symbol.asCanvas();
            const url = canvas.toDataURL("image/png");
            resolved.set(key, url);
            resolve(url);
        } catch (e) {
            reject(e as Error);
        }
    });

    cache.set(key, p);
    return p;
}

// ─── NEW: synchronous icon renderer for 3-D (param order matches globe) ──────
/**
 * getSidcIconSync(sidc, opts?, size=48)
 * - Returns a data URL (PNG) synchronously if renderable; else undefined.
 * - `opts` must be milsymbol options; we honor `fillColor` if present.
 */
export function getSidcIconSync(
    sidc: string,
    opts?: SymOptions,
    size = 48
): string | undefined {
    if (!sidc || typeof sidc !== "string") return undefined;

    // Ensure ms receives fillColor (if caller provided a different alias upstream)
    const mergedOpts: SymOptions = { ...(opts || {}) };
    const fillAlias =
        (opts as any)?.fillColor ||
        (opts as any)?.fill ||
        (opts as any)?.fc;
    if (fillAlias && !mergedOpts.fillColor) mergedOpts.fillColor = fillAlias;

    const key = stableKey(sidc, mergedOpts, size);

    // Already rendered? Return immediately.
    const hit = resolved.get(key);
    if (hit) return hit;

    try {
        const symbol = new ms.Symbol(sidc, { size, ...mergedOpts });
        const canvas = symbol.asCanvas();
        const url = canvas?.toDataURL?.("image/png");
        if (typeof url === "string" && url.startsWith("data:image/")) {
            resolved.set(key, url);
            return url;
        }
    } catch {
        // ignore → undefined
    }
    return undefined;
}

// ─── OPTIONAL: tiny global hook for ad-hoc console tests and other layers ────
try {
    (window as any).__get2DIconForSidcSync = (
        sidc: string,
        params?: { size?: number; fill?: string; fc?: string; fillColor?: string }
    ) => {
        const sz = params?.size ?? 48;
        const fillColor = params?.fillColor || params?.fill || params?.fc;
        const opts: SymOptions = fillColor ? { fillColor } : {};
        return getSidcIconSync(sidc, opts, sz);
    };
} catch {
    /* no-op */
}
