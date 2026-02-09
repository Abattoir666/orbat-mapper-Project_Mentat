/* eslint-disable @typescript-eslint/no-explicit-any */
import {
    CustomDataSource,
    Cartesian3,
    Cartographic,
    Color,
    CylinderGraphics,
    EllipseGraphics,
    ImageMaterialProperty,
    DistanceDisplayCondition,
    HeightReference,
    sampleTerrainMostDetailed,
    CallbackProperty,
} from "cesium";

import { resolveEventIcon } from "@/modules/scenarioeditor/ExtendedScenarioEvents/eventIconRegistry";
import { getUnitPositionAtTime } from "@/scenariostore/time";


type BBox = { minLon: number; minLat: number; maxLon: number; maxLat: number };

export type ScenarioEventMarkers3D = {
    setVisible: (v: boolean) => void;
    sync: (events: any[], helpers: any) => void;
    destroy: () => void;
};

function isEventVisibleAtScenarioTime(ev: any, now: number): boolean {
    const start = Number(ev?.startTime);
    const end = Number((ev as any)?.endTime);

    // If startTime isn't set/valid, don't time-gate it (keeps legacy/edge events visible)
    if (!Number.isFinite(start)) return true;

    // Not started yet
    if (now < start) return false;

    // Ended (only if endTime is set and valid)
    if (Number.isFinite(end) && now > end) return false;

    return true;
}

