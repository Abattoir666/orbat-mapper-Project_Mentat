// src/modules/threeDView/hydrography/experimental/splitTerrain/types.ts
import type { Viewer } from "cesium";

export type SplitTerrainMode = "off" | "on";

export type SplitTerrainCompositorOptions = {
    topViewer: Viewer;
    oceanGeoJsonUrl: string;   // e.g. OCEAN_GEOJSON_URL
    maxFps?: number;           // default 30
    debugShowMask?: boolean;   // default false
};

export type SplitTerrainCompositorHandle = {
    enable: () => Promise<void>;
    disable: () => void;
    destroy: () => void;
};
