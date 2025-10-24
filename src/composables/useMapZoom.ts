// src/composables/useMapZoom.ts
import type Map from "ol/Map";
import { transform } from "ol/proj";

function is4326(code?: string) {
    return (code ?? "").toUpperCase().includes("EPSG:4326");
}

/**
 * Bind OpenLayers zoom helpers to your current map getter.
 * Usage in component:
 *   const { zoomToLonLat } = makeZoomHelpers(() => geoStore.olMap ?? undefined);
 */
export function makeZoomHelpers(getMap: () => Map | undefined) {
    function zoomToLonLat(lon: number, lat: number, zoom = 12, duration = 300) {
        const map = getMap();
        const view = map?.getView?.();
        if (!map || !view) return;

        const proj = view.getProjection();
        const center = is4326(proj?.getCode())
            ? [lon, lat]
            : transform([lon, lat], "EPSG:4326", proj);

        view.animate({ center, zoom, duration });
    }

    return { zoomToLonLat };
}