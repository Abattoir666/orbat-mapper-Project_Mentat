/* eslint-disable @typescript-eslint/no-explicit-any */
// src/modules/threeDView/useGlobe.ts
import * as CesiumNS from "cesium";
import {
    Viewer,
    Globe,
    Ellipsoid,
    Color,
    Cartesian2,
    Cartesian3,
    Cartographic,
    ClockRange,
    ImageryProvider,
    OpenStreetMapImageryProvider,
    UrlTemplateImageryProvider,
    WebMercatorTilingScheme,
    Credit,
    JulianDate,
    Clock,
    SceneMode,
    Rectangle,
    BoundingSphere,
    Math as CesiumMath,
    Camera,
    DirectionalLight,
} from "cesium";

import {
    initCesiumIonFromEnv,
    hasCesiumIonToken,
    syncTerrainProviderReferences,
    setSceneVerticalExaggeration,
    runtimeExagSupported,
} from "@/geo/cesiumTerrain";

import { type TerrainKey, createTerrainForKey } from "@/modules/threeDView/bathymetry";

import { sync2DTo3D } from "./sync2DTo3D";
import { parseUnitToRenderable, type Unit } from "./unitparser";
import { weatherSkyController } from "./weatherSkyController";
import { installations } from "./installations";
import { unitMotion } from "./unitMotion";

/* ───────────────────────────── Types ───────────────────────────── */

export type GlobeInitOptions = {
    imageryProvider?: ImageryProvider;

    /**
     * Preferred terrain selector.
     * - "flat": ellipsoid only
     * - "world": Cesium World Terrain (ion)
     * - "bathymetry": Cesium World Bathymetry (ion)
     */
    terrainKey?: TerrainKey;

    /**
     * Legacy: retained for backward compatibility.
     * If terrainKey is provided, terrainKey wins.
     */
    elevationEnabled?: boolean;     // default: true if Ion token is set

    /** Vertical exaggeration factor. 0 is allowed. */
    exaggeration?: number;          // default: 1 if elevation, 0 if not

    /** Enable Cesium globe water effect (water mask shader), if available. */
    waterEffectEnabled?: boolean;
};

export type BaseTemplateOptions = {
    minLevel?: number;
    maxLevel?: number;
    attribution?: string | Credit;
    geographic?: boolean;           // default false (WebMercator)
    subdomains?: string[] | string; // e.g., "abc" or ["a","b","c"]
};

export type GlobeApi = {
    viewer: Viewer;

    // imagery
    setImageryProvider: (p: ImageryProvider) => void;
    setBaseLayerTemplate: (url: string, opts?: BaseTemplateOptions) => void;
    setBaseLayer: (key: string) => void;

    // terrain / elevation / exaggeration
    setTerrainKey: (key: TerrainKey) => Promise<void>;
    setElevationEnabled: (enabled: boolean) => Promise<void>; // legacy
    setExaggeration: (factor: number) => Promise<void>;

    // water
    setWaterEffectEnabled: (enabled: boolean) => void;

    // time
    setTime: (epochMs: number) => void;
    setTimeBounds: (startMs: number, stopMs: number) => void;

    // camera helpers
    flyToLatLon: (
        lon: number,
        lat: number,
        height?: number,
        opts?: { heading?: number; pitch?: number; roll?: number; duration?: number }
    ) => Promise<void>;

    frameFromWebMercator: (
        xMin: number,
        yMin: number,
        xMax: number,
        yMax: number,
        opts?: { duration?: number }
    ) => Promise<void>;

    frameFromScenario2D: () => Promise<boolean>;

    // scene toggles
    enableDayNight: (on: boolean) => void;
    enableSkybox: (on: boolean) => void;

    // camera event
    onCameraChange: (cb: (c: { lon: number; lat: number; height: number; heading: number; pitch: number; roll: number }) => void) => () => void;

    // units
    setUnits: (arr: Unit[]) => void;
    upsertUnit: (u: Unit) => void;
    removeUnit: (id: string) => void;

    // lifecycle
    rebuild: () => Promise<void>;
    destroy: () => void;
};

/* ───────────────────────────── Helpers ───────────────────────────── */

function providerFromTemplate(url: string, opts?: BaseTemplateOptions) {
    const tilingScheme = opts?.geographic ? undefined : new WebMercatorTilingScheme();
    const credit = opts?.attribution ? new Credit(opts.attribution) : undefined;

    return new UrlTemplateImageryProvider({
        url,
        minimumLevel: opts?.minLevel,
        maximumLevel: opts?.maxLevel,
        subdomains: opts?.subdomains,
        tilingScheme,
        credit,
    });
}

function viewRectFromWebMercator(xMin: number, yMin: number, xMax: number, yMax: number): Rectangle {
    const proj = new CesiumNS.WebMercatorProjection();
    const sw = proj.unproject(new Cartesian3(xMin, yMin, 0));
    const ne = proj.unproject(new Cartesian3(xMax, yMax, 0));
    return Rectangle.fromCartographicArray([sw, ne]);
}

