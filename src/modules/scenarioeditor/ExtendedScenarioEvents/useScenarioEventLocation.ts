// src/modules/scenarioeditor/ExtendedScenarioEvents/useScenarioEventLocation.ts
import { computed, watch, unref, type Ref } from "vue";
import { injectStrict } from "@/utils";
import { activeScenarioKey } from "@/components/injects";
import { useGeoStore } from "@/stores/geoStore";
import { useGetMapLocation } from "@/composables/geoMapLocation";
import { formatPosition } from "@/geo/utils";
import OLMap from "ol/Map";
import { useUiStore } from "@/stores/uiStore";
import type { EntityId } from "@/types/base";
import GeoJSON from "ol/format/GeoJSON";
import { fromLonLat } from "ol/proj";

/**
 * Shared logic for:
 *  - starting "pick location from map" interaction,
 *  - updating event.where when a location is chosen,
 *  - exposing a simple { lat, lon } + formatted string,
 *  - syncing ui.getLocationActive the same way UnitDetails does.
 */
export function useScenarioEventLocation(eventId: Ref<EntityId> | EntityId) {
    const activeScenario = injectStrict(activeScenarioKey);
    const {
        time,
        time: { updateScenarioEvent },
    } = activeScenario;

    const geoStore = useGeoStore();
    const uiStore = useUiStore();

    // EXACTLY mirror UnitDetails pattern:
    const {
        start,
        isActive: isGetLocationActive,
        onGetLocation,
    } = useGetMapLocation(geoStore.olMap as OLMap);

    const startGetLocation = () => {
        const id = unref(eventId);
        console.debug("[EventLocation] startGetLocation() called for event", id);
        start();
    };

    const scenarioEvent = computed(() => {
        const id = unref(eventId);
        const ev = time.getEventById(id);
        console.debug("[EventLocation] scenarioEvent computed", id, ev);
        return ev;
    });

    // Extract {lat, lon} from where.geometry or array
    const eventLocation = computed<{ lat: number; lon: number } | null>(() => {
        const ev: any = scenarioEvent.value;
        const where = ev?.where;
        if (!where) {
            console.debug("[EventLocation] no where set yet");
            return null;
        }

        // Support the structures we might encounter:
        // 1) where.geometry = { type: "Point", coordinates: [lon, lat] }
        // 2) where.geometry = [lon, lat]
        // 3) where = [lon, lat]  (just in case)
        let geom: any = where.geometry ?? where;

        // Case 2/3: plain coordinate array
        if (Array.isArray(geom) && geom.length >= 2) {
            const [lon, lat] = geom;
            if (typeof lon === "number" && typeof lat === "number") {
                const loc = { lat, lon };
                console.debug("[EventLocation] derived location from array geometry", loc);
                return loc;
            }
        }

        // Case 1: GeoJSON-style Point
        if (geom && geom.type === "Point" && Array.isArray(geom.coordinates)) {
            const [lon, lat] = geom.coordinates;
            if (typeof lon === "number" && typeof lat === "number") {
                const loc = { lat, lon };
                console.debug("[EventLocation] derived location from Point geometry", loc);
                return loc;
            }
        }

        console.debug(
            "[EventLocation] where exists but not usable Point geometry",
            where,
        );
        return null;
    });

    const formattedLocation = computed(() => {
        const loc = eventLocation.value;
        if (!loc) return "";

        // formatPosition expects a coordinate array (likely [lon, lat]),
        // not an object, so convert.
        const s = formatPosition([loc.lon, loc.lat] as [number, number]);
        return s;
    });


    // Keep global "get location" UI flag in sync (same as UnitDetails.vue)
    watch(
        isGetLocationActive,
        (isActive) => {
            console.debug("[EventLocation] isGetLocationActive ->", isActive);
            uiStore.getLocationActive = isActive;
        },
        { immediate: true },
    );

    // When user clicks on map while picker is active, update event.where
    onGetLocation((location: any) => {
        const id = unref(eventId);
        console.debug("[EventLocation] onGetLocation callback fired", {
            eventId: id,
            location,
        });

        if (!location) {
            console.debug("[EventLocation] onGetLocation called with falsy location");
            return;
        }

        // Handle both array and {lon,lat} forms
        let lon: number | undefined;
        let lat: number | undefined;

        if (Array.isArray(location) && location.length >= 2) {
            // likely [lon, lat] from OL
            [lon, lat] = location;
        } else {
            lon = location.lon ?? location[0];
            lat = location.lat ?? location[1];
        }

        if (typeof lon !== "number" || typeof lat !== "number") {
            console.debug(
                "[EventLocation] onGetLocation got non-numeric coordinates",
                location,
            );
            return;
        }

        const geometry = {
            type: "Point" as const,
            coordinates: [lon, lat] as [number, number],
        };

        const where = {
            type: "geometry" as const,
            geometry,
            maxZoom: 10,
        };

        console.debug("[EventLocation] updating event.where", { eventId: id, where });

        updateScenarioEvent(id, { where } as any);
    });

    async function panToEventLocation() {
        const ev = time.getEventById(eventId);
        const where = (ev as any)?.where;
        if (!where) return;

        // OpenLayers map instance lives here (NOT activeScenario.geo.map)
        const mapMaybe = (geoStore as any).olMap;
        const map: any = unref(mapMaybe) ?? mapMaybe;

        if (!map || typeof map.getView !== "function") {
            console.warn("[EventLocation] panToEventLocation: no OL map on geoStore.olMap", mapMaybe);
            return;
        }

        const view = map.getView();
        const proj = view?.getProjection?.();
        const maxZoom = Number.isFinite(where?.maxZoom) ? Number(where.maxZoom) : 10;

        // Canonical source (matches ORBAT sidebar): where.type === "geometry" with GeoJSON geometry
        const geom = where?.type === "geometry" ? where.geometry : where.geometry ?? where;

        // Helper: clamp to avoid projection weirdness
        const clampLat = (lat: number) => Math.max(-85, Math.min(85, lat));
        const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;

        // 1) Point -> animate center + zoom
        if (geom?.type === "Point" && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
            const lonRaw = geom.coordinates[0];
            const latRaw = geom.coordinates[1];
            if (!Number.isFinite(lonRaw) || !Number.isFinite(latRaw)) return;

            const lon = wrapLon(lonRaw);
            const lat = clampLat(latRaw);
            const center = fromLonLat([lon, lat], proj);

            console.debug("[EventLocation] panToEventLocation -> Point", { lon, lat, maxZoom });

            view.animate(
                { center, duration: 650 },
                { zoom: maxZoom, duration: 650 },
            );
            return;
        }

        // 2) Any other GeoJSON geometry -> fit extent (still respects maxZoom)
        if (geom?.type && geom?.coordinates) {
            try {
                const fmt = new GeoJSON();
                const feature = fmt.readFeature(
                    { type: "Feature", geometry: geom, properties: {} },
                    { dataProjection: "EPSG:4326", featureProjection: proj },
                );

                const olGeom = feature?.getGeometry?.();
                const extent = olGeom?.getExtent?.();
                if (!extent) return;

                console.debug("[EventLocation] panToEventLocation -> fit geometry", { geomType: geom.type, maxZoom });

                view.fit(extent, {
                    duration: 650,
                    padding: [24, 24, 24, 24],
                    maxZoom,
                });
                return;
            } catch (err) {
                console.warn("[EventLocation] panToEventLocation: failed to fit geometry; falling back", err);
            }
        }

        // 3) Fallback: use computed {lat, lon} (already derived earlier in this file)
        const loc = eventLocation.value;
        if (!loc) return;

        const lon = wrapLon(loc.lon);
        const lat = clampLat(loc.lat);
        const center = fromLonLat([lon, lat], proj);

        console.debug("[EventLocation] panToEventLocation -> fallback loc", { lon, lat, maxZoom });

        view.animate(
            { center, duration: 650 },
            { zoom: maxZoom, duration: 650 },
        );
    }


    return {
        startGetLocation,
        isGetLocationActive,
        eventLocation,
        formattedLocation,
        panToEventLocation,
    };
}
