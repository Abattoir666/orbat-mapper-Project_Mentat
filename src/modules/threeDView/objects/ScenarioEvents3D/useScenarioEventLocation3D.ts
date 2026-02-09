import { computed, ref, type Ref } from "vue";
import { useActiveScenario } from "@/composables/scenarioUtils";
import { useGlobePort } from "@/composables/useGlobePort";

/**
 * 3D-safe replacement for useScenarioEventLocation (which depends on OL map).
 *
 * - startGetLocation(): one-shot Cesium globe click → writes event.where as GeoJSON Point
 * - panToEventLocation(): flyTo based on explicit point / where.units / where.geometry
 */
export function useScenarioEventLocation3D(eventId: string) {
    const activeScenario = useActiveScenario() as any;

    const time = activeScenario?.time;
    const helpers = activeScenario?.helpers;

    const updateScenarioEvent =
        activeScenario?.time?.updateScenarioEvent ??
        activeScenario?.time?.updateEvent ??
        activeScenario?.updateScenarioEvent;

    const globePort = useGlobePort() as any;
    const flyToLatLon =
        (globePort as any)?.flyToLatLon as undefined | ((lon: number, lat: number, h?: number) => void);


    const scenarioEvent = computed<any>(() => time?.getEventById?.(eventId));

    // expose "location" for the details panel
    const eventLocation: Ref<any | null> = computed(() => {
        const ev = scenarioEvent.value;
        if (!ev) return null;

        // explicit point field (if your model has it)
        const p =
            ev.location ??
            ev.eventLocation ??
            ev.where?.location ??
            ev.where?.point ??
            null;
        if (p) return p;

        // otherwise where itself can be panned to
        return ev.where ?? null;
    }) as any;

    const formattedLocation = computed(() => {
        const ev = scenarioEvent.value;
        if (!ev) return "";

        const p = eventLocation.value;
        if (!p) return "";

        // explicit lon/lat formats or Point
        const ll = extractLonLatFromUnknown(p);
        if (ll) return `${ll.lat.toFixed(5)}, ${ll.lon.toFixed(5)}`;

        const where = ev.where;
        if (where?.type === "units") {
            const n = Array.isArray(where.units) ? where.units.length : 0;
            return n ? `Units (${n})` : "Units";
        }
        if (where?.type === "geometry") return "Geometry";

        return "Location";
    });

    // ────────────────────────────────────────────────────────────────
    // 3D picking: click globe once → set event.where = GeoJSON Point
    // ────────────────────────────────────────────────────────────────

    const isPicking = ref(false);
    let handler: any | null = null;
    let keydownFn: ((e: KeyboardEvent) => void) | null = null;

    function getViewerSafe(): any | null {
        const mg = (window as any)?.MentatGlobe;
        let v: any = null;

        try { v = mg?.getViewer?.() ?? null; } catch { v = null; }
        if (!v) {
            try { v = (globePort as any)?.getViewer?.() ?? null; } catch { v = null; }
        }
        if (!v) {
            try { v = mg?.viewer ?? null; } catch { v = null; } // last resort (may be a getter)
        }

        if (!v) return null;

        try {
            if (typeof v.isDestroyed === "function" && v.isDestroyed()) return null;
            const scene = v.scene;
            if (!scene || !scene.canvas) return null;
            return v;
        } catch {
            return null;
        }
    }

    function stopPicking() {
        isPicking.value = false;

        if (handler) {
            try {
                handler.destroy?.();
            } catch {
                // ignore
            }
            handler = null;
        }

        if (keydownFn) {
            window.removeEventListener("keydown", keydownFn);
            keydownFn = null;
        }

        // Optional: restore cursor
        try {
            const viewer = getViewerSafe();
            const canvas = viewer?.scene?.canvas as HTMLCanvasElement | undefined;
            if (canvas) canvas.style.cursor = "";
        } catch { /* ignore */ }
    }

    function startGetLocation() {
        if (isPicking.value) return;

        const viewer = getViewerSafe();
        const Cesium = (window as any)?.Cesium;

        if (!viewer || !Cesium) {
            console.warn("3D event location pick: Cesium viewer not available.");
            return;
        }

        let canvas: HTMLCanvasElement | undefined;
        try { canvas = viewer.scene?.canvas as HTMLCanvasElement | undefined; } catch { canvas = undefined; }
        if (!canvas) {
            console.warn("3D event location pick: viewer canvas not available.");
            return;
        }

        // Cursor hint
        canvas.style.cursor = "crosshair";

        isPicking.value = true;

        // Escape cancels
        keydownFn = (e: KeyboardEvent) => {
            if (e.key === "Escape") stopPicking();
        };
        window.addEventListener("keydown", keydownFn);

        // One-shot click handler
        handler = new Cesium.ScreenSpaceEventHandler(canvas);

        handler.setInputAction((click: any) => {
            try {
                const pos = click?.position;
                if (!pos) return;

                // Prefer globe pick (works reliably for terrain/globe)
                const ray = viewer.camera.getPickRay(pos);
                const cart = ray ? viewer.scene.globe.pick(ray, viewer.scene) : null;

                if (!cart) {
                    // fallback: pickPosition (may be null if depth not available)
                    const pp = viewer.scene.pickPosition?.(pos);
                    if (pp) {
                        const carto = Cesium.Cartographic.fromCartesian(pp);
                        const lon = Cesium.Math.toDegrees(carto.longitude);
                        const lat = Cesium.Math.toDegrees(carto.latitude);
                        writePointWhere(lon, lat);
                        stopPicking();
                    }
                    return;
                }

                const carto = Cesium.Cartographic.fromCartesian(cart);
                const lon = Cesium.Math.toDegrees(carto.longitude);
                const lat = Cesium.Math.toDegrees(carto.latitude);

                writePointWhere(lon, lat);
            } finally {
                stopPicking();
            }
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        // Right click cancels
        handler.setInputAction(() => stopPicking(), Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    }

    function writePointWhere(lon: number, lat: number) {
        if (typeof updateScenarioEvent !== "function") {
            console.warn("3D event location pick: updateScenarioEvent not found on scenario time API.");
            return;
        }

        const ev = scenarioEvent.value;
        const existingMaxZoom = ev?.where?.maxZoom;

        updateScenarioEvent(eventId, {
            where: {
                type: "geometry",
                geometry: { type: "Point", coordinates: [lon, lat] },
                maxZoom: typeof existingMaxZoom === "number" ? existingMaxZoom : 14,
            },
        } as any);
    }

    async function panToEventLocation() {
        const ev = scenarioEvent.value;
        if (!ev) return;

        // 1) explicit point-like fields
        const direct = extractLonLatFromUnknown(
            ev.location ?? ev.eventLocation ?? ev.where?.location ?? ev.where?.point ?? null,
        );
        if (direct) {
            await flyToGroundAware(direct.lon, direct.lat, 8000); // 8km AGL default; tweak as desired
            return;
        }

        // 2) where: units
        const where = ev.where;
        if (where?.type === "units" && Array.isArray(where.units)) {
            const pts = where.units
                .map((id: any) => {
                    const u = helpers?.getUnitById?.(id);
                    return extractLonLatFromUnit(u);
                })
                .filter(Boolean) as Array<{ lon: number; lat: number }>;

            if (pts.length) {
                const center = averageLonLat(pts);
                const h = heightFromSpread(pts);
                await flyToGroundAware(center.lon, center.lat, /* pick based on spread */ h);
                return;
            }
        }

        // 3) where: geometry
        if (where?.type === "geometry" && where.geometry) {
            const bbox = bboxFromGeometry(where.geometry);
            if (bbox) {
                const center = {
                    lon: (bbox.minLon + bbox.maxLon) / 2,
                    lat: (bbox.minLat + bbox.maxLat) / 2,
                };
                const h = heightFromBbox(bbox);
                await flyToGroundAware(center.lon, center.lat, /* pick based on spread */ h);
                return;
            }
        }
    }

    async function getGroundHeightMeters(viewer: any, lon: number, lat: number): Promise<number | undefined> {
        const Cesium = (window as any)?.Cesium;
        if (!Cesium || !viewer) return undefined;

        // Fast path: height from currently-loaded tiles
        try {
            const carto = Cesium.Cartographic.fromDegrees(lon, lat);
            const h0 = viewer.scene?.globe?.getHeight?.(carto);
            if (typeof h0 === "number" && Number.isFinite(h0)) return h0;
        } catch { /* ignore */ }

        // Reliable path: terrain sampling
        try {
            const carto = Cesium.Cartographic.fromDegrees(lon, lat);
            const provider = (viewer.terrain as any)?.provider ?? viewer.terrainProvider;
            if (!provider) return undefined;

            const res = await Cesium.sampleTerrainMostDetailed(provider, [carto]);
            const h = res?.[0]?.height;
            if (typeof h === "number" && Number.isFinite(h)) return h;
        } catch { /* ignore */ }

        return undefined;
    }

    async function flyToGroundAware(lon: number, lat: number, aglMeters: number) {
        const viewer = (window as any)?.MentatGlobe?.viewer;

        const ground = await getGroundHeightMeters(viewer, lon, lat);
        const abs = (typeof ground === "number" ? ground : 0) + aglMeters;

        const heightAbs = Math.max(abs, 50);

        if (typeof globePort?.flyToLatLon === "function") {
            globePort.flyToLatLon(lon, lat, heightAbs);
            return;
        }

        const Cesium = (window as any)?.Cesium;
        if (viewer?.camera?.flyTo && Cesium?.Cartesian3?.fromDegrees) {
            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(lon, lat, heightAbs),
                duration: 0.9,
            });
        }
    }


    function flyToBestEffort(lon: number, lat: number, height: number) {
        if (typeof flyToLatLon === "function") {
            flyToLatLon(lon, lat, height);
            return;
        }

        const viewer = (window as any)?.MentatGlobe?.viewer;
        const Cesium = (window as any)?.Cesium;
        if (viewer?.camera?.flyTo && Cesium?.Cartesian3?.fromDegrees) {
            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
                duration: 0.9,
            });
        }
    }

    return {
        startGetLocation,
        eventLocation,
        formattedLocation,
        panToEventLocation,
        isPicking,
    };
}

