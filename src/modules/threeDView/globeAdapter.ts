// src/modules/threeDView/globeAdapter.ts
import proj4 from "proj4";
import {
    Cartesian3,
    Cartesian2,
    Cartographic,
    Color,
    HeightReference,
    VerticalOrigin,
    HorizontalOrigin,
    sampleTerrainMostDetailed,
    UrlTemplateImageryProvider,
    JulianDate,
    TimeInterval,
    TimeIntervalCollection,
    ClockRange,
    type Viewer,
    SunLight,
    SkyAtmosphere,
    SkyBox,
    Moon,
    Sun,
    CallbackProperty,
    SampledPositionProperty,
    VelocityOrientationProperty,
} from "cesium";

import * as Cesium from "cesium";
import { useGlobe, type GlobeApi } from "./useGlobe";
import { makeImageryProviders } from "./makeImageryProviders";
import { getUnitPositionAtTime } from "@/scenariostore/time";
import { getSidcIconSync } from "@/symbology/iconCache";
import { WeatherSkyController, type GibsCloudOptions } from "./weatherSkyController";
import {
    isInstallationBySidc,
    applyInstallationGraphics,
} from "@/modules/threeDView/graphics/installations";
import {
    buildIndexFromScenarioStore,
    applyGroupFillColors,
    applyGroupFillColorToUnit,
} from "@/modules/threeDView/graphics/unitparser";

/* ─────────────────────────────── Utils ─────────────────────────────── */
/** True if the unit should be hidden based on 2D store (side/group/unit flags). */
function isHidden2D(u: any): boolean {
    try {
        const sc = (window as any).__scenario;
        const store = sc?.store ?? sc;
        if (!store || !u) return false;

        const unitMap = store.unitMap ?? store.state?.unitMap ?? {};
        const unitById = (id: any) =>
            unitMap?.[id] ?? (Object.values(unitMap).find((x: any) => x?.id === id) || null);

        const base = (u as any).__sourceUnit ?? unitById(u.id) ?? u;

        const sideMap = store.sideMap ?? store.state?.sideMap ?? {};
        const groupMap = store.groupMap ?? store.state?.groupMap ?? {};
        const byId = (map: any, id: any) =>
            (map && (map[id] || Object.values(map).find((x: any) => x?.id === id))) || null;

        const sid =
            base._sid ?? base.sideId ?? base?.side?.id ?? base.side ??
            u._sid ?? u.sideId ?? u?.side?.id ?? u.side;
        const side = sid ? byId(sideMap, sid) : null;
        if (side?.isHidden === true) return true;

        let gid =
            base._gid ?? base.groupId ?? base?.group?.id ?? base.group ??
            u._gid ?? u.groupId ?? u?.group?.id ?? u.group;
        while (gid) {
            const g = byId(groupMap, gid);
            if (!g) break;
            if (g.isHidden === true) return true;
            gid = g.parentId ?? g._pid ?? g.parentGroupId ?? null;
        }

        return !!(
            base._hidden || base.hidden || base?._state?.isHidden || base?.state?.isHidden ||
            u._hidden || u.hidden || u?._state?.isHidden || u?.state?.isHidden
        );
    } catch {
        return false;
    }
}
try { (window as any).isHidden2D = isHidden2D; } catch { }

try {
    (window as any).lastSidcAtOrBefore = lastSidcAtOrBefore;
    (window as any).lastLocEventAtOrBefore = lastLocEventAtOrBefore;
    (window as any).computeSnapshot3D = computeSnapshot;
} catch { }

function safeCssColor(css?: string, fallback: Color = Color.WHITE): Color {
    try {
        if (!css || !css.trim()) return fallback;
        return Color.fromCssColorString(css.trim());
    } catch {
        return fallback;
    }
}

const posEquals = (a?: Cesium.Cartesian3, b?: Cesium.Cartesian3) =>
    !!a && !!b && Cesium.Cartesian3.equalsEpsilon(a, b, Cesium.Math.EPSILON7);

function setEntityPosition(ent: Cesium.Entity, lon: number, lat: number, alt = 0) {
    const next = Cesium.Cartesian3.fromDegrees(lon, lat, alt);
    const now = ent.position?.getValue?.(new Cesium.JulianDate());
    if (!posEquals(now, next)) ent.position = next;
}

/** Group-color helpers (icons carry their own color via URL params) */
function extractGroupFill(u: UnitRenderable): string | undefined {
    return u.symbolOptions?.iconFillColor || u.symbolOptions?.fillColor;
}
function normalizeHex(c?: string): string | undefined {
    if (!c) return;
    try {
        const col = Color.fromCssColorString(c);
        const r = Math.round(col.red * 255).toString(16).padStart(2, "0");
        const g = Math.round(col.green * 255).toString(16).padStart(2, "0");
        const b = Math.round(col.blue * 255).toString(16).padStart(2, "0");
        return `#${r}${g}${b}`;
    } catch {
        return;
    }
}

/** Remove any existing fill/fc params. */
function stripFillParams(url: string): string {
    return url
        .replace(/([?&])(fill|fc)=[^&]*/gi, "$1")
        .replace(/[?&](&|$)/, "$1");
}

/**
 * Ensure URL has our color:
 *  - For http(s): strip prior fill/fc and append new ?fill=&fc= if hex provided.
 *  - For data: URLs, return unchanged (color is baked into pixels).
 *  - If hex is falsy: just strip prior params.
 */
function withSymbolColor(url?: string, hex?: string): string | undefined {
    if (!url || !hex) return url;
    if (url.startsWith("data:")) return url; // can't recolor embedded bitmaps

    // Strip any existing fill/fc params, then append ours
    const cleaned = url
        .replace(/([?&])(fill|fc)=[^&]*/gi, "$1")
        .replace(/[?&](&|$)/, "$1");

    const enc = encodeURIComponent(hex);
    const hasQ = cleaned.includes("?");
    return `${cleaned}${hasQ ? "&" : "?"}fill=${enc}&fc=${enc}`;
}

/** Extract the SIDC currently encoded in an entity's billboard image URL. */
function sidcFromBillboard(ent?: Cesium.Entity, now?: Cesium.JulianDate): string | undefined {
    try {
        const bb: any = ent?.billboard;
        if (!bb) return;

        // Resolve the image value at 'now' if provided, else at "current" time.
        const val = (bb.image && typeof bb.image.getValue === "function")
            ? bb.image.getValue(now ?? new Cesium.JulianDate())
            : bb.image;

        if (typeof val !== "string") return;

        // Works for both http(s) and data: URLs if you append ?sidc=... to data URLs.
        const m = /(?:[?&])sidc=([^&]+)/i.exec(val);
        return m ? decodeURIComponent(m[1]) : undefined;
    } catch {
        return undefined;
    }
}

/** Try to get a synchronous 2D snapshot of a SIDC icon from app globals. */
function tryGet2DIconSnapshotSync(sidc: string, size = 48, hex?: string): string | undefined {
    try {
        const w: any = window;

        // Preferred sync hook if your 2D cache exposes one
        if (typeof w.__get2DIconForSidcSync === "function") {
            const out = w.__get2DIconForSidcSync(sidc, { size, fill: hex, fc: hex });
            if (typeof out === "string" && out.startsWith("data:image/")) return out;
            if (typeof out === "string" && /^https?:\/\//i.test(out)) return out;
        }

        // Alternate name often used
        if (typeof w.__get2DIconDataUrl === "function") {
            const out = w.__get2DIconDataUrl(sidc, size, hex);
            if (typeof out === "string" && out.startsWith("data:image/")) return out;
        }

        // Example: a Map cache you might have on window
        if (w.__symbolCache && typeof w.__symbolCache.get === "function") {
            const out = w.__symbolCache.get({ sidc, size, fill: hex, fc: hex });
            if (typeof out === "string" && out.startsWith("data:image/")) return out;
        }
    } catch { /* ignore */ }
    return undefined;
}

/** Coerce event time to epoch ms; returns undefined if not parseable */
function evtTime(e: any): number | undefined {
    const t = e?.t;
    if (typeof t === "number" && Number.isFinite(t)) return t;
    if (typeof t === "string") {
        // try fast number path first
        const n = Number(t);
        if (Number.isFinite(n)) return n;
        const d = Date.parse(t);
        if (Number.isFinite(d)) return d;
    }
    return undefined;
}

/** Prefer app/global base endpoint if provided; else undefined. */
function getGlobalSymbolBase(): string | undefined {
    const w = window as any;
    const base = w?.__symbolBase ?? w?.__symbolEndpoint;
    return (typeof base === "string" && base.trim()) ? base : undefined;
}

/** Build a URL like `${base}?sidc=...&size=...` (does not append if already there). */
function urlFromBaseAndSidc(base: string, sidc: string, size = 48): string {
    const hasQ = base.includes("?");
    const sep = hasQ ? "&" : "?";
    let url = `${base}${sep}sidc=${encodeURIComponent(sidc)}`;
    // add size if caller expects it (harmless if server ignores it)
    url += `&size=${size}`;
    return url;
}

/** Optional, synchronous milsymbol fallback → dataURL. */
function tryMilsymbolDataUrlSync(sidc: string, size = 48, fillHex?: string): string | undefined {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const MS = (window as any).milsymbol ?? require("milsymbol");
        if (!MS) return undefined;
        const opts: any = { size };
        if (fillHex) opts.fillColor = fillHex;
        const sym = new MS.Symbol(sidc, opts);
        const canvas = sym.asCanvas?.();
        const durl = canvas?.toDataURL?.("image/png");
        return (typeof durl === "string" && durl.startsWith("data:image/")) ? durl : undefined;
    } catch { return undefined; }
}

