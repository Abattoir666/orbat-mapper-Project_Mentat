/* eslint-disable @typescript-eslint/no-explicit-any */
// src/modules/threeDView/hydrography/terrain.ts

import { Terrain } from "cesium";
import { createTerrain, hasCesiumIonToken } from "@/geo/cesiumTerrain";
import type { TerrainKey } from "./types";

/**
 * Synchronous factory for the terrain you want.
 * - flat/world use your existing createTerrain helper.
 * - bathymetry uses Cesium Terrain.fromWorldBathymetry() when available; otherwise falls back.
 */
export function createTerrainForKey(key: TerrainKey, requestVertexNormals = true): Terrain {
    switch (key) {
        case "flat":
            return createTerrain(false, requestVertexNormals);

        case "world":
            return createTerrain(true, requestVertexNormals);

        case "bathymetry": {
            if (!hasCesiumIonToken()) {
                console.warn("[hydrography] No Cesium ion token; falling back to flat terrain.");
                return createTerrain(false, requestVertexNormals);
            }

            const anyTerrain: any = Terrain;
            if (typeof anyTerrain.fromWorldBathymetry === "function") {
                try {
                    return anyTerrain.fromWorldBathymetry({ requestVertexNormals });
                } catch (e) {
                    console.warn("[hydrography] fromWorldBathymetry failed; falling back to world terrain.", e);
                    return createTerrain(true, requestVertexNormals);
                }
            }

            console.warn("[hydrography] fromWorldBathymetry not available; falling back to world terrain.");
            return createTerrain(true, requestVertexNormals);
        }
    }
}