/* ───────────────── helpers ───────────────── */

function averageLonLat(pts: Array<{ lon: number; lat: number }>) {
    const lon = pts.reduce((a, p) => a + p.lon, 0) / pts.length;
    const lat = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
    return { lon, lat };
}

function heightFromSpread(pts: Array<{ lon: number; lat: number }>) {
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const p of pts) {
        minLon = Math.min(minLon, p.lon);
        maxLon = Math.max(maxLon, p.lon);
        minLat = Math.min(minLat, p.lat);
        maxLat = Math.max(maxLat, p.lat);
    }
    const dLon = Math.max(0.0001, maxLon - minLon);
    const dLat = Math.max(0.0001, maxLat - minLat);
    const deg = Math.max(dLon, dLat);
    const meters = deg * 111_000;
    return clamp(meters * 3.0, 4000, 1_250_000);
}

function heightFromBbox(b: { minLon: number; minLat: number; maxLon: number; maxLat: number }) {
    const dLon = Math.max(0.0001, b.maxLon - b.minLon);
    const dLat = Math.max(0.0001, b.maxLat - b.minLat);
    const deg = Math.max(dLon, dLat);
    const meters = deg * 111_000;
    return clamp(meters * 3.0, 8000, 2_500_000);
}

function clamp(v: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, v));
}

