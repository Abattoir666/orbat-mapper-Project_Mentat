import VectorSource from "ol/source/Vector";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import { fromLonLat } from "ol/proj";
import Style from "ol/style/Style";
import Icon from "ol/style/Icon";
import type OLMap from "ol/Map";

import type { ScenarioFIRMSLayer, FirmsTimeMode } from "@/types/scenarioGeoModels";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
const assetUrl = (p: string) => BASE + p.replace(/^\/+/, "");

// User-provided symbol (exact)
const FIRE_ICON_DATA_URI =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDE2IDE2Ij48cGF0aCBmaWxsPSIjZmQyMjIyIiBkPSJNOCAxNmMzLjMxNCAwIDYtMiA2LTUuNWMwLTEuNS0uNS00LTIuNS02Yy4yNSAxLjUtMS4yNSAyLTEuMjUgMkMxMSA0IDkgLjUgNiAwYy4zNTcgMiAuNSA0LTIgNmMtMS4yNSAxLTIgMi43MjktMiA0LjVDMiAxNCA0LjY4NiAxNiA4IDE2bTAtMWMtMS42NTcgMC0zLTEtMy0yLjc1YzAtLjc1LjI1LTIgMS4yNS0zQzYuMTI1IDEwIDcgMTAuNSA3IDEwLjVjLS4zNzUtMS4yNS41LTMuMjUgMi0zLjVjLS4xNzkgMS0uMjUgMiAxIDNjLjYyNS41IDEgMS4zNjQgMSAyLjI1QzExIDE0IDkuNjU3IDE1IDggMTUiIHN0cm9rZS13aWR0aD0iMS4xIiBzdHJva2U9IiNlYWE4MWQiLz48L3N2Zz4=";

type FirmsStatus = "uninitialized" | "loading" | "initialized" | "error";

type FirmsRecord = {
    lat: number;
    lon: number;
    t: number; // ms UTC
    confidence?: string;
    frp?: number;
    bright?: number;
};

type FirmsCacheSettings = {
    cacheEnabled?: boolean; // default true
    cacheBackDays?: number; // default 0
    cacheForwardDays?: number; // default 0
    maxCachedDays?: number; // default 60
};

type FirmsFilterSettings = {
    confidenceMode?: "off" | "dropLowOrLt50" | "numeric";
    minConfidence?: number;
    enableFrpFilter?: boolean;
    minFrpMw?: number;

    suppressPersistentHotspots?: boolean;
    persistenceDays?: number;
    persistenceCellDeg?: number;
    persistenceMinDetections?: number;
};

type Poly = {
    // Each polygon contains rings; ring[0] is outer; ring[1+] are holes.
    rings: [number, number][][];
};

function firmsDebugEnabled(): boolean {
    try {
        return localStorage.getItem("orbat.firms.debug") === "1";
    } catch {
        return false;
    }
}

function dlog(...args: any[]) {
    if (firmsDebugEnabled()) {
        // eslint-disable-next-line no-console
        console.debug("[FIRMS]", ...args);
    }
}

function clamp(n: number, lo: number, hi: number) {
    return Math.min(hi, Math.max(lo, n));
}

function normalizeBaseUrl(u: string) {
    const s = (u ?? "").trim();
    return s.endsWith("/") ? s.slice(0, -1) : s;
}

function pad4(s: string) {
    const t = (s ?? "").trim();
    return t.length >= 4 ? t : t.padStart(4, "0");
}

function dateToYMDUTC(ms: number) {
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function startOfUTCHour(ms: number) {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), 0, 0, 0);
}

function startOfUTCDay(ms: number) {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
}

function enumerateDaysUTC(startMs: number, endMs: number): string[] {
    const out: string[] = [];
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return out;

    let cur = startOfUTCDay(startMs);
    const endDay = startOfUTCDay(endMs - 1); // prevents extra day when endMs is exactly midnight
    while (cur <= endDay) {
        out.push(dateToYMDUTC(cur));
        cur += 24 * 3600_000;
    }
    return out;
}

function computeWindow(
    t: number,
    mode: FirmsTimeMode,
    backHours: number,
    forwardHours: number,
): { start: number; end: number; key: string } {
    if (mode === "hour") {
        const start = startOfUTCHour(t);
        const end = start + 3600_000;
        return { start, end, key: `hour:${start}` };
    }
    if (mode === "day") {
        const start = startOfUTCDay(t);
        const end = start + 24 * 3600_000;
        return { start, end, key: `day:${start}` };
    }
    const start = t - backHours * 3600_000;
    const end = t + forwardHours * 3600_000;
    return { start, end, key: `win:${start}-${end}` };
}

