// src/modules/threeDView/3dUrban/osmBuildingsLayer.ts
import * as Cesium from "cesium";
import type { Viewer, Cesium3DTileset } from "cesium";

// Import your terrain factory so we can sample "world" vs the currently active terrain.
import { createTerrainForKey } from "@/modules/threeDView/hydrography/terrain";
import type { TerrainKey } from "@/modules/threeDView/hydrography/types";

function makePlausibleOsmMaterialStyle() {
    // Special-character property access MUST use ${['...']} form.
    const H = "${['cesium#estimatedHeight']}";
    const CC = "${['cesium#color']}";

    const BCOL = "${['building:colour']}";
    const RCOL = "${['roof:colour']}";
    const BMAT = "${['building:material']}";
    const RMAT = "${['roof:material']}";

    return new Cesium.Cesium3DTileStyle({
        color: {
            conditions: [
                // Prefer explicit OSM colors if present
                [`${BCOL} !== undefined && ${BCOL} !== null && ${BCOL} !== ''`, `color(${BCOL}, 0.95)`],
                [`${RCOL} !== undefined && ${RCOL} !== null && ${RCOL} !== ''`, `color(${RCOL}, 0.95)`],

                // If Cesium provides a derived color, use it
                [`${CC} !== undefined && ${CC} !== null && ${CC} !== ''`, `color(${CC}, 0.95)`],

                // Material heuristics (only useful if those props exist in the tileset)
                [`${BMAT} === 'glass'`, `color('#8fb4ff', 0.55)`],
                [`${BMAT} === 'brick'`, `color('#b05a4a', 0.95)`],
                [`${BMAT} === 'concrete'`, `color('#b9b9b9', 0.95)`],
                [`${BMAT} === 'stone'`, `color('#c8c1b3', 0.95)`],
                [`${BMAT} === 'wood'`, `color('#a2774f', 0.95)`],
                [`${BMAT} === 'metal'`, `color('#9aa3ad', 0.90)`],
                [`${BMAT} === 'plaster' || ${BMAT} === 'stucco'`, `color('#e7e1d7', 0.95)`],

                // Height-based global fallback
                [`${H} >= 150`, `color('#9aa0a6', 0.92)`],
                [`${H} >= 60`, `color('#b0b4b8', 0.92)`],
                [`${H} >= 20`, `color('#c7c3bb', 0.92)`],

                ["true", `color('#d6d1c8', 0.92)`],
            ],
        },
    });
}



export type OsmBuildingsPerfPresetId = "gpu8gb" | "gpu16gb" | "ultra";

export type OsmBuildingsPerfPreset = {
    id: OsmBuildingsPerfPresetId;
    label: string;

    maximumScreenSpaceError: number;

    cacheBytes: number;
    maximumCacheOverflowBytes: number;

    maximumNumberOfLoadedTiles: number;

    foveatedScreenSpaceError: boolean;
    foveatedTimeDelay: number;
    cullRequestsWhileMoving: boolean;
    dynamicScreenSpaceError: boolean;

    preloadWhenHidden: boolean;
};

const GiB = 1024 * 1024 * 1024;

export const OSM_BUILDINGS_PRESETS: Record<OsmBuildingsPerfPresetId, OsmBuildingsPerfPreset> = {
    gpu8gb: {
        id: "gpu8gb",
        label: "8GB (Balanced)",
        maximumScreenSpaceError: 8,

        cacheBytes: 2 * GiB,
        maximumCacheOverflowBytes: 1 * GiB,
        maximumNumberOfLoadedTiles: 12000,

        foveatedScreenSpaceError: false,
        foveatedTimeDelay: 0.0,
        cullRequestsWhileMoving: false,
        dynamicScreenSpaceError: false,

        preloadWhenHidden: false,
    },

    gpu16gb: {
        id: "gpu16gb",
        label: "16GB (Aggressive)",
        maximumScreenSpaceError: 4,

        cacheBytes: 4 * GiB,
        maximumCacheOverflowBytes: 2 * GiB,
        maximumNumberOfLoadedTiles: 20000,

        foveatedScreenSpaceError: false,
        foveatedTimeDelay: 0.0,
        cullRequestsWhileMoving: false,
        dynamicScreenSpaceError: false,

        preloadWhenHidden: false,
    },

    ultra: {
        id: "ultra",
        label: "Ultra (Risky)",
        maximumScreenSpaceError: 2,

        cacheBytes: 6 * GiB,
        maximumCacheOverflowBytes: 3 * GiB,
        maximumNumberOfLoadedTiles: 30000,

        foveatedScreenSpaceError: false,
        foveatedTimeDelay: 0.0,
        cullRequestsWhileMoving: false,
        dynamicScreenSpaceError: false,

        preloadWhenHidden: false,
    },
};