const ICON_PX = 40;

/** Build a URL/dataURL for a unit's icon synchronously (no async, no point fallback). */
function buildIconUrlSync(u: UnitRenderable, viewer?: Cesium.Viewer): string | undefined {
    // 0) If we already have an explicit image, keep it (do NOT invalidate it).
    if (typeof u.iconUrl === "string" && u.iconUrl.trim()) {
        const hex0 = normalizeHex(extractGroupFill(u));
        // Only tint real URLs; data: already baked
        const kept = (hex0 && !u.iconUrl.startsWith("data:"))
            ? (withSymbolColor(u.iconUrl, hex0) ?? u.iconUrl)
            : u.iconUrl;
        u.iconUrl = kept;
        return kept;
    }

    // 1) Resolve a SIDC if possible, but do NOT fail just because we can't.
    const sidc = effectiveSidc(u, viewer) ?? (u as any)?.sidc;

    // 2) First try the 2D cache snapshot (most reliable for “something shows”).
    // This works even if sidc is missing, but if it *is* present we pass color.
    const hex = normalizeHex(extractGroupFill(u));
    {
        const from2D = sidc ? tryGet2DIconSnapshotSync(sidc, ICON_PX, hex) : undefined;
        if (from2D && typeof from2D === "string") {
            u.iconUrl = from2D; // data URL (baked color) or http (ok)
            return from2D;
        }
    }

    // 3) App-level URL builders (prefer URL so we can tint later on change).
    let url: string | undefined = undefined;
    if (sidc) {
        url = tryGlobalUnitIconBuilder(u, sidc) ?? buildIconUrlForSidc(u, sidc);
    }

    // 4) If still nothing and we have a global symbol base, build a URL.
    if (!url && sidc) {
        const base = getGlobalSymbolBase();
        if (base) url = urlFromBaseAndSidc(base, sidc, ICON_PX);
    }

    // 5) If still nothing and we *do* have a SIDC, render a synchronous data URL.
    if (!url && sidc) {
        url = tryMilsymbolDataUrlSync(sidc, ICON_PX, hex);
    }

    // 6) Final guard: if we still have nothing, don’t nuke the entity—return undefined
    // so the caller can keep whatever billboard it already had. (applyBillboardGraphics
    // already avoids creating a billboard when no string is returned.)
    if (!url) return undefined;

    // 7) Only append color to real URLs; data: already baked
    if (hex && !url.startsWith("data:")) {
        url = withSymbolColor(url, hex) ?? url;
    }

    u.iconUrl = url;
    return url;
}



/* ───────────────────── Motion helpers (time-dynamic) ───────────────────── */

function hasDynamicPosition(u: UnitRenderable, ent: Cesium.Entity): boolean {
    // If we gave Cesium a CallbackProperty or SampledPositionProperty, let Cesium drive position from clock time
    const pos = ent.position as any;
    if (!pos) return false;
    const isCallback = pos instanceof CallbackProperty;
    const isSampled = pos instanceof SampledPositionProperty;
    // Also treat unit’s own motion definitions as dynamic
    const unitDynamic = typeof u.getPositionAtTime === "function" || (u.motionKeyframes?.length ?? 0) > 0;
    return Boolean(isCallback || isSampled || unitDynamic);
}

function lastLocEventAtOrBefore(uSrc: any, tMs: number): any | undefined {
    const evts: any[] = Array.isArray(uSrc?.state) ? uSrc.state : [];
    let best: any | undefined;
    for (const e of evts) {
        const te = evtTime(e); if (te == null) continue;
        if (!Object.prototype.hasOwnProperty.call(e, "location")) continue;
        if (te <= tMs && (!best || te > evtTime(best)!)) best = e;
    }
    return best;
}

function firstFutureNonNullLocEvent(uSrc: any, tMs: number): any | undefined {
    const evts: any[] = Array.isArray(uSrc?.state) ? uSrc.state : [];
    let best: any | undefined;
    for (const e of evts) {
        const te = evtTime(e); if (te == null) continue;
        if (!Array.isArray(e?.location)) continue;
        if (te >= tMs && (!best || te < evtTime(best)!)) best = e;
    }
    return best;
}

function buildPositionPropertyForUnit(u: UnitRenderable) {
    if (u.motionKeyframes && u.motionKeyframes.length) {
        const spp = new SampledPositionProperty();
        const frames = [...u.motionKeyframes].sort((a, b) => a.t - b.t);
        for (const kf of frames) {
            const jd = JulianDate.fromDate(new Date(kf.t));
            const pos = Cartesian3.fromDegrees(kf.lon, kf.lat, kf.alt ?? 0);
            spp.addSample(jd, pos);
        }
        return spp as Cesium.PositionProperty;
    }

    if (typeof u.getPositionAtTime === "function") {
        const cb = new CallbackProperty((time: JulianDate) => {
            try {
                const unixMs = JulianDate.toDate(time).getTime();
                const p = u.getPositionAtTime!(unixMs);
                return p ? Cartesian3.fromDegrees(p.lon, p.lat, p.alt ?? 0) : undefined;
            } catch {
                return undefined;
            }
        }, false);
        return cb as Cesium.PositionProperty;
    }

    return undefined; // static
}

function applyPathGraphics(ent: Cesium.Entity, u: UnitRenderable) {
    const wantShow = u.pathStyle?.show ?? false;
    const pos: any = ent.position;
    const supportsRef = pos && typeof pos.getValueInReferenceFrame === "function";

    if (!wantShow || !supportsRef) {
        ent.path = undefined;
        return;
    }

    const width = u.pathStyle?.width ?? 2;
    const lead = u.pathStyle?.leadTime ?? 60;
    const trail = u.pathStyle?.trailTime ?? 300;
    const color = Color.fromCssColorString(u.pathStyle?.colorCss ?? "rgba(255,255,255,0.6)");

    ent.path = {
        show: true,
        width,
        leadTime: lead,
        trailTime: trail,
        material: color,
        clampToGround: true,
    };
}

/* ─────────────────────────────── Types ─────────────────────────────── */

export type TrackPoint = { t: number; lon: number; lat: number; alt?: number };

export type UnitRenderable = {
    id: string;
    name?: string;
    lat: number;
    lon: number;

    alt?: number;
    altIsAgl?: boolean;
    track?: TrackPoint[];

    iconUrl?: string;
    clampToGround?: boolean;
    interpolation?: "linear" | "hermite" | "lagrange";

    render?: "billboard" | "block";
    hoverMeters?: number;
    blockSize?: { x: number; y: number; z: number };

    symbolOptions?: {
        fillColor?: string;
        iconFillColor?: string;
        [k: string]: any;
    };

    blockColorCss?: string;

    labelOffsetPxY?: number;

    validFromMs?: number;
    validToMs?: number;

    motionKeyframes?: Array<{ t: number; lon: number; lat: number; alt?: number }>;

    /** If present, this should be the 2D/store unit object (with .state[]). */
    __sourceUnit?: any;

    getPositionAtTime?: (tUnixMs: number) => { lon: number; lat: number; alt?: number } | undefined;

    pathStyle?: { show?: boolean; leadTime?: number; trailTime?: number; width?: number; colorCss?: string };
};

export interface GlobePort {
    mount: (el: HTMLDivElement) => Promise<void>;
    unmount: () => void;

