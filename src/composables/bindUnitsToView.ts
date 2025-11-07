// src/composables/bindUnitsToView.ts
/* Clean binder: stable first paint, SIDC-aware icon updates, no per-tick re-render */
import { watchEffect } from "vue";
import type { Unit } from "@/types/scenarioModels";
import type { UnitRenderable, GlobePort } from "@/modules/threeDView/globeAdapter";
import { getUnitPositionAtTime } from "@/scenariostore/time";

/* Optional icon cache (robust to different signatures). */
let _iconCacheGet: any = undefined;
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _iconCacheGet = require("@/symbology/iconCache").getSidcIcon as any;
} catch { /* optional */ }

/* ───────────── helpers: times & events ───────────── */
function evtTime(e: any): number | undefined {
    const t = e?.t ?? e?.time ?? e?.at ?? e?.when;
    if (typeof t === "number" && Number.isFinite(t)) return t;
    if (typeof t === "string") {
        const n = Number(t); if (Number.isFinite(n)) return n;
        const d = Date.parse(t); if (Number.isFinite(d)) return d;
    }
    return undefined;
}

function lastLocEventAtOrBefore(src: any, tMs: number) {
    const evts: any[] = Array.isArray(src?.state) ? src.state : [];
    let best: any | undefined, bestT = -Infinity;
    for (const e of evts) {
        const te = evtTime(e); if (te == null) continue;
        if (!("location" in e)) continue;
        if (te <= tMs && te > bestT) { best = e; bestT = te; }
    }
    return best;
}
function firstFutureNonNullLocEvent(src: any, tMs: number) {
    const evts: any[] = Array.isArray(src?.state) ? src.state : [];
    let best: any | undefined, bestT = +Infinity;
    for (const e of evts) {
        const te = evtTime(e); if (te == null) continue;
        if (!("location" in e)) continue;
        if (te >= tMs && te < bestT) { best = e; bestT = te; }
    }
    return best;
}

/** ✅ FIX: read SIDC changes from src.state (not src.events). */
function lastSidcAtOrBefore(src: any, tMs: number): string | undefined {
    const evts: any[] = Array.isArray(src?.state) ? src.state : [];
    let best: string | undefined = (typeof src?.sidc === "string" ? src.sidc : undefined);
    let bestT = -Infinity;
    for (const e of evts) {
        const te = evtTime(e); if (te == null) continue;
        const s = typeof e?.sidc === "string" ? e.sidc : undefined;
        if (s && te <= tMs && te >= bestT) { best = s; bestT = te; }
    }
    return best;
}

function isOnMapNow(src: any, tMs: number): boolean {
    // Unit-level default
    if (src?.onMap === false) return false;
    if (src?._hidden || src?.isHidden) return false;

    // Event override (if state events have explicit onMap flags)
    const e = lastLocEventAtOrBefore(src, tMs);
    if (e && "onMap" in e) return !!e.onMap;
    return true;
}

