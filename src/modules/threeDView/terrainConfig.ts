// terrainConfig.ts
import { Terrain, EllipsoidTerrainProvider, Ion } from "cesium";

export async function makeDefaultTerrain(key: "world" | "flat"): Promise<Terrain> {
    if (key === "flat") return new Terrain(new EllipsoidTerrainProvider());

    if (!Ion.defaultAccessToken) {
        console.warn("[terrainConfig] No Ion token — using FLAT terrain.");
        return new Terrain(new EllipsoidTerrainProvider());
    }
    try {
        console.log("[terrainConfig] Loading Cesium World Terrain...");
        const t = await Terrain.fromWorldTerrain({ requestVertexNormals: true });
        console.log("[terrainConfig] Cesium World Terrain ready.");
        return t;
    } catch (e) {
        console.warn("[terrainConfig] Failed to load World Terrain → FLAT.", e);
        return new Terrain(new EllipsoidTerrainProvider());
    }
}