function readCacheSettings(layer: ScenarioFIRMSLayer): Required<FirmsCacheSettings> {
    const anyLayer = layer as any as FirmsCacheSettings;

    const cacheEnabled = anyLayer.cacheEnabled !== false; // default true
    const cacheBackDays = clamp(Number(anyLayer.cacheBackDays ?? 0), 0, 365);
    const cacheForwardDays = clamp(Number(anyLayer.cacheForwardDays ?? 0), 0, 365);
    const maxCachedDays = Math.max(1, Math.floor(clamp(Number(anyLayer.maxCachedDays ?? 60), 1, 3650)));

    return { cacheEnabled, cacheBackDays, cacheForwardDays, maxCachedDays };
}

function readFilterSettings(layer: ScenarioFIRMSLayer): Required<FirmsFilterSettings> {
    const a = layer as any as FirmsFilterSettings;

    const confidenceMode = (a.confidenceMode ?? "dropLowOrLt50") as Required<FirmsFilterSettings>["confidenceMode"];
    const minConfidence = clamp(Number(a.minConfidence ?? 50), 0, 100);

    const enableFrpFilter = a.enableFrpFilter !== false; // default true
    const minFrpMw = Math.max(0, Number(a.minFrpMw ?? 2));

    const suppressPersistentHotspots = a.suppressPersistentHotspots !== false; // default true
    const persistenceDays = Math.max(1, Math.floor(clamp(Number(a.persistenceDays ?? 30), 1, 3650)));
    const persistenceCellDeg = Math.max(0.001, Number(a.persistenceCellDeg ?? 0.02));
    const persistenceMinDetections = Math.max(1, Math.floor(clamp(Number(a.persistenceMinDetections ?? 40), 1, 1_000_000)));

    return {
        confidenceMode,
        minConfidence,
        enableFrpFilter,
        minFrpMw,
        suppressPersistentHotspots,
        persistenceDays,
        persistenceCellDeg,
        persistenceMinDetections,
    };
}

function confidencePasses(conf: string | undefined, mode: string, minNumeric: number): boolean {
    if (!mode || mode === "off") return true;

    const c = (conf ?? "").trim().toLowerCase();
    if (!c) return true; // unknown => do not discard

    // categorical
    if (c === "low") return mode !== "dropLowOrLt50" ? true : false;
    if (c === "nominal" || c === "normal" || c === "medium") return true;
    if (c === "high") return true;

    // numeric
    const n = Number(c);
    if (!Number.isFinite(n)) return true;

    if (mode === "dropLowOrLt50") return n >= 50;
    if (mode === "numeric") return n >= minNumeric;
    return true;
}

function frpPasses(frp: number | undefined, enabled: boolean, minFrpMw: number): boolean {
    if (!enabled) return true;
    if (!Number.isFinite(minFrpMw) || minFrpMw <= 0) return true;
    if (frp == null || !Number.isFinite(frp)) return true; // if dataset omits FRP, don't discard
    return frp >= minFrpMw;
}

function parseFirmsCsv(csvText: string): FirmsRecord[] {
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) return [];

    const headerRaw = lines[0].split(",").map((h) => h.trim());
    const header = headerRaw.map((h) => h.toLowerCase());
    const idx = (name: string) => header.indexOf(name.toLowerCase());

    const iLat = idx("latitude");
    const iLon = idx("longitude");
    const iDate = idx("acq_date");
    const iTime = idx("acq_time");
    const iConf = idx("confidence");
    const iFrp = idx("frp");
    const iBright = header.indexOf("bright_ti4") !== -1 ? header.indexOf("bright_ti4") : idx("brightness");

    if (iLat === -1 || iLon === -1 || iDate === -1 || iTime === -1) return [];

    const out: FirmsRecord[] = [];
    for (let li = 1; li < lines.length; li++) {
        const row = lines[li].split(",");
        const lat = Number(row[iLat]);
        const lon = Number(row[iLon]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        const acqDate = (row[iDate] ?? "").trim(); // YYYY-MM-DD
        const acqTime = pad4(row[iTime] ?? "0000"); // HHMM
        const hh = Number(acqTime.slice(0, 2));
        const mm = Number(acqTime.slice(2, 4));

        const y = Number(acqDate.slice(0, 4));
        const m = Number(acqDate.slice(5, 7));
        const d = Number(acqDate.slice(8, 10));
        if (!y || !m || !d || !Number.isFinite(hh) || !Number.isFinite(mm)) continue;

        const t = Date.UTC(y, m - 1, d, hh, mm, 0, 0);

        const confidence = iConf !== -1 ? (row[iConf] ?? "").trim() : undefined;

        const frpRaw = iFrp !== -1 ? Number(row[iFrp]) : undefined;
        const frp = Number.isFinite(frpRaw as number) ? (frpRaw as number) : undefined;

        const brightRaw = iBright !== -1 ? Number(row[iBright]) : undefined;
        const bright = Number.isFinite(brightRaw as number) ? (brightRaw as number) : undefined;

        out.push({ lat, lon, t, confidence, frp, bright });
    }

    return out;
}