    setUnits: (units: UnitRenderable[]) => void;
    upsertUnit: (u: UnitRenderable) => void;
    removeUnit: (id: string) => void;

    setTime?: (epochMs: number) => void;
    setTimeBounds?: (startMs: number, stopMs: number) => void;

    enableDayNight?: (enabled: boolean) => void;
    enableSkybox?: (enabled: boolean) => void;
    enableCloudOverlay?: (enabled: boolean, options?: GibsCloudOptions) => void;

    flyToLatLon: (lon: number, lat: number, height?: number) => void;

    setExaggeration: (factor: number) => Promise<void>;
    setBaseLayer: (key: string) => void;
    setBaseLayerTemplate: (
        url: string,
        opts?: {
            minLevel?: number;
            maxLevel?: number;
            attribution?: string;
            geographic?: boolean;
            subdomains?: string[] | string;
        }
    ) => void;
    setTerrainKey: (key: "world" | "flat") => Promise<void>;

    updateUnitPosition?: (id: string, lon: number, lat: number, alt?: number) => void;

    addOverlayTemplate: (
        id: string,
        url: string,
        opts?: {
            minLevel?: number;
            maxLevel?: number;
            attribution?: string;
            geographic?: boolean;
            subdomains?: string[] | string;
            alpha?: number;
        }
    ) => void;
    removeOverlay: (id: string) => void;
    setOverlayVisibility: (id: string, show: boolean) => void;
    setOverlayAlpha: (id: string, alpha: number) => void;
    listOverlays: () => { id: string; show: boolean; alpha: number }[];

    setUnitFilter?: (fn?: (u: any) => boolean) => void;
    refreshVisibility?: () => void;
}

/* ─────────────────────────────── CRS & terrain ─────────────────────────────── */

const wgs84 = "EPSG:4326";
const merc = "EPSG:3857";

export function toWgs84(lon3857: number, lat3857: number) {
    const [lon, lat] = proj4(merc, wgs84, [lon3857, lat3857]);
    return { lon, lat };
}

export async function sampleHeight(viewer: Viewer, lon: number, lat: number) {
    const c = Cartographic.fromDegrees(lon, lat);
    const provider = (viewer.terrain as any).provider;
    const [result] = await sampleTerrainMostDetailed(provider, [c]);
    return result?.height ?? 0;
}

/* ───────────────────────────── Label helper ───────────────────────────── */

function makeSideLabel(
    text: string,
    heightRef: HeightReference,
    side: "left" | "right" = "left",
    pixelOffsetY = -12
) {
    const isLeft = side === "left";
    const offsetX = isLeft ? -12 : 12;
    const hOrigin = isLeft ? HorizontalOrigin.RIGHT : HorizontalOrigin.LEFT;

    return {
        text,
        font: "bold 14px 'Segoe UI', system-ui, -apple-system, Roboto, Arial",
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        fillColor: Color.BLACK,
        outlineColor: Color.WHITE,
        outlineWidth: 3,
        showBackground: false,
        heightReference: heightRef,
        verticalOrigin: VerticalOrigin.BOTTOM,
        horizontalOrigin: hOrigin,
        pixelOffset: new Cartesian2(offsetX, pixelOffsetY),
        disableDepthTestDistance: 0,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 2_000_000.0),
        scaleByDistance: new Cesium.NearFarScalar(800, 1.1, 2_000_000, 0.5),
        translucencyByDistance: new Cesium.NearFarScalar(50_000, 1.0, 1_500_000, 0.4),
        pixelOffsetScaleByDistance: new Cesium.NearFarScalar(800, 1.0, 2_000_000, 0.4),
    };
}

/* ───────────────────── Exaggeration-aware heights ───────────────────── */

const entities = new Map<string, Cesium.Entity>();
const unitMeta = new Map<string, UnitRenderable>();
const lastFillHex = new Map<string, string | undefined>();
let exaggerationFactor = 1;
let groupColorIdx: Map<string | number, string> = new Map();

/* filter state */
let _unitFilter: (u: any) => boolean = () => true;
let _lastUnitsInput: UnitRenderable[] = [];

/* imagery & overlays */
let baseImageryLayer: Cesium.ImageryLayer | undefined;
const overlayLayers = new Map<string, Cesium.ImageryLayer>();

/** Publish debug handles to window so the console can inspect current 3D units. */
function publishDebug(viewer?: Cesium.Viewer) {
    try {
        const w: any = window;
        // Preserve existing MentatGlobe object (adapter) and just attach/refresh .viewer
        w.MentatGlobe = w.MentatGlobe || {};
        if (viewer) w.MentatGlobe.viewer = viewer;
        else if (!w.MentatGlobe.viewer) w.MentatGlobe.viewer = undefined;

        const dbg = w.MentatGlobeAdapterDebug ?? {};
        Object.assign(dbg, {
            viewer: viewer ?? dbg.viewer,
            _entities: entities,
            _unitMeta: unitMeta,
            getCounts: () => ({
                entities: (viewer ?? dbg.viewer)?.entities?.values?.length ?? 0,
                rawCount: w.__mentatLastSetUnits?.rawCount ?? null,
                filteredCount: w.__mentatLastSetUnits?.filteredCount ?? null,
                sample: w.__mentatLastSetUnits?.sample ?? null,
            }),
        });
        w.MentatGlobeAdapterDebug = dbg;

        w.MentatList3D = () => {
            const d = w.MentatGlobeAdapterDebug;
            if (d?._entities && typeof d._entities.keys === "function") {
                return Array.from(d._entities.keys());
            }
            const v = d?.viewer;
            return v ? (v.entities.values as any[]).map(e => e.id) : [];
        };

        w.MentatDebugSIDC = (id?: string) => {
            const d = w.MentatGlobeAdapterDebug;
            const v = d?.viewer;
            const t = v ? Cesium.JulianDate.toDate(v.clock.currentTime).getTime() : Date.now();
            let targetId = id;
            if (!targetId) {
                targetId = d?._entities ? Array.from(d._entities.keys())[0] : v?.entities?.values?.[0]?.id;
            }
            const ent = targetId ? (d?._entities?.get(targetId) ?? v?.entities?.getById?.(targetId)) : undefined;
            const u = ent ? d?._unitMeta?.get(ent.id) : undefined;
            const src = u?.__sourceUnit ?? u ?? null;
            const sidcFromEvents = src ? (w.lastSidcAtOrBefore?.(src, t)) : undefined;
            const sidcFromUnit = src?.sidc ?? u?.sidc;
            return { id: ent?.id, t, sidcFromEvents, sidcFromUnit, u, src };
        };
    } catch { /* no-op */ }
}


function scaledHover(h?: number) {
    return Math.max(0, h ?? 0) * exaggerationFactor;
}
function scaledAlt(alt?: number) {
    return (alt ?? 0) * exaggerationFactor;
}

function applyAvailability(ent: Cesium.Entity, u: UnitRenderable) {
    ent.availability = undefined;
}

/* ───────────────────────────── Graphics appliers ───────────────────────────── */

/** Place the label so its RIGHT edge sits at the icon's LEFT edge (minus pad),
 *  using the icon's *real* pixel width (naturalWidth/width * scale * scaleByDistance).
 *  It tracks image changes and re-evaluates each frame.
 */
