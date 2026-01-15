/* eslint-disable @typescript-eslint/no-explicit-any */
// src/geo/cesiumTerrain.ts

import { Ion, Terrain, EllipsoidTerrainProvider, type Viewer } from "cesium";

/**
 * Initialize Cesium Ion token from Vite env.
 * Safe to call multiple times.
 */
export function initCesiumIonFromEnv() {
    Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN || "";
}

export function hasCesiumIonToken(): boolean {
    return !!Ion.defaultAccessToken;
}

/**
 * Terrain keys supported by Mentat.
 * - flat: ellipsoid (no elevation)
 * - world: Cesium World Terrain
 * - bathy: Cesium World Bathymetry (includes land+seafloor)
 */
export type TerrainKey = "flat" | "world" | "bathy";

/**
 * Set scene vertical exaggeration if supported by this Cesium build.
 */
export function setSceneVerticalExaggeration(scene: any, exag: number) {
    try {
        scene.verticalExaggeration = Math.max(0, exag || 0);
        scene.verticalExaggerationRelativeHeight = 0;
    } catch {
        // ignore; some Cesium builds don't support runtime exaggeration
    }
}

export function runtimeExagSupported(scene: any): boolean {
    return "verticalExaggeration" in scene && "verticalExaggerationRelativeHeight" in scene;
}

/**
 * Create a Terrain instance for a given key.
 * Uses try/catch so Mentat degrades gracefully if a Cesium build lacks the API.
 */
export function createTerrainForKey(
    key: TerrainKey,
    requestVertexNormals = true
): Terrain {
    if (key === "flat") return new Terrain(new EllipsoidTerrainProvider());

    if (key === "world") {
        try {
            return Terrain.fromWorldTerrain({ requestVertexNormals });
        } catch {
            console.warn("[cesiumTerrain] World terrain unavailable; using ellipsoid");
            return new Terrain(new EllipsoidTerrainProvider());
        }
    }

    // Bathymetry requires an Ion token; without it, requests can fail and leave the globe black.
    if (!hasCesiumIonToken()) {
        console.warn("[cesiumTerrain] No Cesium ion token; falling back to world terrain (bathymetry unavailable).");
        try {
            return Terrain.fromWorldTerrain({ requestVertexNormals });
        } catch {
            return new Terrain(new EllipsoidTerrainProvider());
        }
    }

    // key === "bathy"
    try {
        // CesiumJS exposes Terrain.fromWorldBathymetry in modern builds. :contentReference[oaicite:1]{index=1}
        return (Terrain as any).fromWorldBathymetry({ requestVertexNormals }) as Terrain;
    } catch {
        console.warn("[cesiumTerrain] Bathymetry terrain unavailable; falling back to world terrain");
        try {
            return Terrain.fromWorldTerrain({ requestVertexNormals });
        } catch {
            return new Terrain(new EllipsoidTerrainProvider());
        }
    }
}

/**
 * Back-compat helper (existing callers).
 */
export function createTerrain(enabled: boolean, requestVertexNormals = true): Terrain {
    return enabled ? createTerrainForKey("world", requestVertexNormals) : createTerrainForKey("flat", requestVertexNormals);
}

/**
 * Keep Cesium internal references aligned after swapping viewer.terrain.
 */
export function syncTerrainProviderReferences(viewer: Viewer, terrain?: Terrain) {
    // Prefer the explicitly provided Terrain (important when using scene.setTerrain)
    const t = terrain ?? (viewer as any).terrain;
    const provider = (t as any)?.provider ?? null;

    (viewer as any).terrainProvider = provider;
    (viewer.scene as any).terrainProvider = provider;
    (viewer.scene.globe as any).terrainProvider = provider;
}