// -------------------------
// Country polygon utilities
// -------------------------

function walkCoords(coords: any, cb: (lon: number, lat: number) => void) {
    if (!coords) return;

    // point [lon,lat]
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
        cb(coords[0], coords[1]);
        return;
    }

    for (const c of coords) walkCoords(c, cb);
}

function extractPolysFromGeoJSON(geojson: any): Poly[] {
    const polys: Poly[] = [];

    const handleGeom = (geom: any) => {
        if (!geom) return;

        if (geom.type === "GeometryCollection") {
            for (const g of geom.geometries ?? []) handleGeom(g);
            return;
        }

        if (geom.type === "Polygon") {
            const rings: [number, number][][] = [];
            for (const ring of geom.coordinates ?? []) {
                const r: [number, number][] = [];
                walkCoords(ring, (lon, lat) => r.push([lon, lat]));
                if (r.length >= 3) rings.push(r);
            }
            if (rings.length) polys.push({ rings });
            return;
        }

        if (geom.type === "MultiPolygon") {
            for (const poly of geom.coordinates ?? []) {
                const rings: [number, number][][] = [];
                for (const ring of poly ?? []) {
                    const r: [number, number][] = [];
                    walkCoords(ring, (lon, lat) => r.push([lon, lat]));
                    if (r.length >= 3) rings.push(r);
                }
                if (rings.length) polys.push({ rings });
            }
            return;
        }
    };

    if (geojson?.type === "FeatureCollection") {
        for (const f of geojson.features ?? []) handleGeom(f.geometry);
    } else if (geojson?.type === "Feature") {
        handleGeom(geojson.geometry);
    } else {
        handleGeom(geojson);
    }

    return polys;
}

// Ray casting for ring; returns true if point in ring (ignores holes)
function pointInRing(lon: number, lat: number, ring: [number, number][]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];

        const intersect =
            yi > lat !== yj > lat &&
            lon < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
        if (intersect) inside = !inside;
    }
    return inside;
}

// Polygon with holes: inside outer AND not inside any hole
function pointInPolygon(lon: number, lat: number, poly: Poly): boolean {
    const [outer, ...holes] = poly.rings;
    if (!outer || outer.length < 3) return false;
    if (!pointInRing(lon, lat, outer)) return false;
    for (const h of holes) {
        if (h && h.length >= 3 && pointInRing(lon, lat, h)) return false;
    }
    return true;
}

function cellKey(lon: number, lat: number, cellDeg: number): string {
    const x = Math.floor((lon + 180) / cellDeg);
    const y = Math.floor((lat + 90) / cellDeg);
    return `${x},${y}`;
}

// -------------------------
// Controller
// -------------------------

export class FirmsLayerController {
    private readonly olMap: OLMap;
    private readonly source: VectorSource;
    private layer: ScenarioFIRMSLayer;

    private status: FirmsStatus = "uninitialized";
    private onStatus?: (s: FirmsStatus) => void;

    private cachedByDay = new Map<string, FirmsRecord[]>();
    private lruDays: string[] = [];
    private maxCachedDays = 60;

    private currentTime: number = Number.NaN;
    private lastWindowKey: string | null = null;
    private lastConfigKey: string | null = null;

    private requestSeq = 0;
    private abort?: AbortController;

    // country polygon caching
    private countryAbort?: AbortController;
    private countryPolyCache = new Map<string, Poly[]>();

    // style caching by radius
    private fireStyleCache = new Map<number, Style>();