function alignLabelToIconLeftEdge(
    viewer: Cesium.Viewer,
    ent: Cesium.Entity,
    u: UnitRenderable,
    padPx = 2
) {
    const bb = ent.billboard as Cesium.BillboardGraphics | undefined;
    const label = ent.label as Cesium.LabelGraphics | undefined;
    if (!bb || !label) return;

    // Label’s right edge should sit flush to the icon’s left edge
    label.horizontalOrigin = Cesium.HorizontalOrigin.RIGHT;
    label.verticalOrigin = Cesium.VerticalOrigin.BOTTOM;

    // keep your vertical lift behavior
    const lift = u.labelOffsetPxY ?? -20;

    // Clean any previous tick
    try {
        const old = (ent as any).__labelAlignTick as (() => void) | undefined;
        if (old) viewer.scene.postRender.removeEventListener(old);
    } catch { }

    // Small cache of intrinsic image width (so URLs without bb.width work)
    let intrinsicW: number | undefined;

    // Utility: read “property-or-value” at the viewer clock time
    const now = () => viewer.clock.currentTime;
    const v = <T,>(maybeProp: any, fallback: T): T => {
        try {
            if (maybeProp && typeof maybeProp.getValue === "function") {
                const out = maybeProp.getValue(now());
                return (out ?? fallback) as T;
            }
            return (maybeProp ?? fallback) as T;
        } catch { return fallback; }
    };

    // Try to ensure we have intrinsic width even when bb.width isn't set and image is a URL
    const ensureIntrinsicWidth = () => {
        const imgVal: any = v(bb.image, undefined);
        if (!imgVal) return;

        // If already an HTMLImageElement (from 2D cache), use its dimensions directly
        if (imgVal && (imgVal.naturalWidth || imgVal.width)) {
            intrinsicW = (imgVal.naturalWidth ?? imgVal.width) as number;
            return;
        }

        // If it's a string (URL or data URL) and we haven’t cached yet, preload once
        if (typeof imgVal === "string" && !intrinsicW) {
            try {
                const key = imgVal; // include sidc/fill params so size caches per symbol
                const cache = ((window as any).__bbSizeCache ||= new Map<string, number>());
                const cached = cache.get(key);
                if (cached) { intrinsicW = cached; return; }

                const im = new Image();
                im.onload = () => {
                    intrinsicW = im.naturalWidth || im.width || undefined;
                    if (intrinsicW) cache.set(key, intrinsicW);
                };
                im.onerror = () => { /* ignore; we'll retry next frame */ };
                im.src = imgVal;
            } catch { /* ignore */ }
        }
    };

    // Evaluate Cesium.NearFarScalar like Cesium does
    const evalNearFar = (nfs: Cesium.NearFarScalar | undefined, d: number): number => {
        if (!nfs) return 1;
        const near = (nfs as any).near ?? (nfs as any)._near ?? 1;
        const nVal = (nfs as any).nearValue ?? (nfs as any)._nearValue ?? 1;
        const far = (nfs as any).far ?? (nfs as any)._far ?? 1e9;
        const fVal = (nfs as any).farValue ?? (nfs as any)._farValue ?? 1;
        if (d <= near) return nVal;
        if (d >= far) return fVal;
        const t = (d - near) / Math.max(1e-9, far - near);
        return nVal + (fVal - nVal) * t;
    };

    const tick = () => {
        const time = now();
        const pos = ent.position?.getValue(time) as Cesium.Cartesian3 | undefined;
        if (!pos) return;

        ensureIntrinsicWidth();
        // 1) Base width: prefer explicit bb.width, else intrinsic (naturalWidth)
        let baseW = v<number | undefined>(bb.width, undefined);
        if (!(typeof baseW === "number" && baseW > 0)) baseW = intrinsicW;
        if (!(typeof baseW === "number" && baseW > 0)) return; // width unknown yet

        // 2) Effective scale = scale * scaleByDistance(distance)
        const baseScale = v<number>(bb.scale, 1);
        let distScale = 1;
        try {
            const dist = Cesium.Cartesian3.distance(viewer.camera.positionWC, pos);
            distScale = evalNearFar(v<Cesium.NearFarScalar | undefined>(bb.scaleByDistance, undefined), dist);
        } catch { /* ignore */ }
        const effScale = baseScale * distScale;

        // 3) Effective billboard width in screen pixels
        const effWidthPx = baseW * effScale;

        // 4) Respect billboard.horizontalOrigin & pixelOffset
        const bbH = v<number>(bb.horizontalOrigin, Cesium.HorizontalOrigin.CENTER);
        const leftFromOrigin =
            bbH === Cesium.HorizontalOrigin.LEFT ? 0 :
                bbH === Cesium.HorizontalOrigin.RIGHT ? -effWidthPx :
                    -effWidthPx / 2; // CENTER

        const bbPx = v<Cesium.Cartesian2 | undefined>(bb.pixelOffset, undefined);
        const bbOffX = bbPx ? bbPx.x : 0;

        // 5) Put label’s RIGHT edge at the icon’s LEFT edge minus pad
        const rightEdgeX = leftFromOrigin + bbOffX - padPx;

        // Apply offsets and keep your lift
        label.pixelOffset = new Cesium.Cartesian2(rightEdgeX, lift);

        // Make label distance behavior track billboard (optional, but helps match feel)
        const lblNfs = v<Cesium.NearFarScalar | undefined>(label.pixelOffsetScaleByDistance, undefined);
        if (!lblNfs && bb.scaleByDistance) {
            // Ensures the label offset scales similarly to the icon’s scaleByDistance curve
            label.pixelOffsetScaleByDistance = v(bb.scaleByDistance, undefined) as any;
        }
    };

    viewer.scene.postRender.addEventListener(tick);
    (ent as any).__labelAlignTick = tick;
}



function applyBlockGraphics(ent: Cesium.Entity, u: UnitRenderable) {
    const size = u.blockSize ?? { x: 12, y: 12, z: 4 };
    const color = safeCssColor(u.symbolOptions?.fillColor).withAlpha(0.92);
    const h = Math.max(0.1, scaledHover(u.hoverMeters ?? 8));

    setEntityPosition(ent, u.lon, u.lat, h);

    ent.box = {
        dimensions: new Cartesian3(size.x, size.y, size.z),
        material: color,
        heightReference: HeightReference.RELATIVE_TO_GROUND,
        outline: true,
        outlineColor: Color.BLACK,
    };

    if (u.name) {
        const lift = u.labelOffsetPxY ?? -14;
        ent.label = makeSideLabel(u.name, HeightReference.RELATIVE_TO_GROUND, "left", lift);
        if (ent.label) {
            ent.label.fillColor = Cesium.Color.BLACK;
            ent.label.outlineColor = Cesium.Color.WHITE;
            ent.label.outlineWidth = 3;
            ent.label.style = Cesium.LabelStyle.FILL_AND_OUTLINE;
            ent.label.font = "bold 14px 'Segoe UI', sans-serif";
            ent.label.pixelOffset = new Cesium.Cartesian2(0, lift);
            ent.label.showBackground = false;
        }
    } else {
        ent.label = undefined;
    }

    ent.billboard = undefined;
    applyAvailability(ent, u);
}

/** Height reference selector matching your existing semantics. */
function unitHeightRef(u: any): HeightReference {
    const wantsClamp = u?.clampToGround !== false && u?.alt == null;
    if (wantsClamp) return HeightReference.CLAMP_TO_GROUND;
    if (u?.altIsAgl === false) return HeightReference.NONE;
    return HeightReference.RELATIVE_TO_GROUND;
}

/** Current epoch ms from the viewer clock if available, otherwise Date.now(). */
function currentViewerMs(viewer?: Cesium.Viewer): number | undefined {
    try {
        const jd = viewer?.clock?.currentTime;
        return jd ? Cesium.JulianDate.toDate(jd).getTime() : undefined;
    } catch {
        return undefined;
    }
}

/** Resolve the effective SIDC at the viewer’s current time (or now), with extra fallbacks. */
function effectiveSidc(u: UnitRenderable, viewer?: Cesium.Viewer): string | undefined {
    const src = (u as any).__sourceUnit ?? u;
    const tMs = currentViewerMs(viewer);

    // 1) From events at/≤ t
    const fromEvents = lastSidcAtOrBefore(src, tMs);
    if (typeof fromEvents === "string" && fromEvents.trim()) return fromEvents;

    // 2) From computeSnapshot (some pipelines keep current sidc only in events logic)
    try {
        const snap = computeSnapshot(u, tMs);
        if (typeof snap?.sidc === "string" && snap.sidc.trim()) return snap.sidc;
    } catch { /* ignore */ }

    // 3) From various base locations (both source and renderable)
    const candidates = [
        (src as any)?.sidc,
        (src as any)?._state?.sidc,
        (u as any)?.sidc,
        (u as any)?._state?.sidc,
    ];

    for (const c of candidates) {
        if (typeof c === "string" && c.trim()) return c;
    }

    // 4) Nothing resolvable
    return undefined;
}