function extractLonLatFromUnit(u: any): { lon: number; lat: number } | null {
    if (!u) return null;

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
        if (lon !== null && lat !== null) return normalizeMaybe3857(lon, lat);

        if (v.type === "Point" && Array.isArray(v.coordinates) && v.coordinates.length >= 2) {
            const a = num(v.coordinates[0]);
            const b = num(v.coordinates[1]);
            if (a !== null && b !== null) return normalizeMaybe3857(a, b);
        }

        if (Array.isArray(v.coordinates) && v.coordinates.length >= 2) {
            const a = num(v.coordinates[0]);
            const b = num(v.coordinates[1]);
            if (a !== null && b !== null) return normalizeMaybe3857(a, b);
        }
    }

    if (Array.isArray(v) && v.length >= 2) {
        const a = num(v[0]);
        const b = num(v[1]);
        if (a !== null && b !== null) return normalizeMaybe3857(a, b);
    }

    return null;
}

function num(x: any): number | null {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
}

function normalizeMaybe3857(x: number, y: number): { lon: number; lat: number } {
    const absX = Math.abs(x);
    const absY = Math.abs(y);

    if (absX > 180 || absY > 90) {
        const R = 6378137;
        const lon = (x / 20037508.34) * 180;
        const lat = (Math.atan(Math.exp(y / R)) * 360) / Math.PI - 90;
        return { lon, lat };
    }
    return { lon: x, lat: y };
}

function bboxFromGeometry(g: any): { minLon: number; minLat: number; maxLon: number; maxLat: number } | null {
    if (!g) return null;

    // OL geometry-ish
    if (typeof g.getExtent === "function") {
        try {
            const e = g.getExtent();
            if (Array.isArray(e) && e.length === 4) {
                const a = normalizeMaybe3857(Number(e[0]), Number(e[1]));
                const b = normalizeMaybe3857(Number(e[2]), Number(e[3]));
                return {
                    minLon: Math.min(a.lon, b.lon),
                    minLat: Math.min(a.lat, b.lat),
                    maxLon: Math.max(a.lon, b.lon),
                    maxLat: Math.max(a.lat, b.lat),
                };
            }
        } catch {
            // ignore
        }
    }

    // Feature / FeatureCollection
    const geom = g.type === "Feature" ? g.geometry : g;
    if (g.type === "FeatureCollection" && Array.isArray(g.features)) {
        const boxes = g.features.map((f: any) => bboxFromGeometry(f)).filter(Boolean) as any[];
        if (!boxes.length) return null;
        return {
            minLon: Math.min(...boxes.map((b) => b.minLon)),
            minLat: Math.min(...boxes.map((b) => b.minLat)),
            maxLon: Math.max(...boxes.map((b) => b.maxLon)),
            maxLat: Math.max(...boxes.map((b) => b.maxLat)),
        };
    }

    if (!geom?.coordinates) return null;

    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;

    const visit = (c: any) => {
        if (Array.isArray(c) && c.length >= 2 && typeof c[0] !== "object") {
            const a = num(c[0]);
            const b = num(c[1]);
            if (a === null || b === null) return;
            const ll = normalizeMaybe3857(a, b);
            minLon = Math.min(minLon, ll.lon);
            maxLon = Math.max(maxLon, ll.lon);
            minLat = Math.min(minLat, ll.lat);
            maxLat = Math.max(maxLat, ll.lat);
            return;
        }
        if (Array.isArray(c)) for (const x of c) visit(x);
    };

    visit(geom.coordinates);

    if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) return null;
    return { minLon, minLat, maxLon, maxLat };
}