    constructor(args: {
        olMap: OLMap;
        vectorSource: VectorSource;
        layer: ScenarioFIRMSLayer;
        onStatus?: (s: FirmsStatus) => void;
    }) {
        this.olMap = args.olMap;
        this.source = args.vectorSource;
        this.layer = args.layer;
        this.onStatus = args.onStatus;
    }

    dispose() {
        try {
            this.abort?.abort();
        } catch {
            // ignore
        }
        try {
            this.countryAbort?.abort();
        } catch {
            // ignore
        }

        this.abort = undefined;
        this.countryAbort = undefined;

        this.cachedByDay.clear();
        this.lruDays = [];
        this.countryPolyCache.clear();
        this.fireStyleCache.clear();

        this.source.clear(true);
    }

    updateLayer(next: ScenarioFIRMSLayer) {
        const prevKey = this.configKey(this.layer);
        const nextKey = this.configKey(next);
        this.layer = next;

        if (prevKey !== nextKey) {
            this.cachedByDay.clear();
            this.lruDays = [];
            this.countryPolyCache.clear();
            this.lastWindowKey = null;
            this.lastConfigKey = null;
            this.source.clear(true);
        }

        if (Number.isFinite(this.currentTime)) {
            void this.refresh(this.currentTime);
        }
    }

