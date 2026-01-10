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
    WebMercatorProjection,
    JulianDate,
    Math as CesiumMath,
    SkyBox,
    SunLight,
    type Credit,
} from "cesium";
import type { Unit } from "@/types/scenarioModels";
import {
    initCesiumIonFromEnv,
    hasCesiumIonToken,
    createTerrain,
    syncTerrainProviderReferences,
    setSceneVerticalExaggeration,
    runtimeExagSupported,
} from "@/geo/cesiumTerrain";

// Expose Cesium for console debugging
(globalThis as any).Cesium = CesiumNS;

// Ion token init (shared helper)
initCesiumIonFromEnv();

/* ─────────────────────────────── Types ─────────────────────────────── */

export type GlobeInitOptions = {
    imageryProvider?: ImageryProvider;
    elevationEnabled?: boolean;     // default: true if Ion token is set
    exaggeration?: number;          // default: 1 if elevation, 0 if not
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

    // elevation & exaggeration
    setElevationEnabled: (enabled: boolean) => Promise<void>;
    setExaggeration: (factor: number) => Promise<void>;

    // time
    setTime: (epochMs: number) => void;
    setTimeBounds: (startMs: number, stopMs: number) => void;

    // camera helpers
    flyToLatLon: (
        lon: number,
        lat: number,
        heightMeters: number,
        opts?: { heading?: number; pitch?: number; roll?: number; duration?: number }
    ) => Promise<void>;
    frameFromWebMercator: (center3857: [number, number], zoom: number, rotationRad?: number) => Promise<void>;
    frameFromScenario2D: () => Promise<boolean>;

    // sky/lighting
    enableDayNight: (on: boolean) => void;
    enableSkybox: (on: boolean) => void;
    onCameraChange: (cb: (o: { heading: number; pitch: number; roll: number }) => void) => () => void;

    // units (for bindUnitsToView)
    setUnits: (units: Unit[]) => void;
    upsertUnit: (u: Unit) => void;
    removeUnit: (id: string) => void;

    // lifecycle
    rebuild: () => Promise<void>;
    destroy: () => void;
};

/* ───────────────────────────── Utilities ───────────────────────────── */

const wmProj = new WebMercatorProjection(Ellipsoid.WGS84);

function toJulian(ms: number) {
    return JulianDate.fromDate(new Date(ms));
}
function clamp(v: number, a: number, b: number) {
    return Math.max(a, Math.min(b, v));
}
function zoomToHeight(zoom: number, latDeg: number) {
    const table: Array<[number, number]> = [
        [2, 20_000_000],
        [4, 10_000_000],
        [6, 4_000_000],
        [8, 1_500_000],
        [10, 600_000],
        [12, 250_000],
        [14, 100_000],
        [16, 40_000],
        [18, 16_000],
        [20, 6_000],
    ];
    const z = clamp(zoom, table[0][0], table[table.length - 1][0]);
    let i = 1; while (i < table.length && z > table[i][0]) i++;
    const [z0, h0] = table[i - 1];
    const [z1, h1] = table[i] ?? table[i - 1];
    const t = z1 === z0 ? 0 : (z - z0) / (z1 - z0);
    let h = h0 + (h1 - h0) * t;

    h *= clamp(Math.cos((latDeg * Math.PI) / 180), 0.2, 1);
    return clamp(h, 1_500, 30_000_000);
}

/* ────────────────────────── Main entry point ───────────────────────── */

