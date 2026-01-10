// src/geo/surfaceHeightCesium.ts
import {
    Cartographic,
    EllipsoidTerrainProvider,
    Ion,
    Terrain,
    sampleTerrainMostDetailed,
} from "cesium";

// Cache sampled heights by rounded lon/lat key
const heightCache = new Map<string, number>();
const inFlight = new Map<string, Promise<number | undefined>>();

let terrainPromise: Promise<Terrain> | null = null;
let terrainResolved: Terrain | null = null;

function keyFor(lon: number, lat: number) {
    // 1e-5 deg ~ 1.1m at equator; tune as needed
    return `${lon.toFixed(5)},${lat.toFixed(5)}`;
}

async function getTerrain(): Promise<Terrain> {
    if (terrainResolved) return terrainResolved;
    if (!terrainPromise) {
        terrainPromise = (async () => {
            // If no Ion token, fall back to flat ellipsoid (height ~ 0)
            if (!Ion.defaultAccessToken) {
                return new Terrain(new EllipsoidTerrainProvider());
            }
            try {
                // World terrain provides land elevation; ocean/bathymetry depends on dataset coverage
                return await Terrain.fromWorldTerrain({ requestVertexNormals: false });
            } catch {
                return new Terrain(new EllipsoidTerrainProvider());
            }
        })();
    }
    terrainResolved = await terrainPromise;
    return terrainResolved;
}

/**
 * Samples "surface height" at lon/lat, in meters relative to Cesium's ellipsoid datum.
 * Returns undefined if sampling is unavailable or fails.
 */
export async function sampleSurfaceHeightMetersCesium(
    lon: number,
    lat: number,
): Promise<number | undefined> {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return undefined;

    const k = keyFor(lon, lat);
    const cached = heightCache.get(k);
    if (cached !== undefined) return cached;

    const inflight = inFlight.get(k);
    if (inflight) return inflight;

    const p = (async () => {
        try {
            const terrain = await getTerrain();
            const provider = (terrain as any)?.provider ?? new EllipsoidTerrainProvider();

            const carto = Cartographic.fromDegrees(lon, lat);

            // For ellipsoid provider this should effectively return 0; for world terrain, real heights.
            const sampled = await sampleTerrainMostDetailed(provider, [carto]);
            const h = sampled?.[0]?.height;

            if (typeof h === "number" && Number.isFinite(h)) {
                heightCache.set(k, h);
                return h;
            }
            return undefined;
        } catch {
            return undefined;
        } finally {
            inFlight.delete(k);
        }
    })();

    inFlight.set(k, p);
    return p;
}

// Optional: allow callers to clear caches if needed
export function clearSurfaceHeightCesiumCache() {
    heightCache.clear();
    inFlight.clear();
}
