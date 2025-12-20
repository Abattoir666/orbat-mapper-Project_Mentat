// src/modules/scenarioeditor/ExtendedScenarioEvents/useScenarioEventLayer.ts
import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import { injectStrict } from "@/utils";
import { activeScenarioKey } from "@/components/injects";
import { useGeoStore } from "@/stores/geoStore";

import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import { fromLonLat } from "ol/proj";
import type Map from "ol/Map";

import GeoJSON from "ol/format/GeoJSON";
import { getCenter } from "ol/extent";

import { eventIconStyle } from "./eventIconStyle";
import type { ScenarioEventCategory } from "./eventIconRegistry";

/**
 * Scenario-event marker layer (time-sensitive).
 *
 * Visibility rules:
 * - Hidden before startTime.
 * - Visible after startTime.
 * - If endTime is set, hidden after endTime.
 *
 * Event source:
 * - store.state.events (array of IDs) -> store.state.eventMap[id]
 */
export function useScenarioEventLayer(): void {
    const geoStore = useGeoStore();
    const activeScenario = injectStrict(activeScenarioKey);
    const { store } = activeScenario as any;
    const helpers = (activeScenario as any)?.helpers;

    const mapRef = computed(() => geoStore.olMap as Map | null | undefined);

    // Canonical source: events[] (IDs) -> eventMap[id]
    const events = computed<any[]>(() => {
        const s: any = store.state as any;
        const ids: any[] = Array.isArray(s.events) ? s.events : [];
        const map: Record<string, any> = s.eventMap ?? {};
        return ids.map((id) => map[id]).filter(Boolean);
    });

    const currentTime = computed<number | undefined>(() => {
        const t = (store.state as any)?.currentTime;
        return typeof t === "number" ? t : undefined;
    });

    let layer: VectorLayer<VectorSource> | null = null;
    const geojson = new GeoJSON();

    function toNumber(x: any): number | null {
        const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN;
        return Number.isFinite(n) ? n : null;
    }

    function isEventVisibleAtTime(ev: any, t: number | undefined): boolean {
        if (t == null) return true;

        const start = (ev as any)?.startTime;
        const end = (ev as any)?.endTime;

        if (typeof start === "number" && t < start) return false;
        if (typeof end === "number" && t > end) return false;

        return true;
    }

    // --- color averaging (unit colors -> eventColor) ---
    function parseColorToRgb(c: string | null | undefined) {
        if (!c) return null;
        const s = c.trim();
        const hex = s.startsWith("#") ? s.slice(1) : s;

        if (/^[0-9a-fA-F]{3}$/.test(hex)) {
            const r = parseInt(hex[0] + hex[0], 16);
            const g = parseInt(hex[1] + hex[1], 16);
            const b = parseInt(hex[2] + hex[2], 16);
            return { r, g, b };
        }

        if (/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) {
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            return { r, g, b };
        }

        const m = s.match(/rgba?\s*\(\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)/i);
        if (m) {
            const r = Number(m[1]), g = Number(m[2]), b = Number(m[3]);
            if ([r, g, b].every((v) => Number.isFinite(v) && v >= 0 && v <= 255)) return { r, g, b };
        }

        return null;
    }

    function rgbToHex(rgb: { r: number; g: number; b: number }) {
        const to2 = (n: number) =>
            Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
        return `#${to2(rgb.r)}${to2(rgb.g)}${to2(rgb.b)}`;
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

    // Cache unitId -> parsed RGB to avoid re-parsing every rebuild
    const unitRgbCache = new Map<string, { r: number; g: number; b: number } | null>();

    function getUnitRgb(unitId: string): { r: number; g: number; b: number } | null {
        if (!unitId) return null;
        if (unitRgbCache.has(unitId)) return unitRgbCache.get(unitId) ?? null;

        let unit: any = null;
        try {
            unit = helpers?.getUnitById ? helpers.getUnitById(unitId) : null;
        } catch {
            unit = null;
        }

        const rgb = parseColorToRgb(pickUnitColor(unit));
        unitRgbCache.set(unitId, rgb);
        return rgb;
    }

    function averageColorHexFromUnitIds(ids: string[]): string | null {
        const rgbs: Array<{ r: number; g: number; b: number }> = [];
        for (const id of ids) {
            const rgb = getUnitRgb(String(id));
            if (rgb) rgbs.push(rgb);
        }
        if (!rgbs.length) return null;

        const r = rgbs.reduce((a, c) => a + c.r, 0) / rgbs.length;
        const g = rgbs.reduce((a, c) => a + c.g, 0) / rgbs.length;
        const b = rgbs.reduce((a, c) => a + c.b, 0) / rgbs.length;
        return rgbToHex({ r, g, b });
    }

    // --- location extraction ---
    function extractLonLatFromGeoJsonGeometry(geom: any): { lon: number; lat: number } | null {
        if (!geom) return null;

        // GeoJSON Feature wrapper
        if (geom.type === "Feature" && geom.geometry) geom = geom.geometry;

        // Point geometry
        if (geom.type === "Point" && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
            const lon = toNumber(geom.coordinates[0]);
            const lat = toNumber(geom.coordinates[1]);
            if (lon == null || lat == null) return null;
            return { lon, lat };
        }

        // Array form [lon, lat]
        if (Array.isArray(geom) && geom.length >= 2) {
            const lon = toNumber(geom[0]);
            const lat = toNumber(geom[1]);
            if (lon == null || lat == null) return null;
            return { lon, lat };
        }

        // Any other GeoJSON geometry -> marker at extent center
        if (geom.type && geom.coordinates) {
            try {
                const olGeom = geojson.readGeometry(geom, {
                    dataProjection: "EPSG:4326",
                    featureProjection: "EPSG:4326",
                });
                const extent = olGeom?.getExtent?.();
                if (!extent) return null;

                const [lon, lat] = getCenter(extent);
                if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
                return { lon, lat };
            } catch {
                return null;
            }
        }

        return null;
    }

    function extractLonLatForEvent(ev: any): { lon: number; lat: number } | null {
        const where = ev?.where;
        if (!where) return null;

        // Prefer explicit lon/lat in where.location if present
        const loc = where.location ?? where.point ?? where.position;
        if (loc) {
            const lon = toNumber(loc.lon ?? loc.lng ?? loc.longitude ?? loc[0]);
            const lat = toNumber(loc.lat ?? loc.latitude ?? loc[1]);
            if (lon != null && lat != null) return { lon, lat };
        }

        // GeoJSON geometry forms
        const geom = where.geometry ?? where.geojson ?? where.geoJson ?? where.shape;
        if (geom) {
            const ll = extractLonLatFromGeoJsonGeometry(geom);
            if (ll) return ll;
        }

        // Some events have "points" arrays
        const pts = Array.isArray(where.points) ? where.points : Array.isArray(where.coords) ? where.coords : null;
        if (pts && pts.length) {
            const parsed = pts
                .map((p: any) => {
                    const lon = toNumber(p.lon ?? p.lng ?? p.longitude ?? p[0]);
                    const lat = toNumber(p.lat ?? p.latitude ?? p[1]);
                    return lon != null && lat != null ? { lon, lat } : null;
                })
                .filter(Boolean) as Array<{ lon: number; lat: number }>;

            if (!parsed.length) return null;

            const lon = parsed.reduce((a, p) => a + p.lon, 0) / parsed.length;
            const lat = parsed.reduce((a, p) => a + p.lat, 0) / parsed.length;
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
            return { lon, lat };
        }

        // Last-resort: tolerate direct lat/lon fields if present
        const lon = toNumber(where.lon ?? where.lng ?? where.longitude);
        const lat = toNumber(where.lat ?? where.latitude);
        if (lon != null && lat != null) return { lon, lat };

        return null;
    }

    // --- rebuild scheduling (prevents stampede and improves perceived load time) ---
    let rebuildPending = false;
    function requestRebuild() {
        if (rebuildPending) return;
        rebuildPending = true;
        requestAnimationFrame(() => {
            rebuildPending = false;
            rebuildFeatures();
        });
    }

    function rebuildFeatures() {
        if (!layer) return;

        const source = layer.getSource();
        if (!source) return;

        source.clear();

        const t = currentTime.value;

        const stackCounts = new Map<string, number>();
        const keyFor = (lon: number, lat: number) => `${lon.toFixed(5)},${lat.toFixed(5)}`;

        for (const ev of events.value) {
            if (!ev) continue;

            const id = String(ev.id ?? "");
            const whereType = ev?.where?.type;

            // Time-sensitive
            if (!isEventVisibleAtTime(ev, t)) continue;

            const ll = extractLonLatForEvent(ev);
            if (!ll) continue;

            const { lon, lat } = ll;

            const k = keyFor(lon, lat);
            const idx = stackCounts.get(k) ?? 0;
            stackCounts.set(k, idx + 1);

            // --- compute eventColor from involved units (scoped inside loop) ---
            const involvedIds: string[] = Array.isArray((ev as any)?.involvedUnitIds)
                ? (ev as any).involvedUnitIds.map((x: any) => String(x))
                : [];

            const eventColor = involvedIds.length ? averageColorHexFromUnitIds(involvedIds) : null;

            const feature = new Feature({
                geometry: new Point(fromLonLat([lon, lat])),
                eventId: id,
                eventCategory: ((ev as any).category ?? "generic") as ScenarioEventCategory,
                eventTitle: (ev as any).title ?? "",
                eventStackIndex: idx,
                eventColor: eventColor ?? undefined,
            });

            source.addFeature(feature);
        }
    }

    function ensureLayer(map: Map | null | undefined) {
        if (!map) return;
        if (layer) return;

        layer = new VectorLayer({
            source: new VectorSource(),
            style: eventIconStyle,
            zIndex: 500,
        });

        map.addLayer(layer);
        rebuildFeatures();
    }

    onMounted(() => ensureLayer(mapRef.value));
    watch(mapRef, (map) => ensureLayer(map));

    // Rebuild when time changes (coalesced)
    watch(currentTime, () => requestRebuild());

    // Rebuild when scenario event ids list changes (coalesced)
    watch(
        () => (store.state as any)?.events,
        () => requestRebuild(),
        { deep: false },
    );

    // Rebuild when eventMap entries are replaced (this is cheap if your store uses immutable updates)
    watch(events, () => requestRebuild(), { deep: false });

    onBeforeUnmount(() => {
        const map = mapRef.value;
        if (map && layer) map.removeLayer(layer);
        layer = null;
    });
}