function applyBillboardGraphics(ent: Cesium.Entity, u: UnitRenderable, viewer?: Cesium.Viewer) {
    // Height ref + motion
    const hRef = unitHeightRef(u);
    const motion = buildPositionPropertyForUnit(u);

    if (motion) {
        ent.position = motion;
        ent.orientation = new VelocityOrientationProperty(motion);
    } else {
        const height = hRef === HeightReference.RELATIVE_TO_GROUND ? scaledAlt(u.alt ?? 0) : (u.alt ?? 0);
        setEntityPosition(ent, u.lon, u.lat, height);
        ent.orientation = undefined;
    }

    applyPathGraphics(ent, u);

    // Build icon synchronously; do not create a billboard if nothing is available
    const url = buildIconUrlSync(u, viewer);
    ent.point = undefined as any;

    if (typeof url === "string" && url.length > 0) {
        ent.billboard = new Cesium.BillboardGraphics({
            image: url,
            // IMPORTANT: no color tint here; let the image carry its own colors
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            heightReference: hRef,
            disableDepthTestDistance: 0,
            scaleByDistance: new Cesium.NearFarScalar(800.0, 1.0, 2_000_000.0, 0.5),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 10_000_000.0),
        });
    } else {
        // No image → make sure we don't leave a broken/undefined graphics object around
        ent.billboard = undefined as any;
    }

    // Label
    ent.label = u.name ? makeSideLabel(u.name, hRef, "left", u.labelOffsetPxY ?? -12) : undefined;
    if (u.name && ent.label && viewer) {
        alignLabelToIconLeftEdge(viewer, ent, u, /*padPx=*/ 2);
    }

    applyAvailability(ent, u);
}


/* ──────────────────────── Event-time helpers (NEW) ──────────────────────── */

/** Inspect the source unit's event list at time t. */
function getSnapshotFromEvents(uSrc: any, tMs: number): { onMap: boolean; loc?: [number, number]; sidc?: string } {
    const events: any[] = Array.isArray(uSrc?.state) ? uSrc.state : [];
    if (events.length === 0) {
        // If no events, default to unit-level state
        const baseLoc = uSrc?._state?.location ?? uSrc?.location;
        const onMap = !!(Array.isArray(baseLoc) && baseLoc.length >= 2);
        const sidc = uSrc?.sidc;
        return { onMap, loc: onMap ? [baseLoc[0], baseLoc[1]] : undefined, sidc };
    }

    // Find last event at/ before t
    let lastEvt: any | undefined;
    for (const e of events) {
        if (typeof e?.t !== "number") continue;
        if (e.t <= tMs && (!lastEvt || e.t > lastEvt.t)) lastEvt = e;
    }

    if (!lastEvt) {
        // No prior event; treat as "before first event": on/off map based on initial state
        const initLoc = uSrc?._state?.location ?? uSrc?.location;
        const onMap = !!(Array.isArray(initLoc) && initLoc.length >= 2);
        return { onMap, loc: onMap ? [initLoc[0], initLoc[1]] : undefined, sidc: uSrc?.sidc };
    }

    const hasNull = Object.prototype.hasOwnProperty.call(lastEvt, "location") && lastEvt.location === null;
    const locArr = Array.isArray(lastEvt.location) ? lastEvt.location as [number, number] : undefined;
    const sidc = lastEvt.sidc ?? uSrc?.sidc;

    return { onMap: !hasNull, loc: locArr, sidc };
}

function findLastEventAtOrBefore(uSrc: any, tMs: number): any | undefined {
    const evts: any[] = Array.isArray(uSrc?.state) ? uSrc.state : [];
    let best: any | undefined;
    for (const e of evts) {
        if (typeof e?.t !== "number") continue;
        if (e.t <= tMs && (!best || e.t > best.t)) best = e;
    }
    return best;
}

function hasAnyNonNullLocationEvent(uSrc: any): boolean {
    const evts: any[] = Array.isArray(uSrc?.state) ? uSrc.state : [];
    return evts.some(e => Array.isArray(e?.location) && e.location.length >= 2);
}

function lastSidcAtOrBefore(uSrc: any, tMs: number): string | undefined {
    const evts: any[] = Array.isArray(uSrc?.state) ? uSrc.state : [];
    let bestSidc: string | undefined = uSrc?.sidc;
    let bestT = -Infinity;
    for (const e of evts) {
        const te = evtTime(e); if (te == null) continue;
        if (te <= tMs && typeof e.sidc === "string" && te >= bestT) {
            bestT = te;
            bestSidc = e.sidc;
        }
    }
    return bestSidc;
}

/** Decide visibility and position like 2-D: visible unless last ≤t event says location:null. */
type SnapshotAtTime = { onMap: boolean; lon?: number; lat?: number; sidc?: string };

function computeSnapshot(u: UnitRenderable, tMs: number): SnapshotAtTime {
    const src = (u as any).__sourceUnit ?? u;

    // Visibility: OFF only if the most recent <= t event that mentions 'location' sets it to null
    const lastLocEvt = lastLocEventAtOrBefore(src, tMs);
    const explicitlyOff = !!(lastLocEvt && Object.prototype.hasOwnProperty.call(lastLocEvt, "location") && lastLocEvt.location === null);

    // Position: prefer dynamic interpolator; else progressively relax
    let pos: { lon: number; lat: number; alt?: number } | undefined;

    try {
        if (typeof u.getPositionAtTime === "function") {
            pos = u.getPositionAtTime(tMs);
        } else {
            pos = getUnitPositionAtTime(src, tMs);
        }
    } catch { /* ignore */ }

    if (!pos) {
        // (a) last event ≤ t with explicit non-null location
        if (lastLocEvt && Array.isArray(lastLocEvt.location)) {
            pos = { lon: lastLocEvt.location[0], lat: lastLocEvt.location[1] };
        } else {
            // (b) base/initial location
            const baseLoc = src?._state?.location ?? (src as any).location;
            if (Array.isArray(baseLoc)) {
                pos = { lon: baseLoc[0], lat: baseLoc[1] };
            } else {
                // (c) earliest future non-null location (so unit appears before its first event)
                const fut = firstFutureNonNullLocEvent(src, tMs);
                if (fut && Array.isArray(fut.location)) {
                    pos = { lon: fut.location[0], lat: fut.location[1] };
                } else if (typeof u.lon === "number" && typeof u.lat === "number") {
                    // (d) final fallback to renderable's own lon/lat if provided
                    pos = { lon: u.lon, lat: u.lat };
                }
            }
        }
    }

    // ON if not explicitly turned off and we can determine any plausible position
    const onMap = !explicitlyOff && !!pos;

    // SIDC in effect: last sidc ≤ t (fallback to unit-level)
    const sidc = lastSidcAtOrBefore(src, tMs) ?? u.sidc;

    return { onMap, lon: pos?.lon, lat: pos?.lat, sidc };
}

/** Apply a SIDC change in-place to an existing entity+renderable. */
function buildIconUrlForSidc(u: UnitRenderable, sidc?: string): string | undefined {
    if (!sidc) return u.iconUrl;

    // 1) app-level hook
    const hook = (window as any)?.__symbolUrlFromSidc;
    if (typeof hook === "function") {
        try { return hook(sidc, u); } catch { }
    }

    // 2) patch existing sidc= param
    if (u.iconUrl && /[?&]sidc=/i.test(u.iconUrl)) {
        return u.iconUrl.replace(/([?&]sidc=)[^&]*/i, `$1${encodeURIComponent(sidc)}`);
    }

    // 3) append sidc= param
    if (u.iconUrl) {
        const sep = u.iconUrl.includes("?") ? "&" : "?";
        return `${u.iconUrl}${sep}sidc=${encodeURIComponent(sidc)}`;
    }

    // 4) no known base → allow hook to supply later; return undefined
    return undefined;
}

function tryGlobalUnitIconBuilder(u: UnitRenderable, sidc?: string): string | undefined {
    const f = (window as any)?.__buildIconUrlForUnit;
    if (typeof f === "function") {
        try { return f(u, sidc); } catch { }
    }
    return undefined;
}