/* ───────────── icon URL/dataURL builders (robust fallbacks) ───────────── */
function looksLikeUrl(s?: string): boolean {
    if (typeof s !== "string") return false;
    const t = s.trim();
    return !!t && (/^https?:\/\//i.test(t) || /^\/\//.test(t) || /^\//.test(t) || /^data:image\//i.test(t));
}
function tryCallBuilder(fn: any, src: any, sidc?: string): string | undefined {
    if (typeof fn !== "function") return;
    try { const a = fn(src, sidc); if (looksLikeUrl(a)) return a; } catch { }
    try { const b = fn(sidc, src); if (looksLikeUrl(b)) return b; } catch { }
    try { const c = fn({ src, sidc }); if (looksLikeUrl(c)) return c; } catch { }
}

function bestIconUrlFor(src: any, sidc?: string): string | undefined {
    if (!sidc) return undefined; // don’t attempt without SIDC

    // user hooks
    const h1 = (window as any).__buildIconUrlForUnit;
    const h2 = (window as any).__symbolUrlFromSidc;
    const h3 = (window as any).symbolUrlFromSidc;
    let url =
        tryCallBuilder(h1, src, sidc) ??
        tryCallBuilder(h2, src, sidc) ??
        tryCallBuilder(h3, src, sidc);
    if (looksLikeUrl(url)) return url;

    // static endpoint fallback
    const base = (window as any).__symbolBase ?? (window as any).__symbolEndpoint;
    if (base && typeof base === "string") {
        const sep = base.includes("?") ? "&" : "?";
        url = `${base}${sep}sidc=${encodeURIComponent(sidc)}`;
        if (looksLikeUrl(url)) return url;
    }
    return undefined;
}

async function bestIconDataUrlFor(src: any, sidc?: string, size = 40): Promise<string | undefined> {
    if (!sidc) return undefined; // don’t attempt without SIDC

    // Try icon cache – support both common signatures.
    if (_iconCacheGet) {
        try {
            let out: any;
            // signature A: getSidcIcon(sidc, opts)
            try { out = _iconCacheGet(sidc, { size, border: true, uniqueDesignation: src?.name ?? "" }); } catch { out = undefined; }
            // signature B: getSidcIcon(unitLike, size)
            if (!out) try { out = _iconCacheGet({ ...src, sidc }, size); } catch { out = undefined; }

            // normalize possible return variants
            if (typeof out === "string") {
                if (out.startsWith("data:image/") || /^https?:\/\//i.test(out)) return out;
            } else if (out && typeof out === "object") {
                if ("toDataURL" in out && typeof out.toDataURL === "function") {
                    const url = out.toDataURL("image/png");
                    if (typeof url === "string" && url.startsWith("data:image/")) return url;
                }
                if ("image" in out) {
                    const img: any = (out as any).image;
                    if (typeof img === "string") return img;
                    if (img && typeof img.toDataURL === "function") {
                        const url = img.toDataURL("image/png");
                        if (typeof url === "string" && url.startsWith("data:image/")) return url;
                    }
                }
            }
        } catch { /* ignore; fall through */ }
    }

    // last-resort: milsymbol (optional dev dep)
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const MS = require("milsymbol");
        const opts: any = { size, uniqueDesignation: src?.name ?? "" };
        const fill = src?.symbolOptions?.iconFillColor || src?.symbolOptions?.fillColor;
        if (fill) opts.fillColor = fill;
        const sym = new MS.Symbol(sidc, opts);
        const canvas = (sym as any).asCanvas?.();
        const url = canvas?.toDataURL?.("image/png");
        if (typeof url === "string" && url.startsWith("data:image/")) return url;
    } catch { /* optional */ }

    return undefined;
}

/* ───────────── store helpers ───────────── */
function getScenarioStoreLike(explicit?: any) {
    if (explicit) return explicit?.store ?? explicit;
    const sc = (window as any).__scenario;
    return sc?.store ?? sc ?? null;
}

function pluckUnitsFromAnyStore(src: any): Unit[] {
    if (!src) return [];
    const state = src.$state ?? src.state ?? src;

    let um: any =
        src.unitMap ??
        state?.unitMap ??
        src.units ??
        state?.units ??
        src.unitList ??
        state?.unitList;

    if (!um) return [];
    if (Array.isArray(um)) return um as Unit[];

    // Map → array
    try { return Array.from(Object.values(um)) as Unit[]; } catch { return []; }
}

/* ───────────── project the store unit → UnitRenderable ───────────── */
type AnyViewAdapter = {
    setUnits: (units: UnitRenderable[]) => void;
    upsertUnit: (u: UnitRenderable) => void;
    removeUnit: (id: string) => void;
};

export type BindUnitsOptions = {
    scenarioStore?: any;
    getNowMs?: () => number;
    unitFilter?: (u: Unit) => boolean;
    /** If true, skip units that lack a known lon/lat at the first paint. Default false (permissive). */
    useStrictLonLat?: boolean;
    /** Icon size hint if using icon cache. */
    sidcIconSize?: number;
};

function resolveLonLatForFirstPaint(src: any, nowMs: number): { lon: number; lat: number } | undefined {
    // 1) explicit unit-level fields
    if (Number.isFinite(src?.lon) && Number.isFinite(src?.lat)) return { lon: src.lon, lat: src.lat };
    if (Array.isArray(src?.location) && src.location.length >= 2) {
        const [lon, lat] = src.location; if (Number.isFinite(lon) && Number.isFinite(lat)) return { lon, lat };
    }
    // 2) most recent state <= now
    const last = lastLocEventAtOrBefore(src, nowMs);
    if (last?.location && Array.isArray(last.location) && last.location.length >= 2) {
        const [lon, lat] = last.location; if (Number.isFinite(lon) && Number.isFinite(lat)) return { lon, lat };
    }
    // 3) initial state
    const base = src?._state?.location ?? src?.location;
    if (Array.isArray(base) && base.length >= 2 && base.every(Number.isFinite)) {
        return { lon: base[0], lat: base[1] };
    }
    // 4) first future non-null (lets you at least see it before it “arrives”)
    const fut = firstFutureNonNullLocEvent(src, nowMs);
    if (fut?.location && Array.isArray(fut.location) && fut.location.length >= 2) {
        const [lon, lat] = fut.location; if (Number.isFinite(lon) && Number.isFinite(lat)) return { lon, lat };
    }
    return undefined;
}

/* ───────────── main binder ───────────── */
export function bindUnitsToView(adapter: AnyViewAdapter | GlobePort, opts: BindUnitsOptions = {}) {
    const getNowMs = typeof opts.getNowMs === "function" ? opts.getNowMs : () => Date.now();
    const useStrict = !!opts.useStrictLonLat;
    const iconSize = Number.isFinite(opts.sidcIconSize as any) ? (opts.sidcIconSize as number) : 40;
    const store = getScenarioStoreLike(opts.scenarioStore);

    // Last-known SIDC and icon per id (prevents per-tick churn)
    const lastSidc = new Map<string, string | undefined>();
    const lastIcon = new Map<string, string | undefined>();

    // Backoff so we don’t spam the globe before unitMap exists
    let retryTimer: number | null = null;
    let retryAttempt = 0;
    const maxDelay = 2000;

    function unitPassesFilter(u: any): boolean {
        return typeof opts.unitFilter === "function" ? !!opts.unitFilter(u) : true;
    }

    async function projectUnit(u: any, nowMs: number): Promise<UnitRenderable | undefined> {
        if (!u?.id) return;

        // Decide visibility now; the globe will toggle show/hide as time moves.
        const onMapNow = isOnMapNow(u, nowMs);

        // First-paint position
        const p = resolveLonLatForFirstPaint(u, nowMs);
        if (!p && useStrict) return; // strict mode: skip units w/out coords

        // ✅ SIDC now (events-first)
        const sidc = lastSidcAtOrBefore(u, nowMs) ?? u?.sidc;

        // Build icon URL/data-URL only when we actually have a SIDC
        let iconUrl = lastIcon.get(u.id);
        if (!iconUrl && sidc) {
            const url = bestIconUrlFor(u, sidc);
            iconUrl = url ?? await bestIconDataUrlFor(u, sidc, iconSize);
            if (iconUrl) lastIcon.set(u.id, iconUrl);
        }

        const r: UnitRenderable = {
            id: u.id,
            name: u.name ?? u.designation ?? "",
            lon: p?.lon ?? 0, lat: p?.lat ?? 0,
            clampToGround: true,
            altIsAgl: true,

            // May be undefined; globeAdapter will create a dot if no resolved image
            iconUrl: iconUrl,

            // Pass the baseline SIDC so globeAdapter can compare/patch if needed
            sidc,

            symbolOptions: {
                fillColor: u?.symbolOptions?.fillColor ?? u?.symbolOptions?.iconFillColor,
                iconFillColor: u?.symbolOptions?.iconFillColor ?? u?.symbolOptions?.fillColor,
                outlineColor: u?.symbolOptions?.outlineColor,
                outlineWidth: u?.symbolOptions?.outlineWidth,
            },

            getPositionAtTime: (tMs: number) => {
                const pos = getUnitPositionAtTime?.(u, tMs);
                if (pos && Number.isFinite(pos.lon) && Number.isFinite(pos.lat)) return pos as any;
                return undefined;
            },

            __sourceUnit: u,
            __lastSidc: sidc,
        } as any;

        // If currently not on-map, let globe show/hide via time ticks
        (r as any).__onMapNow = onMapNow;
        return r;
    }

    async function rebuild() {
        const raw = pluckUnitsFromAnyStore(store);
        const now = getNowMs();
        const filtered = raw.filter(u => unitPassesFilter(u));
        const mapped: UnitRenderable[] = [];

        // Map sequentially so we can await icon generation without stampeding
        for (const u of filtered) {
            const m = await projectUnit(u, now);
            if (m) mapped.push(m);
        }

        // Feed the adapter
        (adapter as GlobePort).setUnits?.(mapped);

        // Debug stash
        try {
            (window as any).__mentatLastSetUnitsPayload = { raw: raw.length, kept: mapped.length, coerced: mapped.slice(0, 20) };
        } catch { }

        console.info(`[bindUnitsToView] bulk set → ${mapped.length} units (raw: ${raw.length}, attempt: ${retryAttempt})`);
        return { raw: raw.length, kept: mapped.length };
    }

    function scheduleRetryIfEmpty(last?: { raw: number; kept: number }) {
        const raw = last?.raw ?? 0;
        if (raw > 0) return;
        const delay = Math.min(maxDelay, 100 * Math.pow(1.7, retryAttempt));
        retryAttempt++;
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
        retryTimer = window.setTimeout(async () => {
            const counts = await rebuild();
            if (counts.raw === 0 && retryAttempt < 20) scheduleRetryIfEmpty(counts);
            else if (counts.raw === 0) console.warn("[bindUnitsToView] Gave up waiting for unitMap after retries.");
        }, delay) as unknown as number;
    }

    // Drive SIDC/icon updates only when SIDC changes at the current time
    function tickForSidc(nowMs: number) {
        const srcUnits = pluckUnitsFromAnyStore(store);
        const v = (adapter as GlobePort).viewer;
        if (!v) return;

        for (const u of srcUnits) {
            const id = (u as any)?.id;
            if (!id) continue;

            const snapSidc = lastSidcAtOrBefore(u, nowMs) ?? (u as any)?.sidc;
            if (lastSidc.get(id) === snapSidc) continue; // unchanged

            lastSidc.set(id, snapSidc);
            const ent = v.entities.getById(id);
            if (!ent) continue;

            // Ask the globe to apply the change (it already has robust SIDC->icon logic)
            try { (adapter as GlobePort).setTime?.(nowMs); } catch { }
        }
    }

    // Bulk first paint
    let stopBulk: undefined | (() => void);
    stopBulk = watchEffect(async (onCleanup) => {
        if (!store) return;
        retryAttempt = 0;
        const res = await rebuild();
        scheduleRetryIfEmpty(res);
        onCleanup(() => { /* nothing */ });
    });

    // Debug hooks
    const w = window as any;
    w.MentatBinderRefresh = () => rebuild();
    w.MentatBinderStatus = () => {
        const v = (adapter as GlobePort).viewer;
        const m = (window as any).__mentatLastSetUnitsPayload || {};
        return {
            attempts: retryAttempt,
            raw: m.raw ?? null,
            kept: m.kept ?? null,
            haveViewer: !!v,
            entityCount: v ? v.entities.values.length : 0,
        };
    };
    w.MentatList3D = (limit = 50) => {
        const v = (adapter as GlobePort).viewer;
        const ids = v ? v.entities.values.map((e: any) => e.id) : [];
        return ids.slice(0, limit);
    };
    w.MentatWhyNo3D = (id: string) => {
        const v = (adapter as GlobePort).viewer;
        const ent = v?.entities?.getById?.(id);
        const srcUnits = pluckUnitsFromAnyStore(store);
        const src = srcUnits.find(u => (u as any)?.id === id);
        const m = w.__mentatLastSetUnitsPayload || {};
        const res = {
            id,
            hasEntity: !!ent,
            entShow: ent?.show ?? null,
            inRaw: Array.isArray(m.coerced) && m.coerced.some((x: any) => x?.id === id),
            hasSrcUnit: !!src,
            srcEvents: Array.isArray((src as any)?.state) ? (src as any).state.length : 0,
            lastSidc: lastSidc.get(id) ?? null,
            lastIcon: lastIcon.get(id) ?? null,
        };
        return res;
    };

    /* Public API for caller */
    return {
        refresh: () => { retryAttempt = 0; return rebuild(); },
        tick: (tMs: number) => {
            tickForSidc(tMs);
            try { (adapter as GlobePort).setTime?.(tMs); } catch { }
        },
        dispose: () => {
            if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
            try { stopBulk?.(); } catch { }
        },
    };
}

export default bindUnitsToView;