    async refresh(t: number) {
        this.currentTime = t;

        // Required config check
        if (!this.layer.mapKey?.trim() || !this.layer.source?.trim() || !this.layer.area?.trim() || !this.layer.url?.trim()) {
            this.setStatus("uninitialized");
            this.source.clear(true);
            return;
        }

        const mode = (this.layer.timeMode ?? "hour") as FirmsTimeMode;
        const backHours = this.layer.windowBackHours ?? 24;
        const forwardHours = this.layer.windowForwardHours ?? 0;

        const win = computeWindow(t, mode, backHours, forwardHours);
        if (win.key === this.lastWindowKey && this.lastConfigKey === this.configKey(this.layer)) return;

        this.lastWindowKey = win.key;
        this.lastConfigKey = this.configKey(this.layer);

        const cache = readCacheSettings(this.layer);
        this.maxCachedDays = cache.maxCachedDays;

        const filters = readFilterSettings(this.layer);

        const dayMs = 24 * 3600_000;
        const daysInActiveWindow = enumerateDaysUTC(win.start, win.end);

        // Prefetch range (for smooth scrubbing)
        const prefetchStart = cache.cacheEnabled
            ? startOfUTCDay(win.start) - cache.cacheBackDays * dayMs
            : win.start;
        const prefetchEnd = cache.cacheEnabled
            ? startOfUTCDay(win.end - 1) + (cache.cacheForwardDays + 1) * dayMs
            : win.end;

        const prefetchDays = enumerateDaysUTC(prefetchStart, prefetchEnd);

        dlog("refresh", {
            time: new Date(t).toISOString(),
            window: { start: new Date(win.start).toISOString(), end: new Date(win.end).toISOString() },
            days: daysInActiveWindow,
            prefetch: prefetchDays.length,
            source: this.layer.source,
            area: this.layer.area,
            timeMode: this.layer.timeMode ?? "hour",
            cache,
            filters: {
                confidenceMode: filters.confidenceMode,
                minConfidence: filters.minConfidence,
                enableFrpFilter: filters.enableFrpFilter,
                minFrpMw: filters.minFrpMw,
                suppressPersistentHotspots: filters.suppressPersistentHotspots,
            },
        });

        this.setStatus("loading");

        const seq = ++this.requestSeq;
        try {
            this.abort?.abort();
            this.abort = new AbortController();

            // If caching is disabled, keep only days in active window.
            if (!cache.cacheEnabled) {
                const keep = new Set(daysInActiveWindow);
                for (const k of [...this.cachedByDay.keys()]) {
                    if (!keep.has(k)) this.cachedByDay.delete(k);
                }
                this.lruDays = this.lruDays.filter((k) => keep.has(k));
            }

            // Ensure prefetch days are loaded (but only as needed)
            for (const day of prefetchDays) {
                if (seq !== this.requestSeq) return;

                const cached = this.cachedByDay.get(day);
                if (cached) {
                    this.touchDay(day);
                    continue;
                }

                const records = await this.fetchDay(day, this.abort.signal);
                if (seq !== this.requestSeq) return;

                this.putCache(day, records);
                dlog("parsed", { day, records: records.length });
            }

            // Optional: load country polygons ONLY when in countries mode + clip enabled
            const areaMode = (this.layer as any).areaMode as string | undefined;
            const clipToCountries = !!(this.layer as any).clipToCountries;
            const countryFiles: string[] = Array.isArray((this.layer as any).countryFiles) ? (this.layer as any).countryFiles : [];

            let polys: Poly[] | null = null;
            if (areaMode === "countries" && clipToCountries && countryFiles.length > 0) {
                polys = await this.loadSelectedCountryPolys(countryFiles);
            }

            // Persistent hotspot suppression: build persistent cell set from cached history (best-effort)
            let persistentCells: Set<string> | null = null;
            if (filters.suppressPersistentHotspots) {
                const histStart = startOfUTCDay(win.start) - filters.persistenceDays * dayMs;
                const histEnd = startOfUTCDay(win.start); // strictly before current day
                const histDays = enumerateDaysUTC(histStart, histEnd);

                const counts = new Map<string, number>();
                for (const day of histDays) {
                    const recs = this.cachedByDay.get(day);
                    if (!recs) continue;
                    for (const r of recs) {
                        const k = cellKey(r.lon, r.lat, filters.persistenceCellDeg);
                        counts.set(k, (counts.get(k) ?? 0) + 1);
                    }
                }

                persistentCells = new Set<string>();
                for (const [k, c] of counts) {
                    if (c >= filters.persistenceMinDetections) persistentCells.add(k);
                }

                dlog("persistent", {
                    histDays: histDays.length,
                    availableDays: histDays.filter((d) => this.cachedByDay.has(d)).length,
                    cellDeg: filters.persistenceCellDeg,
                    min: filters.persistenceMinDetections,
                    cells: persistentCells.size,
                });
            }

            // Render: time-sensitive, non-cumulative window
            const max = Math.max(1, Math.floor(this.layer.maxDetections ?? 50000));
            const pointRadius = Math.max(1, Number(this.layer.pointRadius ?? 4));
            const proj = this.olMap.getView().getProjection();

            const features: Feature<Point>[] = [];
            let scanned = 0;

            for (const day of daysInActiveWindow) {
                const recs = this.cachedByDay.get(day) ?? [];
                for (const r of recs) {
                    scanned++;
                    if (r.t < win.start || r.t >= win.end) continue;

                    // Countries clipping: precise, but can be slow (only enabled in countries mode)
                    if (polys && polys.length > 0) {
                        let insideAny = false;
                        for (const p of polys) {
                            if (pointInPolygon(r.lon, r.lat, p)) {
                                insideAny = true;
                                break;
                            }
                        }
                        if (!insideAny) continue;
                    }

                    // Persistent hotspot suppression
                    if (persistentCells) {
                        const k = cellKey(r.lon, r.lat, filters.persistenceCellDeg);
                        if (persistentCells.has(k)) continue;
                    }

                    // Confidence + FRP filters
                    if (!confidencePasses(r.confidence, filters.confidenceMode, filters.minConfidence)) continue;
                    if (!frpPasses(r.frp, filters.enableFrpFilter, filters.minFrpMw)) continue;

                    const f = new Feature<Point>({
                        geometry: new Point(fromLonLat([r.lon, r.lat], proj)),
                    });

                    f.setProperties({
                        t: r.t,
                        confidence: r.confidence,
                        frp: r.frp,
                        bright: r.bright,
                    });

                    // Flame icon
                    f.setStyle(this.getFireStyle(pointRadius));

                    features.push(f);
                    if (features.length >= max) break;
                }
                if (features.length >= max) break;
            }

            dlog("render", { features: features.length, max, scanned });

            this.source.clear(true);
            this.source.addFeatures(features);

            this.olMap.render();
            this.setStatus("initialized");
        } catch (e) {
            const msg = String(e ?? "");
            if (!msg.toLowerCase().includes("abort")) {
                this.setStatus("error");
                dlog("error", e);
            }
        }
    }