function applySidcChange(
    ent: Cesium.Entity,
    u: UnitRenderable,
    sidc?: string,
    viewer?: Cesium.Viewer,
    tMs?: number
) {
    if (!sidc || u.sidc === sidc) return;
    u.sidc = sidc;

    // Prefer an app-provided builder; else a generic patcher.
    let baseUrl =
        tryGlobalUnitIconBuilder(u, sidc) ??
        buildIconUrlForSidc(u, sidc);

    const hex = normalizeHex(extractGroupFill(u));

    // --- NEW: avoid grey data URLs when we have a color ---
    // If we don't have a usable URL, or we only have a data URL (non-tintable),
    // try to construct a *URL* from a global base so we can append ?fill&fc.
    if (!baseUrl || baseUrl.startsWith("data:")) {
        const base = getGlobalSymbolBase?.();

        // If we have a color and a base endpoint, prefer a recolorable URL.
        if (hex && base) {
            const rebuilt = urlFromBaseAndSidc(base, sidc!, ICON_PX);
            baseUrl = withSymbolColor(rebuilt, hex) ?? rebuilt;
        } else {
            // Otherwise, try sync cache; if still nothing, keep whatever we had.
            const cached = getSidcIconSync(sidc, ICON_PX, { fillColor: hex });
            if (typeof cached === "string") {
                baseUrl = cached; // (may be data:, acceptable only when we can’t tint)
            }
        }
    }

    // Persist for future rebuilds.
    if (baseUrl) u.iconUrl = baseUrl;

    // Cache-buster
    let url = baseUrl;
    if (url) {
        const sep = url.includes("?") ? "&" : "?";
        url = `${url}${sep}cb=${(tMs ?? Date.now()) & 0xffff}`;
    }

    // Ensure color is on the URL (no-op for data: URLs).
    if (url) url = withSymbolColor(url, hex) ?? url;

    // Billboard image update (and ensure no tint property is fighting us).
    if (url) {
        if (ent.billboard) {
            (ent.billboard as any).image = url;
        } else {
            ent.point = undefined as any;
            ent.billboard = {
                image: url,
                verticalOrigin: VerticalOrigin.BOTTOM,
                horizontalOrigin: HorizontalOrigin.CENTER,
                heightReference:
                    (u.clampToGround !== false && u.alt == null)
                        ? HeightReference.CLAMP_TO_GROUND
                        : HeightReference.RELATIVE_TO_GROUND,
                disableDepthTestDistance: 0,
                scaleByDistance: new Cesium.NearFarScalar(800, 1.0, 2_000_000, 0.4),
            } as any;
        }
        try { (ent.billboard as any).color = undefined; } catch { /* ignore */ }
    } else {
        ent.billboard = undefined as any;
        applyBillboardGraphics(ent, u, viewer as any);
    }
    if (ent.label && viewer) {
        alignLabelToIconLeftEdge(viewer, ent, u, /*padPx=*/ 2);
    }

    viewer?.scene.requestRender();
}


/* ───────────────────────────── Adapter (public API) ─────────────────────────── */

function replaceBaseImageryLayer(viewer: Cesium.Viewer, provider: Cesium.ImageryProvider) {
    const layers = viewer.imageryLayers;
    const added = layers.addImageryProvider(provider, 0);

    if (baseImageryLayer && !baseImageryLayer.isDestroyed()) {
        try {
            layers.remove(baseImageryLayer, true);
        } catch { }
    }
    baseImageryLayer = added;
    viewer.scene.requestRender();
}

function refreshGroupIndexFromScenario() {
    try {
        const storeLike = (window as any).__scenario?.store ?? (window as any).__scenario ?? null;
        if (!storeLike) return;
        const idx = buildIndexFromScenarioStore(storeLike);
        if (idx && idx.size > 0) groupColorIdx = idx;
    } catch { }
}

function providerFromTemplate(
    url: string,
    opts?: {
        minLevel?: number;
        maxLevel?: number;
        attribution?: string;
        geographic?: boolean;
        subdomains?: string[] | string;
    }
) {
    const { minLevel = 0, maxLevel = 19, attribution, geographic = false, subdomains } = opts ?? {};

    let u = url;
    if (u.startsWith("//")) u = (location?.protocol ?? "https:") + u;

    return new Cesium.UrlTemplateImageryProvider({
        url: u,
        minimumLevel: minLevel,
        maximumLevel: maxLevel,
        credit: attribution,
        tilingScheme: geographic ? new Cesium.GeographicTilingScheme() : new Cesium.WebMercatorTilingScheme(),
        subdomains: typeof subdomains === "string" ? subdomains.split("") : subdomains,
    });
}