/* ───────────────────────────── Main entry point ───────────────────────────── */

export async function useGlobe(
    container: HTMLDivElement,
    opts: GlobeInitOptions = {}
): Promise<GlobeApi> {
    // —— State
    let terrainKey: TerrainKey =
        opts.terrainKey ??
        (typeof opts.elevationEnabled === "boolean"
            ? (opts.elevationEnabled ? "world" : "flat")
            : (hasCesiumIonToken() ? "world" : "flat"));

    // legacy derived value (used by older call sites, logs, and UI)
    let elevationEnabled = terrainKey !== "flat";
    let lastNonFlat: TerrainKey = terrainKey === "flat" ? "world" : terrainKey;

    let waterEffectEnabled =
        typeof opts.waterEffectEnabled === "boolean" ? opts.waterEffectEnabled : false;

    let exag = Math.max(0, opts.exaggeration ?? (elevationEnabled ? 1 : 0));

    // Ensure Ion token is initialized early
    initCesiumIonFromEnv();

    // —— Scene / Globe / Terrain
    function makeGlobe {
        const g = new Globe(Ellipsoid.WGS84);
        g.baseColor = Color.BLACK;
        g.showGroundAtmosphere = false;
        (g as any).showWaterEffect = waterEffectEnabled;
        g.enableLighting = false;
        g.depthTestAgainstTerrain = false;
        return g;
    }

    function makeTerrainNow() {
        return createTerrainForKey(terrainKey, true);
    }

    const defaultOSM = new OpenStreetMapImageryProvider({
        url: "https://tile.openstreetmap.org/",
        credit: "© OpenStreetMap contributors",
    });

    // —— Viewer
    let viewer = new Viewer(container, {
        scene3DOnly: true,
        animation: false,
        timeline: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        navigationHelpButton: false,
        selectionIndicator: false,
        infoBox: false,
        fullscreenButton: false,

        globe: makeGlobe(),
        terrain: makeTerrainNow(),
        imageryProvider: opts.imageryProvider ?? defaultOSM,
    });

    // Patch Cesium quirks: keep provider references in sync after swapping
    syncTerrainProviderReferences(viewer);

    // Set initial exaggeration if supported
    const scene = viewer.scene;
    setSceneVerticalExaggeration(scene, exag);

    // —— Imagery management
    function setImageryProvider(p: ImageryProvider) {
        viewer.imageryLayers.removeAll();
        viewer.imageryLayers.addImageryProvider(p);
        viewer.scene.requestRender();
    }

    function setBaseLayerTemplate(url: string, opts?: BaseTemplateOptions) {
        const p = providerFromTemplate(url, opts);
        setImageryProvider(p);
    }

    function setBaseLayer(key: string) {
        // This is handled elsewhere in your pipeline; keep as-is if you have a registry.
        // If you’re mapping keys to templates, do it in GlobeControls/adapter layers.
        console.log("[useGlobe] setBaseLayer:", key);
    }

    // —— Terrain / Water / Exaggeration
    async function setTerrainKey(key: TerrainKey): Promise<void> {
        terrainKey = key;
        elevationEnabled = terrainKey !== "flat";
        if (terrainKey !== "flat") lastNonFlat = terrainKey;

        viewer.terrain = makeTerrainNow();
        syncTerrainProviderReferences(viewer);

        try { viewer.camera.moveForward(0.001); viewer.camera.moveBackward(0.001); } catch { }
        viewer.scene.requestRender();
        console.log("[useGlobe] Terrain:", terrainKey, "exag(scene):", scene.verticalExaggeration);
    }

    async function setElevationEnabled(enabled: boolean): Promise<void> {
        // legacy behavior: map enabled/disabled to a terrain key
        await setTerrainKey(enabled ? lastNonFlat : "flat");
    }

    function setWaterEffectEnabled(enabled: boolean): void {
        waterEffectEnabled = !!enabled;
        try { (viewer.scene.globe as any).showWaterEffect = waterEffectEnabled; } catch { }
        viewer.scene.requestRender();
        console.log("[useGlobe] Water effect:", waterEffectEnabled);
    }

    async function setExaggeration(factor: number): Promise<void> {
        exag = Math.max(0, factor);

        if (!runtimeExagSupported(scene)) {
            await rebuild();
            console.log("[useGlobe] Exaggeration set (fallback rebuild):", exag);
            return;
        }

        setSceneVerticalExaggeration(scene, exag);

        try { viewer.camera.moveForward(0.001); viewer.camera.moveBackward(0.001); } catch { }
        viewer.scene.requestRender();
        console.log("[useGlobe] Exaggeration set (scene):", exag);
    }

    // —— Camera seed: prefer Scenario 2D map if available
    async function frameFromScenario2D(): Promise<boolean> {
        try {
            return await sync2DTo3D(viewer);
        } catch (e) {
            console.warn("[useGlobe] frameFromScenario2D failed:", e);
            return false;
        }
    }

    async function flyToLatLon(
        lon: number,
        lat: number,
        height: number = 5000,
        opts?: { heading?: number; pitch?: number; roll?: number; duration?: number }
    ): Promise<void> {
        const destination = Cartesian3.fromDegrees(lon, lat, height);
        await viewer.camera.flyTo({
            destination,
            orientation: {
                heading: opts?.heading ?? 0,
                pitch: opts?.pitch ?? (-CesiumMath.PI_OVER_TWO * 0.55),
                roll: opts?.roll ?? 0,
            },
            duration: opts?.duration ?? 0.6,
        });
    }

    async function frameFromWebMercator(
        xMin: number,
        yMin: number,
        xMax: number,
        yMax: number,
        opts?: { duration?: number }
    ) {
        const rect = viewRectFromWebMercator(xMin, yMin, xMax, yMax);
        await viewer.camera.flyTo({
            destination: rect,
            duration: opts?.duration ?? 0.6,
        });
    }

    // —— Time
    const clock = viewer.clock;
    clock.clockRange = ClockRange.CLAMPED;

    function setTime(epochMs: number) {
        const jd = JulianDate.fromDate(new Date(epochMs));
        clock.currentTime = jd;
        viewer.scene.requestRender();
    }

    function setTimeBounds(startMs: number, stopMs: number) {
        clock.startTime = JulianDate.fromDate(new Date(startMs));
        clock.stopTime = JulianDate.fromDate(new Date(stopMs));
        viewer.scene.requestRender();
    }

    // —— Sky / DayNight
    function enableDayNight(on: boolean) {
        viewer.scene.globe.enableLighting = !!on;
        viewer.scene.requestRender();
    }

    function enableSkybox(on: boolean) {
        const s = viewer.scene;
        s.skyBox = on ? new CesiumNS.SkyBox({ sources: (CesiumNS as any).SkyBox?.defaultSources }) : undefined;
        s.sun = on ? new CesiumNS.Sun() : undefined;
        s.moon = on ? new CesiumNS.Moon() : undefined;
        s.requestRender();
    }

    // —— Camera events
    function onCameraChange(cb: (c: { lon: number; lat: number; height: number; heading: number; pitch: number; roll: number }) => void) {
        const camera = viewer.camera;
        const handler = () => {
            const carto = Cartographic.fromCartesian(camera.positionWC);
            cb({
                lon: CesiumMath.toDegrees(carto.longitude),
                lat: CesiumMath.toDegrees(carto.latitude),
                height: carto.height,
                heading: camera.heading,
                pitch: camera.pitch,
                roll: camera.roll,
            });
        };
        camera.changed.addEventListener(handler);
        return () => camera.changed.removeEventListener(handler);
    }

    // —— Units
    const unitsLayer = new CesiumNS.CustomDataSource("units");
    viewer.dataSources.add(unitsLayer);

    function setUnits(arr: Unit[]) {
        unitsLayer.entities.removeAll();
        for (const u of arr) {
            const ent = parseUnitToRenderable(u);
            if (ent) unitsLayer.entities.add(ent);
        }
        viewer.scene.requestRender();
    }

    function upsertUnit(u: Unit) {
        const id = u.id;
        unitsLayer.entities.removeById(id);
        const ent = parseUnitToRenderable(u);
        if (ent) unitsLayer.entities.add(ent);
        viewer.scene.requestRender();
    }

    function removeUnit(id: string) {
        unitsLayer.entities.removeById(id);
        viewer.scene.requestRender();
    }

    // —— rebuild/destroy
    async function rebuild(): Promise<void> {
        const old = viewer;
        const oldContainer = container;

        try { old.destroy(); } catch { }

        viewer = new Viewer(oldContainer, {
            scene3DOnly: true,
            animation: false,
            timeline: false,
            baseLayerPicker: false,
            geocoder: false,
            homeButton: false,
            navigationHelpButton: false,
            selectionIndicator: false,
            infoBox: false,
            fullscreenButton: false,

            globe: makeGlobe(),
            terrain: makeTerrainNow(),
            imageryProvider: defaultOSM,
        });

        syncTerrainProviderReferences(viewer);

        const newScene = viewer.scene;
        setSceneVerticalExaggeration(newScene, exag);

        viewer.scene.requestRender();
        console.log("[useGlobe] Rebuilt viewer");
    }

    function destroy(): void {
        try { viewer.destroy(); } catch { }
    }

    // —— plugin controllers (existing behavior)
    try { weatherSkyController(viewer); } catch { }
    try { installations(viewer); } catch { }
    try { unitMotion(viewer); } catch { }

    const api: GlobeApi = {
        viewer,

        setImageryProvider,
        setBaseLayerTemplate,
        setBaseLayer,

        setTerrainKey,
        setElevationEnabled,
        setExaggeration,

        setWaterEffectEnabled,

        setTime,
        setTimeBounds,

        flyToLatLon,
        frameFromWebMercator,
        frameFromScenario2D,

        enableDayNight,
        enableSkybox,

        onCameraChange,

        setUnits,
        upsertUnit,
        removeUnit,

        rebuild,
        destroy,
    };

    (window as any).MentatGlobe = api;
    return api;
}
