// src/modules/threeDView/globeAdapter.ts
import proj4 from "proj4";
import {
    Cartesian3,
    Color,
    HeightReference,
    VerticalOrigin,
    sampleTerrainMostDetailed,
    UrlTemplateImageryProvider,
    type Viewer,
} from "cesium";

import { useGlobe, type GlobeApi } from "./useGlobe";
import { makeImageryProviders } from "./makeImageryProviders";

export type UnitRenderable = {
    id: string;
    name?: string;
    lat: number;  // degrees (WGS84)
    lon: number;  // degrees (WGS84)
    alt?: number; // meters AMSL
    iconUrl?: string;
    clampToGround?: boolean;
};

export interface GlobePort {
    mount: (el: HTMLDivElement) => Promise<void>;
    unmount: () => void;

    upsertUnit: (u: UnitRenderable) => void;
    removeUnit: (id: string) => void;

    flyToLatLon: (lon: number, lat: number, height?: number) => void;

    // Keep Promise<void> to match current callers
    setExaggeration: (factor: number, pivot?: number) => Promise<void>;
    setBaseLayer: (key: string) => void;
    setTerrainKey: (key: "world" | "flat") => Promise<void>;
}

/* --- CRS helpers --- */
const wgs84 = "EPSG:4326";
const merc = "EPSG:3857";

export function toWgs84(lon3857: number, lat3857: number) {
    const [lon, lat] = proj4(merc, wgs84, [lon3857, lat3857]);
    return { lon, lat };
}

/* --- Terrain height sampling --- */
export async function sampleHeight(viewer: Viewer, lon: number, lat: number) {
    const c = Cesium.Cartographic.fromDegrees(lon, lat);
    const provider = (viewer.terrain as any).provider;
    const [result] = await sampleTerrainMostDetailed(provider, [c]);
    return result?.height ?? 0;
}

/**
 * Globe Adapter — high-level orchestration layer
 */
export function createGlobeAdapter(): GlobePort {
    let api: GlobeApi | null = null;
    const { providers, getByKey } = makeImageryProviders();

    return {
        /* Mount the 3-D viewer into a DOM element */
        async mount(el) {
            console.log("[GlobeAdapter] Mounting globe...");
            const base =
                getByKey("esriWorldImagery")?.create() ??
                new UrlTemplateImageryProvider({
                    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
                    credit: "\u00A9 OpenStreetMap contributors",
                });

            api = await useGlobe(el, { imageryProvider: base });
            console.log("[GlobeAdapter] Globe mounted.");
        },

        unmount() {
            if (!api) return;
            console.log("[GlobeAdapter] Unmounting globe...");
            api.destroy();
            api = null;
        },

        upsertUnit(u) {
            if (!api) return;
            const ent =
                api.viewer.entities.getById(u.id) ??
                api.viewer.entities.add({ id: u.id });

            ent.position = Cartesian3.fromDegrees(u.lon, u.lat, u.alt ?? 0);

            ent.billboard = u.iconUrl
                ? {
                    image: u.iconUrl,
                    verticalOrigin: VerticalOrigin.BOTTOM,
                    heightReference:
                        u.clampToGround !== false
                            ? HeightReference.CLAMP_TO_GROUND
                            : HeightReference.NONE,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                }
                : undefined;

            ent.label = u.name
                ? {
                    text: u.name,
                    fillColor: Color.WHITE,
                    heightReference:
                        u.clampToGround !== false
                            ? HeightReference.CLAMP_TO_GROUND
                            : HeightReference.NONE,
                }
                : undefined;

            api.viewer.scene.requestRender();
            console.log(`[GlobeAdapter] upsertUnit: ${u.id}`);
        },

        removeUnit(id) {
            api?.viewer.entities.removeById(id);
            api?.viewer.scene.requestRender();
            console.log(`[GlobeAdapter] removeUnit: ${id}`);
        },

        flyToLatLon(lon, lat, height = 120000) {
            if (!api) return;
            api.viewer.camera.flyTo({
                destination: Cartesian3.fromDegrees(lon, lat, height),
                duration: 1.0,
            });
            console.log(
                `[GlobeAdapter] flyTo → (${lat.toFixed(3)}, ${lon.toFixed(3)})`
            );
        },

        // IMPORTANT: delegate to useGlobe's runtime/rebuild logic
        async setExaggeration(factor: number) {
            if (!api) return;
            await api.setExaggeration(factor);
            console.log(`[GlobeAdapter] setExaggeration(${factor})`);
        },

        setBaseLayer(key: string) {
            if (!api) return;
            const entry = getByKey(key);
            if (!entry) {
                console.warn(`[GlobeAdapter] Imagery key not found: ${key}`);
                return;
            }
            api.setImageryProvider(entry.create());
            console.log(`[GlobeAdapter] Base layer → ${key}`);
        },

        // IMPORTANT: no terrainConfig here — use the single source of truth in useGlobe
        async setTerrainKey(key: "world" | "flat") {
            if (!api) return;
            await api.setElevationEnabled(key === "world");
            console.log(`[GlobeAdapter] Terrain set → ${key}`);
        },
    };
}