export type OsmBuildingsLayerHandle = {
    enable: () => Promise<void>;
    disable: (dispose?: boolean) => void;

    // Appearance
    setOpacity: (alpha01: number) => void;

    // Perf presets
    setPerfPreset: (presetId: OsmBuildingsPerfPresetId) => void;
    getPerfPreset: () => OsmBuildingsPerfPresetId;

    // Advanced tuning
    setMaximumScreenSpaceError: (sse: number) => void;
    setCacheBytes: (bytes: number) => void;
    setMaximumCacheOverflowBytes: (bytes: number) => void;
    setMaximumNumberOfLoadedTiles: (count: number) => void;

    setFoveatedScreenSpaceError: (enabled: boolean) => void;
    setFoveatedTimeDelay: (seconds: number) => void;
    setCullRequestsWhileMoving: (enabled: boolean) => void;
    setDynamicScreenSpaceError: (enabled: boolean) => void;
    setPreloadWhenHidden: (enabled: boolean) => void;

    // Bathymetry / datum compensation
    setAutoDatumCompensationEnabled: (enabled: boolean) => void;
    isAutoDatumCompensationEnabled: () => boolean;
    recomputeDatumCompensationNow: () => Promise<void>;

    isEnabled: () => boolean;
    getTileset: () => Cesium3DTileset | null;
};

export type OsmBuildingsLayerOptions = {
    keepLoaded?: boolean;
    defaultOpacity?: number;

    perfPreset?: OsmBuildingsPerfPresetId;

    // If true, re-align buildings vertically when the active terrain differs from world terrain (e.g. bathymetry)
    autoDatumCompensation?: boolean;

    // Recompute offset no more often than this (ms) on moveEnd
    datumCompensationMinIntervalMs?: number;
};

function clamp01(x: number) {
    return Math.max(0, Math.min(1, x));
}

function clamp(x: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, x));
}

function getCreateOsmFn(): null | ((opts?: any) => any) {
    const anyCesium = Cesium as any;
    if (typeof anyCesium.createOsmBuildingsAsync === "function") return anyCesium.createOsmBuildingsAsync;
    if (typeof anyCesium.createOsmBuildings === "function") return anyCesium.createOsmBuildings;
    return null;
}

function getSampleMostDetailedFn(): null | ((provider: any, positions: any[]) => Promise<any[]>) {
    const anyCesium = Cesium as any;
    if (typeof anyCesium.sampleTerrainMostDetailed === "function") return anyCesium.sampleTerrainMostDetailed;
    return null;
}

function getActiveTerrainProvider(viewer: Viewer): any | null {
    // Your codebase uses the newer Terrain wrapper in places; tolerate both.
    const anyViewer = viewer as any;
    if (anyViewer.terrain?.provider) return anyViewer.terrain.provider;
    if ((viewer as any).terrainProvider) return (viewer as any).terrainProvider;
    if ((viewer.scene as any).terrainProvider) return (viewer.scene as any).terrainProvider;
    return null;
}