export function createGlobeAdapter(): GlobePort {
    let api: GlobeApi | null = null;
    let wx: WeatherSkyController | null = null;
    const { getByKey } = makeImageryProviders();

    // track last visibility+sidc we applied so we only touch Cesium when needed
    const lastOnMap = new Map<string, boolean>();
    const lastSidc = new Map<string, string | undefined>();

    // ---------- Filter-aware setUnits implementation ----------
    const setUnitsInner = (units: UnitRenderable[]) => {
        if (!api) return;
        const viewer = api.viewer;
        if (!groupColorIdx || groupColorIdx.size === 0) refreshGroupIndexFromScenario();

        const raw = Array.isArray(units) ? units.slice() : [...(units as any)];
        _lastUnitsInput = raw;

        const unitsArr = raw.filter(u => (typeof _unitFilter === "function" ? _unitFilter(u) : true) && !isHidden2D(u));

        try {
            const removedByFilter: string[] = [];
            const removedByHidden: string[] = [];
            for (const u of raw) {
                const passFilter = (typeof _unitFilter === "function" ? _unitFilter(u) : true);
                const hidden = isHidden2D(u);
                if (!passFilter) removedByFilter.push(u.id);
                else if (hidden) removedByHidden.push(u.id);
            }
            (window as any).__mentatLastSetUnits = {
                rawCount: raw.length,
                filteredCount: unitsArr.length,
                rawIds: raw.map(u => u.id).slice(0, 200),
                keptIds: unitsArr.map(u => u.id).slice(0, 200),
                removedByFilter,
                removedByHidden,
            };
        } catch { }

        try {
            (window as any).__mentatLastSetUnits = {
                rawCount: raw.length,
                filteredCount: unitsArr.length,
                sample: raw[0]?.id,
            };
        } catch { }

        applyGroupFillColors(unitsArr, groupColorIdx, { mirrorToIcon: false });

        const seen = new Set<string>();
        for (const u of unitsArr) {
            seen.add(u.id);
            const ent = viewer.entities.getById(u.id) ?? viewer.entities.add({ id: u.id });
            entities.set(u.id, ent);
            unitMeta.set(u.id, u);

            // Resolve the event SIDC *now* so initial billboard uses it
            const tNow = currentViewerMs(viewer);
            const sidcNow = tNow != null ? lastSidcAtOrBefore((u as any).__sourceUnit ?? u, tNow) : undefined;
            // Do NOT force-persist here; let the rolling clock drive changes
            lastSidc.set(u.id, sidcNow);

            if (isInstallationBySidc(u)) {
                applyInstallationGraphics(ent as any, u as any, {
                    getParentById: (id) => unitMeta.get(id),
                    defaultSize: { x: 20, y: 20, z: 10 },
                    style: "footprint",
                });
                applyAvailability(ent, u);
            } else if (u.render === "block") {
                applyBlockGraphics(ent, u);
            } else {
                applyBillboardGraphics(ent, u, api.viewer);
            }

            // default visible; time updates may hide it
            ent.show = true;
        }

        // prune anything not in list
        const toRemove: any[] = [];
        (api.viewer.entities.values as any).forEach((e: any) => {
            const id = e.id as string;
            if (!seen.has(id)) toRemove.push(id);
        });
        toRemove.forEach((id) => {
            api!.viewer.entities.removeById(id);
            entities.delete(id);
            unitMeta.delete(id);
            lastOnMap.delete(id);
            lastSidc.delete(id);
        });

        viewer.scene.requestRender();
        publishDebug(viewer);
    };
    // ---------------------------------------------------------

    function reapplyVisibility() {
        setUnitsInner(_lastUnitsInput);
    }

    /** Core: evaluate all units at time t and apply on/off map + sidc changes. */
    function updateAllUnitsAtTime(tMs: number) {
        if (!api) return;
        const viewer = api.viewer;
        const now = viewer?.clock?.currentTime;

        for (const [id, u] of unitMeta) {
            const ent = entities.get(id) ?? viewer.entities.getById(id);
            if (!ent) continue;

            // Respect filter + 2D hidden at all times
            const passes = (_unitFilter ? _unitFilter(u) : true) && !isHidden2D(u);
            if (!passes) {
                if (ent.show !== false) ent.show = false;
                continue;
            }

            // Decide per events
            const snap = computeSnapshot(u, tMs);

            // Visibility toggle (location=null ⇒ off map)
            // If we cannot determine a snapshot (no events + no base loc), we already fail-open above.
            const prevOn = lastOnMap.get(id);
            if (prevOn !== snap.onMap || prevOn == null) {
                ent.show = snap.onMap;
                lastOnMap.set(id, snap.onMap);
            }

            // If on-map, update position only for STATIC units.
            // Dynamic units (CallbackProperty/SampledPositionProperty or getPositionAtTime) are driven by Cesium clock.
            if (snap.onMap && typeof snap.lon === "number" && typeof snap.lat === "number") {
                if (!hasDynamicPosition(u, ent)) {
                    const wouldClamp = u.clampToGround !== false && u.alt == null;
                    const treatAsAgl = u?.altIsAgl !== false;
                    const baseAlt = u?.alt ?? 0;
                    const h = wouldClamp ? 0 : (treatAsAgl ? scaledAlt(baseAlt) : baseAlt);
                    setEntityPosition(ent, snap.lon, snap.lat, h);
                }
            }

            // Apply SIDC changes (event-time authoritative)
            const sidcEvt = snap.sidc ?? u.sidc;                // what *should* be active now
            const prevSidc = lastSidc.get(id);                  // what we *think* is active
            const sidcOnBillboard = sidcFromBillboard(ent);     // what the image actually encodes

            // Update if event SIDC moved OR billboard isn’t actually showing it
            if (sidcEvt && (sidcEvt !== prevSidc || sidcEvt !== sidcOnBillboard)) {
                // Clear any memoized base so we don’t stick to an old data: URL
                // (this nudges buildIconUrlSync/applySidcChange to rebuild a proper URL)
                try { if (u.iconUrl && u.iconUrl.startsWith("data:")) u.iconUrl = undefined as any; } catch { }

                applySidcChange(ent, u, sidcEvt, viewer, tMs);

                // Book-keeping so we only patch when the event SIDC actually changes
                lastSidc.set(id, sidcEvt);
                lastFillHex.delete(id);
            }

            // ───────────────────── react to fill color changes (replace params) ─────────────────────
            const curHex = normalizeHex(extractGroupFill(u));
            const prevHex = lastFillHex.get(id);

            if (curHex !== prevHex) {
                const bb = ent.billboard as Cesium.BillboardGraphics | undefined;

                const resolveImage = (): string | undefined => {
                    if (!bb) return undefined;
                    const img: any = bb.image as any;
                    if (typeof img === "string") return img;
                    if (img && typeof img.getValue === "function") {
                        try { return img.getValue(now); } catch { /* ignore */ }
                    }
                    return undefined;
                };

                let imgUrl = resolveImage();
                if (imgUrl && typeof imgUrl === "string") {
                    const nextUrl = withSymbolColor(imgUrl, curHex) ?? imgUrl;
                    (bb as any).image = nextUrl;
                } else {
                    // If we can't resolve a string URL, rebuild the billboard graphics safely
                    applyBillboardGraphics(ent, u, viewer);
                }

                lastFillHex.set(id, curHex);
            }
            // ──────────────────── END: fill color change handling ────────────────────
        }

        viewer.scene.requestRender?.();
    }

    return {
        async mount(el) {
            const { getByKey } = makeImageryProviders();
            const base =
                getByKey("esriWorldImagery")?.create() ??
                new UrlTemplateImageryProvider({
                    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
                    credit: "\u00A9 OpenStreetMap contributors",
                    subdomains: "abc",
                });

            api = await useGlobe(el, { imageryProvider: base });
            refreshGroupIndexFromScenario();
            wx = new WeatherSkyController(api.viewer);

            api.viewer.scene.globe.depthTestAgainstTerrain = true;

            // publish viewer + maps for the console
            publishDebug(api.viewer);

            try {
                (window as any).MentatDebugSIDC = (id?: string) => {
                    const dbg = (window as any).MentatGlobeAdapterDebug;
                    const viewer = dbg?.viewer;
                    const t = viewer ? Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime() : Date.now();

                    // Prefer our Map keys (exact ids we added), then Cesium as a fallback
                    let targetId = id;
                    if (!targetId) {
                        const firstKey = dbg?._entities && typeof dbg._entities.keys === "function"
                            ? Array.from(dbg._entities.keys())[0]
                            : undefined;
                        targetId = firstKey ?? viewer?.entities?.values?.[0]?.id;
                    }

                    const ent = targetId
                        ? (dbg?._entities?.get(targetId) ?? viewer?.entities?.getById?.(targetId))
                        : undefined;

                    const u = ent ? dbg?._unitMeta?.get(ent.id) : undefined;
                    const src = u?.__sourceUnit ?? u ?? null;

                    const sidcFromEvents = src ? (window as any).lastSidcAtOrBefore?.(src, t) : undefined;
                    const sidcFromUnit = src?.sidc ?? u?.sidc;

                    return { id: ent?.id, t, sidcFromEvents, sidcFromUnit, u, src };
                };
            } catch { }

            api.viewer.scene.globe.depthTestAgainstTerrain = true;
            api.viewer.clock.shouldAnimate = false;
            api.viewer.clock.clockRange = ClockRange.CLAMPED;

            baseImageryLayer =
                api.viewer.imageryLayers.length > 0 ? api.viewer.imageryLayers.get(0) : undefined;
        },

        unmount() {
            if (!api) return;
            wx?.dispose();
            wx = null;
            api.destroy();
            api = null;
            entities.clear();
            unitMeta.clear();
            baseImageryLayer = undefined;
            overlayLayers.clear();
            groupColorIdx = new Map();
        },

        setUnits(units) {
            setUnitsInner(units);
        },

        upsertUnit(u) {
            if (!api) return;
            if (!groupColorIdx || groupColorIdx.size === 0) refreshGroupIndexFromScenario();
            applyGroupFillColorToUnit(u as any, groupColorIdx, { mirrorToIcon: false });

            const visibleByFilter = _unitFilter ? _unitFilter(u) : true;
            const notHidden2D = !isHidden2D(u);
            const passes = visibleByFilter && notHidden2D;

            const entExisting = api.viewer.entities.getById(u.id);

            if (!passes) {
                if (entExisting) {
                    api.viewer.entities.removeById(u.id);
                    entities.delete(u.id);
                    unitMeta.delete(u.id);
                    // also clear caches to avoid stale state
                    (lastOnMap as Map<string, boolean>).delete(u.id);
                    (lastSidc as Map<string, string | undefined>).delete(u.id);
                    lastFillHex.delete(u.id);
                    api.viewer.scene.requestRender();
                }
                unitMeta.set(u.id, u);
                return;
            }

            const ent = entExisting ?? api.viewer.entities.add({ id: u.id });
            entities.set(u.id, ent);
            unitMeta.set(u.id, u);

            if (isInstallationBySidc(u)) {
                applyInstallationGraphics(ent as any, u as any, {
                    getParentById: (id) => unitMeta.get(id),
                    defaultSize: { x: 20, y: 20, z: 10 },
                    style: "footprint",
                });
                applyAvailability(ent, u);
            } else if (u.render === "block") {
                applyBlockGraphics(ent, u);
            } else {
                applyBillboardGraphics(ent, u, api.viewer);
            }

            ent.show = true;
            api.viewer.scene.requestRender();
            publishDebug(api.viewer);

            if (!u.getPositionAtTime && (u as any).__sourceUnit) {
                const src = (u as any).__sourceUnit;
                u.getPositionAtTime = (tMs) => getUnitPositionAtTime(src, tMs);
            }
        },

        removeUnit(id) {
            if (!api) return;
            api.viewer.entities.removeById(id);
            entities.delete(id);
            unitMeta.delete(id);
            (lastOnMap as Map<string, boolean>).delete(id);
            (lastSidc as Map<string, string | undefined>).delete(id);
            lastFillHex.delete(id);
            api.viewer.scene.requestRender();
            publishDebug(api.viewer);
        },

        flyToLatLon(lon, lat, height = 120000) {
            if (!api) return;
            api.viewer.camera.flyTo({
                destination: Cartesian3.fromDegrees(lon, lat, height),
                duration: 1.0,
            });
        },

        onCameraChange(cb: (o: { heading: number; pitch: number; roll: number }) => void) {
            // If useGlobe provides a native subscription, forward to it.
            if (api && typeof (api as any).onCameraChange === "function") {
                return (api as any).onCameraChange(cb);
            }

            // Fallback: wire to viewer postRender and synthesize the payload.
            const v = api?.viewer;
            if (!v) {
                console.warn("[GlobeAdapter] onCameraChange called before mount; no-op.");
                return () => { };
            }
            const handler = () => {
                const c = v.camera;
                cb({ heading: c.heading, pitch: c.pitch, roll: c.roll });
            };
            try { v.scene.postRender.addEventListener(handler); } catch { }
            handler(); // push an initial sample
            return () => { try { v.scene.postRender.removeEventListener(handler); } catch { } };
        },

        async setExaggeration(factor: number) {
            if (!api) return;
            exaggerationFactor = factor;
            await api.setExaggeration(factor);

            for (const [id, ent] of entities) {
                const u = unitMeta.get(id);
                if (!u) continue;
                if (isInstallationBySidc(u)) {
                    applyInstallationGraphics(ent as any, u as any, {
                        getParentById: (pid) => unitMeta.get(pid),
                        defaultSize: { x: 20, y: 20, z: 10 },
                        style: "footprint",
                    });
                    applyAvailability(ent, u);
                } else if (u.render === "block") {
                    applyBlockGraphics(ent, u);
                } else {
                    applyBillboardGraphics(ent, u, api.viewer);
                }
            }
            api.viewer.scene.requestRender();
        },

        setBaseLayer(key: string) {
            if (!api) return;
            const entry = getByKey(key);
            if (!entry) {
                console.warn(`[GlobeAdapter] Imagery key not found: ${key}`);
                return;
            }
            const provider = entry.create();
            replaceBaseImageryLayer(api.viewer, provider);
        },

        setBaseLayerTemplate(url, opts) {
            if (!api) return;
            const provider = providerFromTemplate(url, opts);
            replaceBaseImageryLayer(api.viewer, provider);
        },

        async setTerrainKey(key: "world" | "flat") {
            if (!api) return;
            await api.setElevationEnabled(key === "world");
        },

        updateUnitPosition(id, lon, lat, alt = 0) {
            const ent = entities.get(id);
            if (!ent) return;

            const u = unitMeta.get(id);
            const wouldClamp = u?.clampToGround !== false && u?.alt == null && alt == null;
            if (wouldClamp) {
                setEntityPosition(ent, lon, lat, 0);
                return;
            }

            const treatAsAgl = u?.altIsAgl !== false;
            const baseAlt = alt ?? u?.alt ?? 0;
            const h = treatAsAgl ? scaledAlt(baseAlt) : baseAlt;
            setEntityPosition(ent, lon, lat, h);
        },

        setTime(epochMs: number) {
            if (!api) return;
            api.viewer.clock.currentTime = JulianDate.fromDate(new Date(epochMs));
            // First, drive weather
            wx?.onTimeChanged(epochMs);
            // Then, apply unit event logic (visibility + sidc + position)
            updateAllUnitsAtTime(epochMs);
        },

        setTimeBounds(startMs: number, stopMs: number) {
            if (!api) return;
            const clk = api.viewer.clock;
            clk.startTime = JulianDate.fromDate(new Date(startMs));
            clk.stopTime = JulianDate.fromDate(new Date(stopMs));

            if (clk.startTime && JulianDate.lessThan(clk.currentTime, clk.startTime)) {
                clk.currentTime = clk.startTime.clone();
            }
            if (clk.stopTime && JulianDate.greaterThan(clk.currentTime, clk.stopTime)) {
                clk.currentTime = clk.stopTime.clone();
            }

            api.viewer.scene.requestRender?.();
        },

        enableDayNight(enabled: boolean) {
            if (!api) return;
            api.viewer.scene.globe.enableLighting = enabled;
            if ("dynamicAtmosphereLighting" in api.viewer.scene.globe)
                (api.viewer.scene.globe as any).dynamicAtmosphereLighting = enabled;
            if ("dynamicAtmosphereLightingFromSun" in api.viewer.scene.globe)
                (api.viewer.scene.globe as any).dynamicAtmosphereLightingFromSun = enabled;
            api.viewer.scene.light = enabled ? new SunLight() : undefined;
            if (api.viewer.shadowMap) api.viewer.shadowMap.enabled = false;
            api.viewer.scene.requestRender?.();
        },

        enableSkybox(enabled: boolean) {
            if (!api) return;
            if (!api.viewer.scene.skyAtmosphere) api.viewer.scene.skyAtmosphere = new SkyAtmosphere();
            api.viewer.scene.skyAtmosphere.show = enabled;
            if (!api.viewer.scene.sun) api.viewer.scene.sun = new Sun();
            if (!api.viewer.scene.moon) api.viewer.scene.moon = new Moon();
            api.viewer.scene.sun.show = enabled;
            api.viewer.scene.moon.show = enabled;
            if (enabled) {
                api.viewer.scene.skyBox = new SkyBox({
                    sources: {
                        positiveX: Cesium.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_px.jpg"),
                        negativeX: Cesium.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_mx.jpg"),
                        positiveY: Cesium.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_py.jpg"),
                        negativeY: Cesium.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_my.jpg"),
                        positiveZ: Cesium.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_pz.jpg"),
                        negativeZ: Cesium.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_mz.jpg"),
                    },
                });
            } else if (api.viewer.scene.skyBox) {
                api.viewer.scene.skyBox.show = false;
            }
            api.viewer.scene.requestRender?.();
        },

        enableCloudOverlay(enabled: boolean, options?: GibsCloudOptions) {
            if (!api || !wx) return;
            wx.enableCloudOverlay(enabled, options);
        },

        /* overlays */
        addOverlayTemplate(id, url, opts) {
            if (!api) return;
            try {
                const existing = overlayLayers.get(id);
                if (existing) {
                    if (typeof opts?.alpha === "number") existing.alpha = opts.alpha;
                    existing.show = true;
                    api.viewer.scene.requestRender();
                    return;
                }

                const provider = providerFromTemplate(url, opts);
                const layer = api.viewer.imageryLayers.addImageryProvider(provider);
                if (typeof opts?.alpha === "number") layer.alpha = opts.alpha;
                layer.show = true;
                overlayLayers.set(id, layer);
                api.viewer.scene.requestRender();
            } catch (e) {
                console.error("[GlobeAdapter] addOverlayTemplate failed:", e);
            }
        },

        removeOverlay(id) {
            if (!api) return;
            const layer = overlayLayers.get(id);
            if (!layer) return;
            try {
                api.viewer.imageryLayers.remove(layer, true);
            } catch { }
            overlayLayers.delete(id);
            api.viewer.scene.requestRender();
        },

        setOverlayVisibility(id, show) {
            const layer = overlayLayers.get(id);
            if (!layer) return;
            layer.show = !!show;
            if (show) layer.alpha = Math.max(0.0, layer.alpha ?? 1.0);
            api!.viewer.scene.requestRender();
        },

        setOverlayAlpha(id, alpha) {
            const layer = overlayLayers.get(id);
            if (!layer) return;
            layer.alpha = Math.min(1, Math.max(0, alpha));
            api!.viewer.scene.requestRender();
        },

        listOverlays() {
            const out: { id: string; show: boolean; alpha: number }[] = [];
            overlayLayers.forEach((layer, id) => {
                out.push({ id, show: !!layer.show, alpha: layer.alpha ?? 1 });
            });
            return out;
        },

        /* filter */
        setUnitFilter(fn) {
            _unitFilter = (typeof fn === "function") ? fn : () => true;
            setUnitsInner(_lastUnitsInput);
        },
        refreshVisibility: reapplyVisibility,
    };
}