    private configKey(l: ScenarioFIRMSLayer) {
        const a = l as any;

        // Include filter + persistence + clip settings so switching toggles triggers correct refresh
        return [
            normalizeBaseUrl(l.url),
            (l.mapKey ?? "").trim(),
            (l.source ?? "").trim(),
            (l.area ?? "").trim(),
            String(a.areaMode ?? ""),
            String(a.clipToCountries ?? ""),
            JSON.stringify(a.countryFiles ?? []),

            String(a.cacheEnabled ?? ""),
            String(a.cacheBackDays ?? ""),
            String(a.cacheForwardDays ?? ""),
            String(a.maxCachedDays ?? ""),

            String(a.confidenceMode ?? ""),
            String(a.minConfidence ?? ""),
            String(a.enableFrpFilter ?? ""),
            String(a.minFrpMw ?? ""),

            String(a.suppressPersistentHotspots ?? ""),
            String(a.persistenceDays ?? ""),
            String(a.persistenceCellDeg ?? ""),
            String(a.persistenceMinDetections ?? ""),
        ].join("|");
    }

    private setStatus(s: FirmsStatus) {
        if (this.status === s) return;
        this.status = s;
        this.onStatus?.(s);
    }

    private getFireStyle(pointRadius: number): Style {
        // A simple, stable mapping: 8px baseline radius => scale 1
        const scale = Math.max(0.25, pointRadius / 8);

        const cached = this.fireStyleCache.get(pointRadius);
        if (cached) return cached;

        const style = new Style({
            image: new Icon({
                src: FIRE_ICON_DATA_URI,
                scale,
                anchor: [0.5, 0.5],
                anchorXUnits: "fraction",
                anchorYUnits: "fraction",
            }),
        });

        this.fireStyleCache.set(pointRadius, style);
        return style;
    }

    private touchDay(day: string) {
        const i = this.lruDays.indexOf(day);
        if (i !== -1) this.lruDays.splice(i, 1);
        this.lruDays.push(day);
    }

    private putCache(day: string, recs: FirmsRecord[]) {
        this.cachedByDay.set(day, recs);
        this.touchDay(day);

        while (this.lruDays.length > this.maxCachedDays) {
            const evict = this.lruDays.shift();
            if (!evict) break;
            this.cachedByDay.delete(evict);
        }
    }

    private async fetchDay(day: string, signal: AbortSignal): Promise<FirmsRecord[]> {
        const base = normalizeBaseUrl(this.layer.url);

        // FIRMS area CSV endpoint:
        // {base}/{MAP_KEY}/{source}/{area}/{day_range}/{date}
        const url =
            `${base}/${encodeURIComponent(this.layer.mapKey)}` +
            `/${encodeURIComponent(this.layer.source)}` +
            `/${encodeURIComponent(this.layer.area)}` +
            `/1/${encodeURIComponent(day)}`;

        dlog("GET", url);

        const resp = await fetch(url, { method: "GET", signal });
        if (!resp.ok) throw new Error(`FIRMS fetch failed (${resp.status})`);

        const text = await resp.text();

        // Quick sanity check: FIRMS CSV headers
        const firstLine = (text.split(/\r?\n/, 1)[0] ?? "").toLowerCase();
        const looksLikeCsv =
            firstLine.includes("latitude") &&
            firstLine.includes("longitude") &&
            firstLine.includes("acq_date") &&
            firstLine.includes("acq_time");

        if (!looksLikeCsv) {
            const snippet = text.slice(0, 240).replace(/\s+/g, " ").trim();
            throw new Error(`FIRMS response did not look like CSV. Head: ${snippet}`);
        }

        return parseFirmsCsv(text);
    }

    private async loadSelectedCountryPolys(files: string[]): Promise<Poly[]> {
        const unique = [...new Set(files)].filter((f) => (f ?? "").toLowerCase().endsWith(".json"));
        if (unique.length === 0) return [];

        this.countryAbort?.abort();
        this.countryAbort = new AbortController();
        const signal = this.countryAbort.signal;

        const out: Poly[] = [];

        for (const fileRaw of unique) {
            if (signal.aborted) break;

            const file = String(fileRaw || "").trim();
            if (!file) continue;

            const cached = this.countryPolyCache.get(file);
            if (cached) {
                out.push(...cached);
                continue;
            }

            // Support either "countrybordersjsons/xxx.json" or bare "xxx.json"
            const rel = file.includes("/") ? file : `countrybordersjsons/${file}`;
            const url = assetUrl(rel);

            const resp = await fetch(url, { method: "GET", signal });
            if (!resp.ok) throw new Error(`Country border fetch failed (${resp.status}) for ${url}`);

            const raw = await resp.text();
            const cleaned = raw.replace(/^\uFEFF/, "");
            const gj = JSON.parse(cleaned);

            const polys = extractPolysFromGeoJSON(gj);
            this.countryPolyCache.set(file, polys);
            out.push(...polys);
        }

        return out;
    }
}