export function createScenarioEventMarkers3D(viewer: any): ScenarioEventMarkers3D {
    const ds = new CustomDataSource("mentat-events-3d");
    viewer.dataSources.add(ds);

    // Cache terrain height per eventId at its last (lon/lat)
    const groundCache = new Map<string, { lon: number; lat: number; ground: number }>();

    let visible = true;

    function setVisible(v: boolean) {
        visible = !!v;
        ds.show = visible;
        viewer.scene?.requestRender?.();
    }

    function destroy() {
        try {
            viewer.dataSources.remove(ds, true);
        } catch {
            /* ignore */
        }
        groundCache.clear();
    }


    function sync(events: any[], helpers: any) {
        let total = 0;
        let made = 0;
        let noCenter = 0;


        if (!visible) return;
        const now = scenarioNow(helpers);
        const keep = new Set<string>();

        for (const ev of events ?? []) {
            if (!ev?.id) continue;
            const eventId = String(ev.id);
            if (!isEventVisibleAtScenarioTime(ev, now)) {
                continue;
            }
            keep.add(eventId);

            // MUST come before any use of `center`
            const center = computeEventCenter(ev, helpers, now);
            if (!center) continue;

            // Use stable locals (also safer for async callbacks)
            const lon = center.lon;
            const lat = center.lat;

            const markerHeight = markerHeightMeters(ev);
            const markerRadius = markerRadiusMeters(ev);

            const cached = groundCache.get(eventId);
            const needsResample =
                !cached ||
                Math.abs(cached.lon - lon) > 1e-6 ||
                Math.abs(cached.lat - lat) > 1e-6;

            if (needsResample) {
                groundCache.set(eventId, { lon, lat, ground: 0 });

                void sampleGroundHeight(viewer, lon, lat).then((h) => {
                    if (typeof h === "number" && Number.isFinite(h)) {
                        const cur = groundCache.get(eventId);
                        if (
                            cur &&
                            Math.abs(cur.lon - lon) < 1e-6 &&
                            Math.abs(cur.lat - lat) < 1e-6
                        ) {
                            cur.ground = h;
                            groundCache.set(eventId, cur);
                            applyPositions(eventId, lon, lat);
                            viewer.scene?.requestRender?.();
                        }
                    }
                });
            }

            const ground = groundCache.get(eventId)?.ground ?? 0;
            const cylId = `ev3d:${eventId}:cyl`;
            const capId = `ev3d:${eventId}:cap`;

            // Cylinder entity (post)
            let cyl = ds.entities.getById(cylId);
            if (!cyl) cyl = ds.entities.add({ id: cylId });

            cyl.cylinder =
                cyl.cylinder ??
                (new CylinderGraphics({
                    length: markerHeight,
                    topRadius: markerRadius,
                    bottomRadius: markerRadius,
                }) as any);

            const c = colorForEvent(ev, helpers);
            (cyl.cylinder as any).material = c.fill;
            (cyl.cylinder as any).outline = true;
            (cyl.cylinder as any).outlineColor = c.outline;
            (cyl.cylinder as any).numberOfVerticalLines = 0;

            // Cap decal (ellipse stamped onto top cap)
            let cap = ds.entities.getById(capId);
            if (!cap) cap = ds.entities.add({ id: capId });

            const iconUrl = resolveEventIcon((ev?.category as string) || "generic");

            // Slightly inset from the cylinder radius so it doesn't bleed over the edge
            const decalRadius = Math.max(1, markerRadius * 0.92);

            cap.ellipse =
                cap.ellipse ??
                (new EllipseGraphics({
                    semiMajorAxis: decalRadius,
                    semiMinorAxis: decalRadius,

                    // DEBUG: make it unquestionably visible first
                    material: Color.YELLOW.withAlpha(0.85),
                    outline: true,
                    outlineColor: Color.WHITE.withAlpha(0.75),

                    heightReference: HeightReference.NONE,

                    // Don’t disappear just because you’re zoomed out
                    distanceDisplayCondition: new DistanceDisplayCondition(0.0, 50_000_000.0),
                }) as any);

            const prevIcon = (cap.properties as any)?.iconUrl?.getValue?.() ?? (cap.properties as any)?.iconUrl;
            if (prevIcon !== iconUrl) {
                cap.properties = cap.properties ?? ({} as any);
                (cap.properties as any).iconUrl = iconUrl;

                (cap.ellipse as any).material = new ImageMaterialProperty({
                    image: iconUrl,
                    transparent: true,
                    color: Color.WHITE,
                });
            }

            // Apply positions using cached ground height
            applyPositions(eventId, lon, lat, markerHeight);
            made++;
        }

        // Remove stale entities for events that no longer exist
        const toRemove: string[] = [];
        for (const e of ds.entities.values) {
            const id = String((e as any).id ?? "");
            const m = id.match(/^ev3d:([^:]+):/);
            if (!m) continue;
            const eventId = m[1];
            if (!keep.has(eventId)) toRemove.push(id);
        }

        for (const id of toRemove) {
            try {
                ds.entities.removeById(id);
            } catch {
                /* ignore */
            }
            const m = id.match(/^ev3d:([^:]+):/);
            if (m) groundCache.delete(m[1]);
        }
        if ((window as any).__DBG_EV3D) {
            console.log("[EV3D] sync", { total, made, noCenter, entities: ds.entities.values.length });
        }
        viewer.scene?.requestRender?.();
    }

    function applyPositions(eventId: string, lon: number, lat: number, maxHeight: number) {
        const cyl = ds.entities.getById(`ev3d:${eventId}:cyl`);
        const cap = ds.entities.getById(`ev3d:${eventId}:cap`);
        if (!cyl || !cap) return;

        const cylG = cyl.cylinder as any;
        if (!cylG) return;

        // Max pillar height (your existing logic, keep it simple/robust)
        maxHeight = Math.max(PILLAR_MIN_METERS, Number(maxHeight) || PILLAR_MIN_METERS);

        // Stable base point for distance checks (ground-free)
        const baseCartesian = Cartesian3.fromDegrees(lon, lat, 0);
        const carto = Cartographic.fromDegrees(lon, lat);

        const computeHeight = () => {
            try {
                const cam = viewer?.camera?.positionWC;
                if (!cam) return maxHeight;
                const d = Cartesian3.distance(cam, baseCartesian);
                return pillarHeightForDistance(maxHeight, d);
            } catch {
                return maxHeight;
            }
        };

        const computeGround = () => {
            // Prefer live globe height (tracks LOD changes); fallback to cached sample.
            try {
                const h0 = viewer?.scene?.globe?.getHeight?.(carto);
                if (typeof h0 === "number" && Number.isFinite(h0)) {
                    const cached = groundCache.get(eventId)?.ground;
                    // If cached already matches, don't “double-exaggerate”.
                    if (typeof cached === "number" && Number.isFinite(cached) && Math.abs(cached - h0) < 0.5) {
                        return h0;
                    }
                    return exaggerateHeightMeters(viewer?.scene, h0);
                }
            } catch {
                /* ignore */
            }

            const g = groundCache.get(eventId)?.ground;
            return (typeof g === "number" && Number.isFinite(g)) ? g : 0;
        };

        // Dynamic cylinder height (shrinks as you get close)
        cylG.length = new CallbackProperty(() => computeHeight(), false);

        // Cylinder position is its CENTER: ground + clearance + h/2
        cyl.position = new CallbackProperty(() => {
            const h = computeHeight();
            const g = computeGround() + GROUND_CLEARANCE_METERS;
            return Cartesian3.fromDegrees(lon, lat, g + h * 0.5);
        }, false);

        // Keep the entity positioned at lon/lat; actual altitude is controlled by ellipse.height
        cap.position = Cartesian3.fromDegrees(lon, lat, 0);

        // Make the cap a thin "coin" at the top to avoid z-fighting with the cylinder top face
        const CAP_THICKNESS_METERS = 1.0;

        (cap.ellipse as any).height = new CallbackProperty(() => {
            const h = computeHeight();
            const g = computeGround() + GROUND_CLEARANCE_METERS;
            return g + h + 0.5; // slight lift
        }, false);

        (cap.ellipse as any).extrudedHeight = new CallbackProperty(() => {
            const h = computeHeight();
            const g = computeGround() + GROUND_CLEARANCE_METERS;
            return g + h + 0.5 - CAP_THICKNESS_METERS;
        }, false);
    }

    /* ───────────────────────── helpers ───────────────────────── */

    function markerHeightMeters(ev: any): number {
        const base = 4000;
        return clamp(Number(ev?.markerHeightM ?? base) || base, 750, 25_000);
    }

    function markerRadiusMeters(ev: any): number {
        const base = 250;
        return clamp(Number(ev?.markerRadiusM ?? base) || base, 50, 2500);
    }

    function clamp(v: number, lo: number, hi: number) {
        return Math.max(lo, Math.min(hi, v));
    }

    function exaggerateHeightMeters(scene: any, h: number): number {
        const ex = Number(scene?.verticalExaggeration ?? 1);
        const rel = Number(scene?.verticalExaggerationRelativeHeight ?? 0);

        if (!Number.isFinite(h)) return h;
        if (!Number.isFinite(ex) || ex === 1) return h;

        if (!Number.isFinite(rel)) return h * ex;
        return rel + (h - rel) * ex;
    }


    async function sampleGroundHeight(viewer: any, lon: number, lat: number): Promise<number | undefined> {
        // Fast path: currently loaded tiles
        try {
            const carto = Cartographic.fromDegrees(lon, lat);
            const h0 = viewer.scene?.globe?.getHeight?.(carto);
            if (typeof h0 === "number" && Number.isFinite(h0)) {
                return exaggerateHeightMeters(viewer.scene, h0);
            }
        } catch {
            /* ignore */
        }

        // Reliable: terrain sampling (world terrain / bathy terrain / etc.)
        try {
            const provider = (viewer.terrain as any)?.provider ?? viewer.terrainProvider;
            if (!provider) return undefined;

            const carto = Cartographic.fromDegrees(lon, lat);
            const res = await sampleTerrainMostDetailed(provider, [carto]);
            const h = res?.[0]?.height;

            if (typeof h === "number" && Number.isFinite(h)) {
                return exaggerateHeightMeters(viewer.scene, h);
            }
        } catch {
            /* ignore */
        }

        return undefined;
    }


    function computeEventCenter(ev: any, helpers: any, nowMs: number): { lon: number; lat: number } | null {
        if (!ev) return null;

        // 0) explicit point-ish fields
        const direct =
            extractLonLatFromUnknown(ev.location) ??
            extractLonLatFromUnknown(ev.eventLocation) ??
            extractLonLatFromUnknown(ev.where?.location) ??
            extractLonLatFromUnknown(ev.where?.point);

        if (direct) return direct;

        const where = ev.where;

        // 1) geometry -> bbox center
        if (where?.type === "geometry" && where.geometry) {
            const bbox = bboxFromGeometry(where.geometry);
            if (bbox) {
                return { lon: (bbox.minLon + bbox.maxLon) / 2, lat: (bbox.minLat + bbox.maxLat) / 2 };
            }
        }

        // 2) units -> average of unit lon/lat
        const unitIds: any[] =
            (where?.type === "units" && Array.isArray(where.units) ? where.units : null) ??
            (Array.isArray(ev?.involvedUnitIds) ? ev.involvedUnitIds : []);

        if (unitIds.length) {
            const pts: Array<{ lon: number; lat: number }> = [];
            for (const id of unitIds) {
                const u = helpers?.getUnitById?.(id);
                const ll = extractLonLatFromUnit(u, nowMs);
                if (ll) pts.push(ll);
            }
            if (pts.length) {
                const lon = pts.reduce((a, p) => a + p.lon, 0) / pts.length;
                const lat = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
                return { lon, lat };
            }
        }

        return null;
    }

    function extractLonLatFromUnit(u: any, nowMs: number): { lon: number; lat: number } | null {
        if (!u) return null;
        // If unit position is time-state driven (MENTAT style), resolve it at scenario time
        try {
            const p =
                (typeof u.getPositionAtTime === "function" ? u.getPositionAtTime(nowMs) : null) ??
                getUnitPositionAtTime(u, nowMs);

            const llp = extractLonLatFromUnknown(p);
            if (llp) return llp;
        } catch {
            /* ignore */
        }

        const candidates = [
            u.location,
            u.pos,
            u.position,
            u.geo,
            u.coord,
            u.coords,
            u.lat !== undefined && u.lon !== undefined ? { lat: u.lat, lon: u.lon } : null,
            u.latitude !== undefined && u.longitude !== undefined ? { lat: u.latitude, lon: u.longitude } : null,
        ].filter(Boolean);

        for (const c of candidates) {
            const ll = extractLonLatFromUnknown(c);
            if (ll) return ll;
        }
        return null;
    }

    function extractLonLatFromUnknown(v: any): { lon: number; lat: number } | null {
        if (!v) return null;

        if (typeof v === "object") {
            const lon = num(v.lon ?? v.lng ?? v.longitude ?? v.x);
            const lat = num(v.lat ?? v.latitude ?? v.y);
            if (lon !== null && lat !== null) return normalizeLonLat(lon, lat);

            // GeoJSON Point
            if (v.type === "Point" && Array.isArray(v.coordinates) && v.coordinates.length >= 2) {
                const a = num(v.coordinates[0]);
                const b = num(v.coordinates[1]);
                if (a !== null && b !== null) return normalizeLonLat(a, b);
            }

            if (Array.isArray(v.coordinates) && v.coordinates.length >= 2) {
                const a = num(v.coordinates[0]);
                const b = num(v.coordinates[1]);
                if (a !== null && b !== null) return normalizeLonLat(a, b);
            }
        }

        if (Array.isArray(v) && v.length >= 2) {
            const a = num(v[0]);
            const b = num(v[1]);
            if (a !== null && b !== null) return normalizeLonLat(a, b);
        }

        return null;
    }

    function num(x: any): number | null {
        const n = Number(x);
        return Number.isFinite(n) ? n : null;
    }

    const PILLAR_MIN_METERS = 50;
    const GROUND_CLEARANCE_METERS = 2;

    // Distance window: closer than NEAR -> min height; farther than FAR -> max height.
    const PILLAR_NEAR_METERS = 3_000;
    const PILLAR_FAR_METERS = 25_000;

    function pillarHeightForDistance(maxHeight: number, distMeters: number): number {
        const maxH = Math.max(PILLAR_MIN_METERS, Number(maxHeight) || 0);
        const d = Number(distMeters);

        if (!Number.isFinite(d)) return maxH;
        if (d <= PILLAR_NEAR_METERS) return PILLAR_MIN_METERS;
        if (d >= PILLAR_FAR_METERS) return maxH;

        // Smooth (log) interpolation feels better across orders of magnitude.
        const t =
            (Math.log(d) - Math.log(PILLAR_NEAR_METERS)) /
            (Math.log(PILLAR_FAR_METERS) - Math.log(PILLAR_NEAR_METERS));

        return PILLAR_MIN_METERS + t * (maxH - PILLAR_MIN_METERS);
    }


    function normalizeLonLat(a: number, b: number): { lon: number; lat: number } {
        const x = Number(a), y = Number(b);

        // Standard (lon,lat) degrees
        if (Math.abs(x) <= 180 && Math.abs(y) <= 90) return { lon: x, lat: y };

        // Common mistake: (lat,lon) degrees
        if (Math.abs(x) <= 90 && Math.abs(y) <= 180) return { lon: y, lat: x };

        // Assume WebMercator meters (EPSG:3857)
        const R = 6378137.0;
        const lon = (x / R) * (180 / Math.PI);
        const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);

        return { lon, lat };
    }

    function bboxFromGeometry(g: any): BBox | null {
        if (!g) return null;

        // OL geometry-ish (extent in 3857 typically)
        if (typeof g.getExtent === "function") {
            try {
                const e = g.getExtent();
                if (Array.isArray(e) && e.length === 4) {
                    const a = normalizeLonLat(Number(e[0]), Number(e[1]));
                    const b = normalizeLonLat(Number(e[2]), Number(e[3]));
                    return {
                        minLon: Math.min(a.lon, b.lon),
                        minLat: Math.min(a.lat, b.lat),
                        maxLon: Math.max(a.lon, b.lon),
                        maxLat: Math.max(a.lat, b.lat),
                    };
                }
            } catch {
                /* ignore */
            }
        }

        // Feature / FeatureCollection
        if (g.type === "Feature") return bboxFromGeometry(g.geometry);
        if (g.type === "FeatureCollection" && Array.isArray(g.features)) {
            const boxes = g.features.map((f: any) => bboxFromGeometry(f)).filter(Boolean) as BBox[];
            if (!boxes.length) return null;
            return {
                minLon: Math.min(...boxes.map((b) => b.minLon)),
                minLat: Math.min(...boxes.map((b) => b.minLat)),
                maxLon: Math.max(...boxes.map((b) => b.maxLon)),
                maxLat: Math.max(...boxes.map((b) => b.maxLat)),
            };
        }

        const coords = g.coordinates;
        if (!coords) return null;

        let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;

        const visit = (c: any) => {
            if (Array.isArray(c) && c.length >= 2 && typeof c[0] !== "object") {
                const a = Number(c[0]);
                const b = Number(c[1]);
                if (!Number.isFinite(a) || !Number.isFinite(b)) return;
                const ll = normalizeLonLat(a, b);
                minLon = Math.min(minLon, ll.lon);
                maxLon = Math.max(maxLon, ll.lon);
                minLat = Math.min(minLat, ll.lat);
                maxLat = Math.max(maxLat, ll.lat);
                return;
            }
            if (Array.isArray(c)) for (const x of c) visit(x);
        };

        visit(coords);

        if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) return null;
        return { minLon, minLat, maxLon, maxLat };
    }

    function colorForEvent(ev: any, helpers: any): { fill: Color; outline: Color } {
        const ids: string[] = Array.isArray(ev?.involvedUnitIds) ? ev.involvedUnitIds.map((x: any) => String(x)) : [];
        const avg = ids.length ? averageRgbFromUnitIds(ids, helpers) : null;

        if (!avg) {
            return {
                fill: Color.fromCssColorString("rgba(0,0,0,0.25)"),
                outline: Color.fromCssColorString("rgba(0,0,0,0.85)"),
            };
        }

        return {
            fill: Color.fromBytes(avg.r, avg.g, avg.b, Math.round(255 * 0.35)),
            outline: Color.fromBytes(avg.r, avg.g, avg.b, Math.round(255 * 0.95)),
        };
    }

    function averageRgbFromUnitIds(ids: string[], helpers: any): { r: number; g: number; b: number } | null {
        const rgbs: Array<{ r: number; g: number; b: number }> = [];
        for (const id of ids) {
            const rgb = getUnitOrSideRgb(id, helpers);
            if (rgb) rgbs.push(rgb);
        }
        if (!rgbs.length) return null;

        const r = rgbs.reduce((a, c) => a + c.r, 0) / rgbs.length;
        const g = rgbs.reduce((a, c) => a + c.g, 0) / rgbs.length;
        const b = rgbs.reduce((a, c) => a + c.b, 0) / rgbs.length;
        return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
    }

    function getUnitOrSideRgb(unitId: string, helpers: any): { r: number; g: number; b: number } | null {
        let unit: any = null;
        try {
            unit = helpers?.getUnitById?.(unitId) ?? null;
        } catch {
            unit = null;
        }

        const unitRgb = parseColorToRgb(pickUnitColor(unit));
        if (unitRgb) return unitRgb;

        const sideId = unit?.sideId ?? unit?.SideId ?? null;
        if (!sideId) return null;

        let side: any = null;
        try {
            side = helpers?.getSideById?.(sideId) ?? null;
        } catch {
            side = null;
        }

        return parseColorToRgb(pickSideColor(side));
    }

    function pickUnitColor(u: any): string | null {
        const c =
            u?.color ??
            u?.iconColor ??
            u?.style?.color ??
            u?.style?.iconColor ??
            u?.style?.stroke ??
            u?.symbolOptions?.color ??
            u?.symbolOptions?.fillColor ??
            u?.meta?.color ??
            u?.appearance?.color ??
            null;

        return typeof c === "string" && c.trim() ? c.trim() : null;
    }

    function pickSideColor(side: any): string | null {
        const c = side?.color ?? side?.style?.color ?? side?.style?.stroke ?? side?.meta?.color ?? null;
        return typeof c === "string" && c.trim() ? c.trim() : null;
    }

    function parseColorToRgb(c: string | null | undefined): { r: number; g: number; b: number } | null {
        if (!c) return null;
        const s = c.trim();
        const hex = s.startsWith("#") ? s.slice(1) : s;

        if (/^[0-9a-fA-F]{3}$/.test(hex)) {
            return {
                r: parseInt(hex[0] + hex[0], 16),
                g: parseInt(hex[1] + hex[1], 16),
                b: parseInt(hex[2] + hex[2], 16),
            };
        }
        if (/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) {
            return {
                r: parseInt(hex.slice(0, 2), 16),
                g: parseInt(hex.slice(2, 4), 16),
                b: parseInt(hex.slice(4, 6), 16),
            };
        }

        const m = s.match(/rgba?\s*\(\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)/i);
        if (m) {
            const r = Number(m[1]), g = Number(m[2]), b = Number(m[3]);
            if ([r, g, b].every((v) => Number.isFinite(v) && v >= 0 && v <= 255)) return { r, g, b };
        }

        return null;
    }

    function scenarioNow(helpers: any): number {
        const n =
            helpers?.store?.state?.currentTime ??
            helpers?.state?.currentTime ??
            helpers?.currentTime ??
            (helpers?.time?.store?.state?.currentTime ?? undefined);

        const v = Number(n);
        return Number.isFinite(v) ? v : Date.now();
    }

    const api: ScenarioEventMarkers3D = { setVisible, sync, destroy };

    try {
        (window as any).__MentatEvents3D = { ...api, ds, viewer };
    } catch {
        /* ignore */
    }

    return api;

}