export function createOsmBuildingsLayer(viewer: Viewer, opts?: OsmBuildingsLayerOptions): OsmBuildingsLayerHandle {
    const keepLoaded = opts?.keepLoaded ?? true;

    let tileset: Cesium3DTileset | null = null;
    let enablePromise: Promise<void> | null = null;

    // Appearance
    let opacity = clamp01(opts?.defaultOpacity ?? 1.0);

    // Preset + tuning values
    let presetId: OsmBuildingsPerfPresetId = opts?.perfPreset ?? "gpu8gb";
    let preset = OSM_BUILDINGS_PRESETS[presetId];

    let maximumScreenSpaceError = preset.maximumScreenSpaceError;

    let cacheBytes = preset.cacheBytes;
    let maximumCacheOverflowBytes = preset.maximumCacheOverflowBytes;
    let maximumNumberOfLoadedTiles = preset.maximumNumberOfLoadedTiles;

    let foveatedScreenSpaceError = preset.foveatedScreenSpaceError;
    let foveatedTimeDelay = preset.foveatedTimeDelay;
    let cullRequestsWhileMoving = preset.cullRequestsWhileMoving;
    let dynamicScreenSpaceError = preset.dynamicScreenSpaceError;

    let preloadWhenHidden = preset.preloadWhenHidden;

    // Datum compensation
    let autoDatumComp = opts?.autoDatumCompensation ?? true;
    const minIntervalMs = Math.max(250, opts?.datumCompensationMinIntervalMs ?? 1500);

    // We create and retain a world terrain instance for sampling, independent of the active terrain.
    // (This is the key: compare world vs active to get the differential.)
    const worldTerrain = createTerrainForKey("world" as TerrainKey, true);

    let lastCompMs = 0;
    // Datum compensation smoothing + guardrails (module-scope inside createOsmBuildingsLayer)
    let smoothedHeightOffsetMeters = 0;

    // 0..1: higher = responds faster, lower = smoother
    const datumCompSmoothingAlpha = 0.25;

    // Reject absurd deltas (protects from occasional deep-ocean samples near coasts)
    const datumCompMaxAbsDeltaMeters = 2500;

    // Ignore tiny noise (meters)
    const datumCompMinChangeMeters = 0.10;

    let moveEndListenerAttached = false;

    // Remember base modelMatrix so we can reapply offsets cleanly.
    let baseModelMatrix: Cesium.Matrix4 | null = null;
    let currentHeightOffsetMeters = 0;

    function applyStyle() {
        if (!tileset) return;

        // NOTE: This uniform style overrides native per-building colors.
        // If/when you want “native colors”, remove tileset.style usage and implement opacity via shader.
        if (opacity >= 0.999) {
            tileset.style = undefined;
            return;
        }

        tileset.style = new Cesium.Cesium3DTileStyle({
            color: `color('white', ${opacity.toFixed(4)})`,
        });
    }

    function applyQualityAndCache() {
        if (!tileset) return;

        tileset.maximumScreenSpaceError = clamp(maximumScreenSpaceError, 1, 64);

        tileset.cacheBytes = Math.max(0, cacheBytes | 0);
        (tileset as any).maximumCacheOverflowBytes = Math.max(0, maximumCacheOverflowBytes | 0);

        (tileset as any).maximumNumberOfLoadedTiles = Math.max(0, maximumNumberOfLoadedTiles | 0);

        (tileset as any).foveatedScreenSpaceError = !!foveatedScreenSpaceError;
        (tileset as any).foveatedTimeDelay = Math.max(0, Number(foveatedTimeDelay) || 0);

        (tileset as any).cullRequestsWhileMoving = !!cullRequestsWhileMoving;
        (tileset as any).dynamicScreenSpaceError = !!dynamicScreenSpaceError;

        (tileset as any).preloadWhenHidden = !!preloadWhenHidden;
    }

    function applyHeightOffsetMeters(offsetMeters: number) {
        currentHeightOffsetMeters = Number.isFinite(offsetMeters) ? offsetMeters : 0;

        if (!tileset) return;

        if (!baseModelMatrix) {
            // Snapshot the "true" base on first use
            baseModelMatrix = Cesium.Matrix4.clone(tileset.modelMatrix, new Cesium.Matrix4());
        }

        // Translate along local "up" (surface normal) at the tileset’s center.
        const center = tileset.boundingSphere?.center;
        if (!center) return;

        const up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(center, new Cesium.Cartesian3());
        const translation = Cesium.Cartesian3.multiplyByScalar(up, currentHeightOffsetMeters, new Cesium.Cartesian3());
        const tMat = Cesium.Matrix4.fromTranslation(translation, new Cesium.Matrix4());

        const out = new Cesium.Matrix4();
        Cesium.Matrix4.multiply(baseModelMatrix, tMat, out);
        tileset.modelMatrix = out;

        viewer.scene.requestRender();
    }

    async function sampleHeight(provider: any, carto: Cesium.Cartographic): Promise<number | null> {
        const sampleMostDetailed = getSampleMostDetailedFn();
        if (!sampleMostDetailed || !provider) return null;

        const pos = new Cesium.Cartographic(carto.longitude, carto.latitude, carto.height);
        try {
            const res = await sampleMostDetailed(provider, [pos]);
            const h = res?.[0]?.height;
            return Number.isFinite(h) ? h : null;
        } catch {
            return null;
        }
    }

    function pickCartographicAtScreen(viewer: Viewer, x: number, y: number): Cesium.Cartographic | null {
        const scene = viewer.scene;
        const ray = viewer.camera.getPickRay(new Cesium.Cartesian2(x, y));
        if (!ray) return null;

        // Terrain-aware intersection (when terrain is available/loaded)
        const hit = scene.globe.pick(ray, scene);
        if (!hit) return null;

        return Cesium.Cartographic.fromCartesian(hit);
    }


    function getReferenceCartographics(): Cesium.Cartographic[] {
        const scene = viewer.scene;
        const canvas = scene.canvas;

        const w = (canvas as any).clientWidth || canvas.width;
        const h = (canvas as any).clientHeight || canvas.height;
        if (!w || !h) return [];

        const cx = w * 0.5;
        const cy = h * 0.5;

        // Grid spacing: tune 0.10–0.18 depending on how “wide” you want the anchor.
        const d = Math.min(w, h) * 0.12;

        // 3×3 grid centered on screen
        const xs = [cx - d, cx, cx + d];
        const ys = [cy - d, cy, cy + d];

        const out: Cesium.Cartographic[] = [];
        for (const y of ys) {
            for (const x of xs) {
                const c = pickCartographicAtScreen(viewer, x, y);
                if (!c) continue;
                // Only lon/lat matter for terrain sampling; zero height for cleanliness.
                out.push(new Cesium.Cartographic(c.longitude, c.latitude, 0));
            }
        }

        return out;
    }



    function median(values: number[]): number {
        const a = values.slice().sort((x, y) => x - y);
        const n = a.length;
        if (n === 0) return 0;
        const mid = Math.floor(n / 2);
        return n % 2 ? a[mid] : (a[mid - 1] + a[mid]) * 0.5;
    }

    async function recomputeDatumCompensationNow(): Promise<void> {
        if (!autoDatumComp || !tileset) return;

        const refs = getReferenceCartographics();
        if (refs.length === 0) return;

        const activeProvider = getActiveTerrainProvider(viewer);
        const worldProvider = (worldTerrain as any)?.provider;
        const sampleMostDetailed = getSampleMostDetailedFn();

        if (!activeProvider || !worldProvider || !sampleMostDetailed) return;

        // sampleTerrainMostDetailed mutates the passed positions array in-place, so clone for each provider.
        const activePositions = refs.map(c => new Cesium.Cartographic(c.longitude, c.latitude, 0));
        const worldPositions = refs.map(c => new Cesium.Cartographic(c.longitude, c.latitude, 0));

        let activeSamples: Cesium.Cartographic[];
        let worldSamples: Cesium.Cartographic[];

        try {
            [activeSamples, worldSamples] = await Promise.all([
                sampleMostDetailed(activeProvider, activePositions),
                sampleMostDetailed(worldProvider, worldPositions),
            ]);
        } catch {
            return;
        }

        const n = Math.min(activeSamples?.length ?? 0, worldSamples?.length ?? 0);
        if (n === 0) return;

        // Collect valid deltas and heights
        const records: Array<{ hA: number; hW: number; delta: number }> = [];
        for (let i = 0; i < n; i++) {
            const hA = (activeSamples[i] as any)?.height;
            const hW = (worldSamples[i] as any)?.height;
            if (!Number.isFinite(hA) || !Number.isFinite(hW)) continue;
            const delta = hA - hW;
            if (!Number.isFinite(delta)) continue;
            if (Math.abs(delta) > datumCompMaxAbsDeltaMeters) continue; // reject absurd
            records.push({ hA, hW, delta });
        }

        if (records.length === 0) return;

        // Land bias: pick the points with the highest active terrain height (tends to be land over water)
        records.sort((a, b) => b.hA - a.hA);

        const topK = records.slice(0, Math.min(3, records.length)); // top 3
        const robustDelta = median(topK.map(r => r.delta));

        // Smooth to avoid coastline jitter
        const nextSmoothed =
            smoothedHeightOffsetMeters * (1 - datumCompSmoothingAlpha) +
            robustDelta * datumCompSmoothingAlpha;

        if (Math.abs(nextSmoothed - currentHeightOffsetMeters) < datumCompMinChangeMeters) return;

        smoothedHeightOffsetMeters = nextSmoothed;
        applyHeightOffsetMeters(smoothedHeightOffsetMeters);
    }


    function attachMoveEndListenerOnce() {
        if (moveEndListenerAttached) return;
        moveEndListenerAttached = true;

        viewer.camera.moveEnd.addEventListener(() => {
            if (!autoDatumComp || !tileset) return;

            const now = Date.now();
            if (now - lastCompMs < minIntervalMs) return;
            lastCompMs = now;

            // Datum compensation smoothing
            let smoothedHeightOffsetMeters = 0;


            void recomputeDatumCompensationNow();
        });
    }

    async function ensureLoadedAndAdded() {
        if (tileset) return;

        const createFn = getCreateOsmFn();
        if (!createFn) {
            throw new Error("Cesium OSM Buildings API not found. Expected Cesium.createOsmBuildingsAsync/createOsmBuildings.");
        }

        const tilesetOptions: any = {
            maximumScreenSpaceError,

            cacheBytes,
            maximumCacheOverflowBytes,
            maximumNumberOfLoadedTiles,

            foveatedScreenSpaceError,
            foveatedTimeDelay,
            cullRequestsWhileMoving,
            dynamicScreenSpaceError,

            preloadWhenHidden,
        };

        const created = await Promise.resolve(createFn(tilesetOptions));
        if (!created) {
            throw new Error("Cesium OSM Buildings creation returned null/undefined (tileset was not created).");
        }

        tileset = created as Cesium3DTileset;
        tileset.style = makePlausibleOsmMaterialStyle();

        // Apply perf/cache and styling.
        applyQualityAndCache();
        applyStyle();

        // Snapshot baseModelMatrix now (pre-offset)
        baseModelMatrix = Cesium.Matrix4.clone(tileset.modelMatrix, new Cesium.Matrix4());

        viewer.scene.primitives.add(tileset);
        tileset.show = true;

        // If enabled, compute initial delta alignment and set up moveEnd refresh.
        if (autoDatumComp) {
            attachMoveEndListenerOnce();
            // small delay helps ensure active terrain can be sampled (tiles begin loading after setTerrain)
            setTimeout(() => void recomputeDatumCompensationNow(), 250);
        }

        viewer.scene.requestRender();
    }

    let plausiblePaintEnabled = true;

    function applyOsmPaintStyle() {
        if (!tileset) return;
        tileset.style = plausiblePaintEnabled ? makePlausibleOsmMaterialStyle() : undefined;
        viewer.scene.requestRender();
    }

    function applyPreset(nextId: OsmBuildingsPerfPresetId) {
        presetId = nextId;
        preset = OSM_BUILDINGS_PRESETS[presetId];

        maximumScreenSpaceError = preset.maximumScreenSpaceError;

        cacheBytes = preset.cacheBytes;
        maximumCacheOverflowBytes = preset.maximumCacheOverflowBytes;
        maximumNumberOfLoadedTiles = preset.maximumNumberOfLoadedTiles;

        foveatedScreenSpaceError = preset.foveatedScreenSpaceError;
        foveatedTimeDelay = preset.foveatedTimeDelay;
        cullRequestsWhileMoving = preset.cullRequestsWhileMoving;
        dynamicScreenSpaceError = preset.dynamicScreenSpaceError;

        preloadWhenHidden = preset.preloadWhenHidden;

        applyQualityAndCache();
        viewer.scene.requestRender();
    }

    return {
        enable: async () => {
            if (enablePromise) return enablePromise;

            enablePromise = (async () => {
                await ensureLoadedAndAdded();
                if (tileset) {
                    tileset.show = true;
                    viewer.scene.requestRender();

                    // Refresh alignment on enable (useful after terrain toggles)
                    if (autoDatumComp) {
                        attachMoveEndListenerOnce();
                        await recomputeDatumCompensationNow();
                    }
                }
            })().finally(() => {
                enablePromise = null;
            });

            return enablePromise;
        },

        disable: (dispose?: boolean) => {
            if (!tileset) return;

            const doDispose = dispose ?? !keepLoaded;

            if (!doDispose) {
                tileset.show = false;
                viewer.scene.requestRender();
                return;
            }

            try {
                viewer.scene.primitives.remove(tileset);
            } catch {
                // ignore
            }
            try {
                tileset.destroy();
            } catch {
                // ignore
            }

            tileset = null;
            baseModelMatrix = null;
            currentHeightOffsetMeters = 0;

            viewer.scene.requestRender();
        },

        setOpacity: (a) => {
            opacity = clamp01(a);
            applyStyle();
            viewer.scene.requestRender();
        },

        setPerfPreset: (id) => applyPreset(id),
        getPerfPreset: () => presetId,

        setMaximumScreenSpaceError: (sse) => {
            maximumScreenSpaceError = clamp(Number(sse) || 16, 1, 64);
            applyQualityAndCache();
            viewer.scene.requestRender();
        },

        setCacheBytes: (bytes) => {
            cacheBytes = Math.max(0, Number(bytes) || 0);
            applyQualityAndCache();
            viewer.scene.requestRender();
        },

        setMaximumCacheOverflowBytes: (bytes) => {
            maximumCacheOverflowBytes = Math.max(0, Number(bytes) || 0);
            applyQualityAndCache();
            viewer.scene.requestRender();
        },

        setMaximumNumberOfLoadedTiles: (count) => {
            maximumNumberOfLoadedTiles = Math.max(0, (Number(count) || 0) | 0);
            applyQualityAndCache();
            viewer.scene.requestRender();
        },

        setFoveatedScreenSpaceError: (enabled) => {
            foveatedScreenSpaceError = !!enabled;
            applyQualityAndCache();
            viewer.scene.requestRender();
        },

        setFoveatedTimeDelay: (seconds) => {
            foveatedTimeDelay = Math.max(0, Number(seconds) || 0);
            applyQualityAndCache();
            viewer.scene.requestRender();
        },

        setCullRequestsWhileMoving: (enabled) => {
            cullRequestsWhileMoving = !!enabled;
            applyQualityAndCache();
            viewer.scene.requestRender();
        },

        setDynamicScreenSpaceError: (enabled) => {
            dynamicScreenSpaceError = !!enabled;
            applyQualityAndCache();
            viewer.scene.requestRender();
        },

        setPreloadWhenHidden: (enabled) => {
            preloadWhenHidden = !!enabled;
            applyQualityAndCache();
            viewer.scene.requestRender();
        },

        setAutoDatumCompensationEnabled: (enabled) => {
            autoDatumComp = !!enabled;
            if (autoDatumComp) {
                attachMoveEndListenerOnce();
                void recomputeDatumCompensationNow();
            } else {
                // Reset to base (remove offset)
                applyHeightOffsetMeters(0);
            }
            viewer.scene.requestRender();
        },

        isAutoDatumCompensationEnabled: () => autoDatumComp,
        recomputeDatumCompensationNow,

        isEnabled: () => !!tileset?.show,
        getTileset: () => tileset,
    };
}