export async function useGlobe(
    container: HTMLDivElement,
    opts: GlobeInitOptions = {}
): Promise<GlobeApi> {
    // —— State
    let elevationEnabled =
        typeof opts.elevationEnabled === "boolean"
            ? opts.elevationEnabled
            : hasCesiumIonToken();

    let exag = Math.max(0, opts.exaggeration ?? (elevationEnabled ? 1 : 0));

    // —— Factories
    function makeGlobe(): Globe {
        const g = new Globe(Ellipsoid.WGS84);
        g.baseColor = Color.BLACK;
        g.showGroundAtmosphere = false;
        (g as any).showWaterEffect = false;
        g.enableLighting = false;
        g.depthTestAgainstTerrain = false;
        return g;
    }

    function makeTerrainNow() {
        // only enable terrain when elevation is enabled AND exaggeration is non-zero
        const enabled = elevationEnabled && exag > 0;
        return createTerrain(enabled, true);
    }

    const defaultOSM = new OpenStreetMapImageryProvider({
        url: "https://tile.openstreetmap.org/",
        credit: "\u00A9 OpenStreetMap contributors",
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
        infoBox: false,
        skyBox: false,
        skyAtmosphere: false,
        globe: makeGlobe(),
        terrain: makeTerrainNow(),
        imageryProvider: opts.imageryProvider ?? defaultOSM,
    });

    try {
        (viewer.scene as any).requestRenderMode = false;
        (viewer as any).useDefaultRenderLoop = true;
    } catch { }

    viewer.clock.shouldAnimate = false;
    viewer.clock.clockRange = ClockRange.CLAMPED;

    const scene = viewer.scene as any;
    scene.backgroundColor = Color.BLACK;
    scene.clearColor = Color.BLACK;
    scene.fog.enabled = false;
    scene.highDynamicRange = false;

    // Initial exaggeration
    setSceneVerticalExaggeration(scene, exag);

    // Canvas background
    try {
        const canvas = (viewer as any).canvas as HTMLCanvasElement;
        const el = viewer.container as HTMLElement;
        if (canvas) canvas.style.background = "transparent";
        if (el) el.style.background = "black";
    } catch { }

    // —— Imagery helpers
    function clearImagery() {
        const layers = viewer.scene.imageryLayers;
        for (let i = layers.length - 1; i >= 0; i--) {
            try {
                layers.remove(layers.get(i), true);
            } catch { }
        }
    }

    function setImageryProvider(provider: ImageryProvider) {
        if (!provider) {
            console.warn("[useGlobe] setImageryProvider: no provider");
            return;
        }
        const layers = viewer.scene.imageryLayers;
        clearImagery();
        const layer = layers.addImageryProvider(provider);
        viewer.scene.globe.material = undefined;
        layer.alpha = 1;
        layer.show = true;
        viewer.scene.requestRender();
        console.log("[useGlobe] Imagery provider set:", (provider as any)?.constructor?.name);
    }

    function makeUrlTemplateProvider(url: string, opts?: BaseTemplateOptions): UrlTemplateImageryProvider {
        const scheme = opts?.geographic ? undefined : new WebMercatorTilingScheme();
        return new UrlTemplateImageryProvider({
            url,
            maximumLevel: opts?.maxLevel ?? 19,
            minimumLevel: opts?.minLevel ?? 0,
            tilingScheme: scheme,
            credit: (opts?.attribution as any) ?? "",
            subdomains: opts?.subdomains as any,
        });
    }

    function setBaseLayerTemplate(url: string, opts?: BaseTemplateOptions) {
        const prov = makeUrlTemplateProvider(url, opts);
        setImageryProvider(prov);
    }

    function setBaseLayer(key: string) {
        const k = (key || "").toLowerCase();

        if (k.includes("osm") || k.includes("openstreetmap")) {
            setImageryProvider(new OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" }));
            return;
        }
        if (k.includes("esri") || k.includes("world") || k.includes("imagery")) {
            setImageryProvider(
                new UrlTemplateImageryProvider({
                    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{x}/{y}.png",
                    maximumLevel: 19,
                    tilingScheme: new WebMercatorTilingScheme(),
                })
            );
            return;
        }

        console.warn("[useGlobe] setBaseLayer: unknown key, falling back to OSM:", key);
        setImageryProvider(new OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" }));
    }

    // —— Exaggeration / Elevation
    async function setElevationEnabled(enabled: boolean): Promise<void> {
        elevationEnabled = enabled;

        viewer.terrain = makeTerrainNow();
        syncTerrainProviderReferences(viewer);

        try { viewer.camera.moveForward(0.001); viewer.camera.moveBackward(0.001); } catch { }
        viewer.scene.requestRender();
        console.log("[useGlobe] Elevation:", elevationEnabled, "exag(scene):", scene.verticalExaggeration);
    }

    async function setExaggeration(factor: number): Promise<void> {
        exag = Math.max(0, factor);

        if (!runtimeExagSupported(scene)) {
            await rebuild();
            console.log("[useGlobe] Exaggeration set (fallback rebuild):", exag);
            return;
        }

        setSceneVerticalExaggeration(scene, exag);

        const wantElevation = exag > 0;
        if (wantElevation !== elevationEnabled) {
            await setElevationEnabled(wantElevation);
        }

        try { viewer.camera.moveForward(0.001); viewer.camera.moveBackward(0.001); } catch { }
        viewer.scene.requestRender();
        console.log("[useGlobe] Exaggeration set (scene):", exag);
    }

    // —— Camera seed: prefer Scenario 2D map if available
    function readScenario2DCamera():
        | { center3857: [number, number]; zoom: number; rotation?: number }
        | null {
        const w: any = window;

        if (w.__scenario_camera?.center3857 && typeof w.__scenario_camera.zoom === "number") {
            return w.__scenario_camera;
        }

        const olMap = w.Mentat2D?.map ?? w.__olMap ?? null;
        try {
            const view = olMap?.getView?.();
            const center = view?.getCenter?.();
            const zoom = view?.getZoom?.();
            const rotation = view?.getRotation?.() ?? 0;
            if (center && typeof zoom === "number") {
                return { center3857: center as [number, number], zoom, rotation };
            }
        } catch { }

        try {
            const sc = (w.__scenario?.store ?? w.__scenario)?.state;
            const cam = sc?.ui?.last2dCamera;
            if (cam?.center3857 && typeof cam.zoom === "number") return cam;
        } catch { }

        return null;
    }

    function seedCameraFrom2D(cam: { center3857: [number, number]; zoom: number; rotation?: number }): boolean {
        try {
            const carto = wmProj.unproject(new Cartesian3(cam.center3857[0], cam.center3857[1], 0));
            const lat = CesiumMath.toDegrees(carto.latitude);
            const lon = CesiumMath.toDegrees(carto.longitude);
            const h = zoomToHeight(cam.zoom, lat);

            viewer.camera.setView({
                destination: Cartesian3.fromDegrees(lon, lat, h),
                orientation: {
                    heading: 0,
                    pitch: -Math.PI / 2,
                    roll: 0,
                },
            });
            return true;
        } catch {
            return false;
        }
    }

    if (!seedCameraFrom2D(readScenario2DCamera())) {
        viewer.camera.setView({ destination: Cartesian3.fromDegrees(-20, 25, 2_500_000) });
    }

    // Clamp camera to stay ≥ 50 m AGL after tiles are ready
    const MIN_AGL_METERS = 50;
    let mapReady = false;

    function clampAGL() {
        if (!mapReady) return;
        try {
            const globe = viewer.scene.globe;
            const carto = Cartographic.fromCartesian(viewer.camera.position);
            const h = globe.getHeight(carto);
            if (typeof h === "number" && Number.isFinite(h)) {
                const agl = carto.height - h;
                if (agl < MIN_AGL_METERS) {
                    carto.height = h + MIN_AGL_METERS;
                    viewer.camera.position = Cartesian3.fromRadians(
                        carto.longitude,
                        carto.latitude,
                        carto.height
                    );
                    viewer.scene.requestRender();
                }
            }
        } catch { }
    }

    function wireReadiness() {
        mapReady = false;
        const ssc = viewer.scene.screenSpaceCameraController;
        ssc.enableCollisionDetection = false;

        const mark = () => {
            const g = viewer.scene.globe;
            if (g?.tilesLoaded && (viewer.terrainProvider?.ready ?? true)) {
                mapReady = true;
                ssc.enableCollisionDetection = true;
                viewer.scene.postRender.addEventListener(clampAGL);
            }
        };

        const onTiles = (c: number) => { if (c === 0) mark(); };
        viewer.scene.globe.tileLoadProgressEvent.addEventListener(onTiles);
        viewer.scene.postRender.addEventListener(mark);
        ssc.minimumZoomDistance = 50;
    }

    // ── Camera change pub/sub
    type CamPayload = { heading: number; pitch: number; roll: number };
    const cameraListeners = new Set<(o: CamPayload) => void>();

    function emitCamera() {
        const c = viewer.camera;
        const payload: CamPayload = { heading: c.heading, pitch: c.pitch, roll: c.roll };
        for (const fn of cameraListeners) { try { fn(payload); } catch { } }
    }

    let detachCameraEvents: (() => void) | null = null;
    let camEventsAttached = false;

    function attachCameraEvents() {
        if (camEventsAttached) return;
        camEventsAttached = true;

        const postRenderHandler = () => emitCamera();
        const cameraChangedHandler = () => emitCamera();
        const moveStartHandler = () => emitCamera();
        const moveEndHandler = () => emitCamera();

        try { viewer.scene.postRender.addEventListener(postRenderHandler); } catch { }
        try { (viewer.camera as any).changed?.addEventListener?.(cameraChangedHandler); } catch { }
        try { (viewer.camera as any).moveStart?.addEventListener?.(moveStartHandler); } catch { }
        try { (viewer.camera as any).moveEnd?.addEventListener?.(moveEndHandler); } catch { }

        try { emitCamera(); } catch { }

        detachCameraEvents = () => {
            try { viewer.scene.postRender.removeEventListener(postRenderHandler); } catch { }
            try { (viewer.camera as any).changed?.removeEventListener?.(cameraChangedHandler); } catch { }
            try { (viewer.camera as any).moveStart?.removeEventListener?.(moveStartHandler); } catch { }
            try { (viewer.camera as any).moveEnd?.removeEventListener?.(moveEndHandler); } catch { }
            camEventsAttached = false;
            detachCameraEvents = null;
        };
    }

    function onCameraChange(cb: (o: CamPayload) => void) {
        cameraListeners.add(cb);
        try { cb({ heading: viewer.camera.heading, pitch: viewer.camera.pitch, roll: viewer.camera.roll }); } catch { }
        return () => cameraListeners.delete(cb);
    }

    wireReadiness();
    attachCameraEvents();

    // Tile diagnostics
    let detachTileDiag: (() => void) | null = null;
    (function attachTileDiagnostics() {
        if (detachTileDiag) { try { detachTileDiag(); } catch { } detachTileDiag = null; }
        let last = -1;
        const g = viewer.scene.globe;
        const on = (n: number) => { if (n !== last) { last = n; if (n === 0) console.log("[tileLoadProgress] ✅ imagery loaded"); } };
        g.tileLoadProgressEvent.addEventListener(on);
        detachTileDiag = () => { try { g.tileLoadProgressEvent.removeEventListener(on); } catch { } };
    })();

    /* ───────────────────────────── Units API ───────────────────────────── */

    const unitPrims = new Map<string, CesiumNS.Entity>();
    const unitCache = new Map<string, Unit>();

    function toCartesian3(u: Unit, defaultHeight = 0): Cartesian3 | undefined {
        if (!u || typeof (u as any).lat !== "number" || typeof (u as any).lon !== "number") return undefined;
        const h = (u as any).alt ?? (u as any).height ?? defaultHeight;
        return Cartesian3.fromDegrees((u as any).lon, (u as any).lat, h);
    }
    function unitLabelText(u: Unit): string {
        return (u as any)?.name ?? "";
    }
    function upsertUnit(u: Unit) {
        if (!u?.id) return;
        const pos = toCartesian3(u, 0);
        if (!pos) return;
        unitCache.set(u.id, u);

        const existing = unitPrims.get(u.id);
        if (existing) {
            existing.position = pos;
            if (existing.label) existing.label.text = new CesiumNS.ConstantProperty(unitLabelText(u));
            return;
        }
        const ent = viewer.entities.add(new CesiumNS.Entity({
            id: u.id,
            position: pos,
            label: new CesiumNS.LabelGraphics({
                text: unitLabelText(u),
                font: "14px sans-serif",
                pixelOffset: new Cartesian2(0, -28),
                verticalOrigin: CesiumNS.VerticalOrigin.BOTTOM,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                outlineColor: Color.BLACK,
                outlineWidth: 2,
                showBackground: true,
                backgroundPadding: new Cartesian2(6, 4),
                backgroundColor: new Color(0, 0, 0, 0.4),
            }),
        }));
        unitPrims.set(u.id, ent);
    }
    function removeUnit(id: string) {
        unitCache.delete(id);
        const ent = unitPrims.get(id);
        if (ent) { try { viewer.entities.remove(ent); } catch { } unitPrims.delete(id); }
    }
    function setUnits(units: Unit[]) {
        for (const id of unitPrims.keys()) removeUnit(id);
        if (!Array.isArray(units)) return;
        for (const u of units) upsertUnit(u);
    }

    /* ─────────────────────────── Camera helpers ─────────────────────────── */

    async function flyToLatLon(
        lon: number,
        lat: number,
        heightMeters: number,
        opts?: { heading?: number; pitch?: number; roll?: number; duration?: number }
    ): Promise<void> {
        const duration = opts?.duration ?? 0.8;
        const heading = opts?.heading ?? 0;
        const pitch = opts?.pitch ?? -Math.PI / 2;
        const roll = opts?.roll ?? 0;

        return new Promise((resolve) => {
            viewer.camera.flyTo({
                destination: Cartesian3.fromDegrees(lon, lat, heightMeters),
                orientation: { heading, pitch, roll },
                duration,
                complete: () => { viewer.scene.requestRender(); resolve(); },
            });
        });
    }

    async function frameFromWebMercator(center3857: [number, number], zoom: number, rotationRad = 0): Promise<void> {
        const carto = wmProj.unproject(new Cartesian3(center3857[0], center3857[1], 0));
        const lat = CesiumMath.toDegrees(carto.latitude);
        const lon = CesiumMath.toDegrees(carto.longitude);
        const h = zoomToHeight(zoom, lat);
        await flyToLatLon(lon, lat, h, { heading: 0, pitch: -Math.PI / 2, roll: 0 });
    }

    async function frameFromScenario2D(): Promise<boolean> {
        const cam = readScenario2DCamera();
        if (!cam) return false;
        await frameFromWebMercator(cam.center3857, cam.zoom, cam.rotation ?? 0);
        return true;
    }

    /* ───────────────────────────── Time API ───────────────────────────── */

    function setTime(epochMs: number) {
        viewer.clock.currentTime = toJulian(epochMs);
        viewer.scene.requestRender();
    }
    function setTimeBounds(startMs: number, stopMs: number) {
        viewer.clock.startTime = toJulian(startMs);
        viewer.clock.stopTime = toJulian(stopMs);
        if (JulianDate.lessThan(viewer.clock.currentTime, viewer.clock.startTime)) {
            viewer.clock.currentTime = viewer.clock.startTime.clone();
        }
        if (JulianDate.greaterThan(viewer.clock.currentTime, viewer.clock.stopTime)) {
            viewer.clock.currentTime = viewer.clock.stopTime.clone();
        }
        viewer.scene.requestRender();
    }

    /* ─────────────────────────── Sky & Lighting ─────────────────────────── */

    function enableDayNight(on: boolean) {
        try {
            viewer.scene.globe.enableLighting = !!on;
            (viewer.scene as any).light = on ? new SunLight() : undefined;
            viewer.scene.requestRender();
        } catch (e) {
            console.warn("[useGlobe] enableDayNight failed", e);
        }
    }
    function enableSkybox(on: boolean) {
        try {
            if (on) {
                viewer.scene.skyBox = new SkyBox({
                    sources: {
                        positiveX: CesiumNS.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_px.jpg"),
                        negativeX: CesiumNS.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_mx.jpg"),
                        positiveY: CesiumNS.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_py.jpg"),
                        negativeY: CesiumNS.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_my.jpg"),
                        positiveZ: CesiumNS.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_pz.jpg"),
                        negativeZ: CesiumNS.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_mz.jpg"),
                    },
                });
                (viewer.scene as any).skyAtmosphere = (viewer.scene as any).skyAtmosphere || new CesiumNS.SkyAtmosphere();
                (viewer.scene as any).skyAtmosphere.show = true;
            } else {
                if (viewer.scene.skyBox) viewer.scene.skyBox.show = false;
                if ((viewer.scene as any).skyAtmosphere) (viewer.scene as any).skyAtmosphere.show = false;
            }
            viewer.scene.requestRender();
        } catch (e) {
            console.warn("[useGlobe] enableSkybox failed", e);
        }
    }

    /* ─────────────────────────── Rebuild / Destroy ─────────────────────────── */

    function cloneImageryProvider(p?: ImageryProvider): ImageryProvider {
        if (!p) return new OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" });

        const ap: any = p;
        const name = ap?.constructor?.name;

        if (name === "OpenStreetMapImageryProvider") {
            return new OpenStreetMapImageryProvider({
                url: ap.url ?? "https://tile.openstreetmap.org/",
                credit: ap.credit ?? "\u00A9 OpenStreetMap contributors",
            });
        }
        if (name === "UrlTemplateImageryProvider") {
            const url = ap.url || ap._resource?.url || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
            const max = ap.maximumLevel ?? 19;
            return new UrlTemplateImageryProvider({
                url,
                maximumLevel: max,
                tilingScheme: new WebMercatorTilingScheme(),
                credit: ap.credit ?? "",
            });
        }
        return new OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" });
    }

    async function rebuild(): Promise<void> {
        console.log("[useGlobe] Rebuild start", { elevationEnabled, exag });
        const container = viewer.container as HTMLDivElement;

        const pos = viewer.camera.positionWC.clone();
        const dir = viewer.camera.directionWC.clone();
        const up = viewer.camera.upWC.clone();

        const layers = viewer.scene.imageryLayers;
        const activeLayer = layers.length > 0 ? layers.get(0) : undefined;
        const activeProvider = activeLayer?.imageryProvider;
        const baseProv = cloneImageryProvider(activeProvider ?? opts.imageryProvider ?? defaultOSM);

        try { detachTileDiag?.(); } catch { }

        viewer.destroy();

        viewer = new Viewer(container, {
            scene3DOnly: true,
            animation: false,
            timeline: false,
            baseLayerPicker: false,
            geocoder: false,
            homeButton: false,
            navigationHelpButton: false,
            infoBox: false,
            skyBox: false,
            skyAtmosphere: false,
            globe: makeGlobe(),
            terrain: makeTerrainNow(),
            imageryProvider: baseProv,
        });

        const sc: any = viewer.scene;
        sc.backgroundColor = Color.BLACK;
        sc.clearColor = Color.BLACK;
        sc.fog.enabled = false;
        sc.highDynamicRange = false;

        setSceneVerticalExaggeration(sc, exag);

        viewer.camera.setView({ destination: pos, orientation: { direction: dir, up } });
        viewer.scene.screenSpaceCameraController.minimumZoomDistance = 50;

        wireReadiness();
        attachCameraEvents();

        (function reattachDiag() {
            let last = -1;
            const g = viewer.scene.globe;
            const on = (n: number) => { if (n !== last) { last = n; if (n === 0) console.log("[tileLoadProgress] ✅ imagery loaded"); } };
            g.tileLoadProgressEvent.addEventListener(on);
            detachTileDiag = () => { try { g.tileLoadProgressEvent.removeEventListener(on); } catch { } };
        })();

        try { viewer.camera.moveForward(0.001); viewer.camera.moveBackward(0.001); } catch { }
        viewer.scene.requestRender();
        console.log("[useGlobe] Rebuild done");
    }

    function destroy() {
        try { detachTileDiag?.(); } catch { }
        try { viewer.scene.postRender.removeEventListener(clampAGL); } catch { }
        try { detachCameraEvents?.(); } catch { }
        try { viewer.destroy(); } catch { }
    }

    /* ───────────────────────────── Public API ───────────────────────────── */

    const api: GlobeApi = {
        viewer,

        setImageryProvider,
        setBaseLayerTemplate,
        setBaseLayer,

        setElevationEnabled,
        setExaggeration,

        setTime,
        setTimeBounds,

        flyToLatLon,
        frameFromWebMercator,
        frameFromScenario2D,

        onCameraChange,

        enableDayNight,
        enableSkybox,

        setUnits,
        upsertUnit,
        removeUnit,

        rebuild,
        destroy,
    };

    (window as any).MentatGlobe = api;
    return api;
}
