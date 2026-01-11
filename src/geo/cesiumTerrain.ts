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
 * Create a Terrain instance.
 * If disabled or world terrain is unavailable, returns an ellipsoid terrain.
 */
export function createTerrain(enabled: boolean, requestVertexNormals = true): Terrain {
  if (!enabled) return new Terrain(new EllipsoidTerrainProvider());

  try {
    // NOTE: In your current Cesium build this appears to be usable synchronously.
    // If it ever becomes Promise-based, we can adapt without changing callers.
    return Terrain.fromWorldTerrain({ requestVertexNormals });
  } catch {
    console.warn("[cesiumTerrain] World terrain unavailable; using ellipsoid");
    return new Terrain(new EllipsoidTerrainProvider());
  }
}

/**
 * Keep Cesium internal references aligned after swapping viewer.terrain.
 */
export function syncTerrainProviderReferences(viewer: Viewer, terrain?: any) {
    const t: any = terrain ?? (viewer as any).terrain;
    const provider = t?.provider;

    // Critical: do NOT overwrite anything with null/undefined
    // Terrain.provider is not valid until Terrain.readyEvent fires. :contentReference[oaicite:1]{index=1}
    if (!provider) return;

    // Optional: keep a legacy alias if any code reads viewer.terrainProvider
    (viewer as any).terrainProvider = provider;

    // Do NOT set these. Cesium manages them internally; forcing null breaks globe rendering.
    // (viewer.scene as any).terrainProvider = provider;
    // (viewer.scene.globe as any).terrainProvider = provider;
}

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