// ── Debug exports (viewer, maps, helpers) ─────────────────────────────
try {
    const prev = (window as any).MentatGlobeAdapterDebug ?? {};
    Object.assign(prev, {
        getCounts: () => ({
            entities: api!.viewer.entities.values.length,
            rawCount: (window as any).__mentatLastSetUnits?.rawCount ?? null,
            filteredCount: (window as any).__mentatLastSetUnits?.filteredCount ?? null,
            sample: (window as any).__mentatLastSetUnits?.sample ?? null,
        }),
        tick: (tMs: number) => updateAllUnitsAtTime(tMs),

        // NEW: expose internals so we can actually inspect units by id
        _unitMeta: unitMeta,
        _entities: entities,
        viewer: api!.viewer,
    });
    (window as any).MentatGlobeAdapterDebug = prev;
} catch { }

// OPTIONAL: a one-liner inspector you can call from the console
try {
    (window as any).MentatDebugSIDC = (id?: string) => {
        const dbg = (window as any).MentatGlobeAdapterDebug;
        const viewer = dbg?.viewer;
        const t = viewer ? Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime() : Date.now();
        const ent = id ? viewer?.entities?.getById(id) : viewer?.entities?.values?.[0];
        const u = ent ? dbg?._unitMeta?.get(ent.id) : null;
        const src = u?.__sourceUnit ?? u ?? null;
        const sidcFromEvents = src ? (window as any).lastSidcAtOrBefore?.(src, t) : undefined;
        const sidcFromUnit = src?.sidc ?? u?.sidc;
        return { id: ent?.id, t, sidcFromEvents, sidcFromUnit, u, src };
    };
} catch { }

try {
    (window as any).buildIconUrlSync = (u: any) => buildIconUrlSync(u, (window as any).MentatGlobe?.viewer);
} catch { }
