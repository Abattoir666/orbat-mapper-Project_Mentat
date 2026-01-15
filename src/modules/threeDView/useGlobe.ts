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
    Terrain,
    ImageryProvider,
    OpenStreetMapImageryProvider,
    UrlTemplateImageryProvider,
    WebMercatorTilingScheme,
    GeographicTilingScheme,
    ScreenSpaceEventHandler,
    ScreenSpaceEventType,
    Math as CesiumMath,
    JulianDate,
    HeadingPitchRoll,
    Matrix4,
    Rectangle,
    EllipsoidGeodesic,
    SceneMode,
} from "cesium";

import { injectStrict } from "@/utils";
import { activeScenarioKey } from "@/components/injects";

import {
    createTerrainForKey,
    syncTerrainProviderReferences,
    initCesiumIonFromEnv,
    hasCesiumIonToken,
    setSceneVerticalExaggeration,
    runtimeExagSupported,
} from "@/geo/cesiumTerrain";

import {
    type TerrainKey,
    applyWaterEffectEnabled,
} from "@/modules/threeDView/hydrography";

import { makeImageryProviders, type ImageryEntry } from "@/modules/threeDView/makeImageryProviders";

/* ─────────────────────────────── Global hook ────── */
(window as any).Cesium = CesiumNS;

// Ion token init (shared helper)
initCesiumIonFromEnv();

/* ─────────────────────────────── Helpers ────── */

function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }

// Your existing code uses this; preserve.
function cloneImageryProvider(p: any): ImageryProvider {
    // Best-effort clone for common providers.
    // If unknown, fall back to OSM.
    try {
        if (!p) throw new Error("no provider");
        const ctorName = p.constructor?.name || "";
        if (ctorName.includes("UrlTemplateImageryProvider") && p.url) {
            return new UrlTemplateImageryProvider({
                url: p.url,
                maximumLevel: p.maximumLevel,
                minimumLevel: p.minimumLevel,
                tilingScheme: p.tilingScheme,
                credit: p.credit ?? "",
                subdomains: p.subdomains,
            });
        }
        if (ctorName.includes("OpenStreetMapImageryProvider")) {
            return new OpenStreetMapImageryProvider({ url: p.url ?? "https://tile.openstreetmap.org/" });
        }
    } catch { /* ignore */ }
    return new OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" });
}

/* ─────────────────────────────── useGlobe ────── */

export type UseGlobeOptions = {
    container?: HTMLElement;         // <-- make optional for 2-arg call style
    terrainKey?: TerrainKey;
    imageryProvider?: ImageryProvider;
};

export function useGlobe(container: HTMLElement, opts?: Omit<UseGlobeOptions, "container">): any;
export function useGlobe(opts: UseGlobeOptions & { container: HTMLElement }): any;
export function useGlobe(arg1: any, arg2?: any) {
    const isElement =
        arg1 && typeof arg1 === "object" && (arg1 as any).nodeType === 1;

    const container: HTMLElement | undefined =
        isElement ? (arg1 as HTMLElement) : (arg1?.container as HTMLElement | undefined);

    const opts: UseGlobeOptions =
        isElement ? ({ ...(arg2 ?? {}), container } as UseGlobeOptions) : (arg1 as UseGlobeOptions);

    if (!container) {
        // This matches Cesium’s expectation and makes failures obvious.
        throw new Error("[useGlobe] container is required (got null/undefined).");
    }
    const scenarioKey = injectStrict(activeScenarioKey);

    // makeImageryProviders() currently returns { providers, getByKey } (not an array).
    const imageryFactory: any = makeImageryProviders();
    const providers: ImageryEntry[] = Array.isArray(imageryFactory)
        ? imageryFactory
        : (imageryFactory?.providers ?? []);

    function getStaticImageryByKey(key: string): Extract<ImageryEntry, { kind: "static" }> | undefined {
        // Prefer factory helper when present (throws on unknown keys).
        try {
            if (!Array.isArray(imageryFactory) && typeof imageryFactory?.getByKey === "function") {
                return imageryFactory.getByKey(key);
            }
        } catch {
            // fall through to local search
        }
        return providers.find((p) => (p as any).kind === "static" && (p as any).key === key) as any;
    }

    // --- State
    let terrainKey: TerrainKey = opts.terrainKey ?? "world";
    let lastNonFlatTerrainKey: TerrainKey = terrainKey === "flat" ? "world" : terrainKey;
    let elevationEnabled = terrainKey !== "flat";
    let exag = elevationEnabled ? 1 : 0;

    // Diagnostics hooks
    let detachTileDiag: null | (() => void) = null;
    let detachCameraEvents: null | (() => void) = null;

    // Terrain switching coordination
    let terrainSwitchSeq = 0;
    let detachTerrainListeners: null | (() => void) = null;

    function makeGlobe() {
        const g = new Globe(Ellipsoid.WGS84);
        g.baseColor = Color.BLACK;
        g.enableLighting = true;
        g.depthTestAgainstTerrain = true;
        (g as any).showWaterEffect = false;
        return g;
    }

    function makeTerrainNow() {
        if (terrainKey === "flat") return createTerrainForKey("flat", true);

        const enabled = elevationEnabled && exag > 0;
        if (!enabled) return createTerrainForKey("flat", true);

        return createTerrainForKey(terrainKey, true);
    }

    function getTerrainKey(): TerrainKey {
        return terrainKey;
    }

    const defaultOSM = new OpenStreetMapImageryProvider({
        url: "https://tile.openstreetmap.org/",
        credit: "\u00A9 OpenStreetMap contributors",
    });

    // —— Viewer
    let viewer = new Viewer(container as any, {
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

    viewer.clock.shouldAnimate = false;
    viewer.clock.clockRange = ClockRange.UNBOUNDED;
    viewer.clock.multiplier = 1;

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
        canvas.style.background = "black";
    } catch { /* ignore */ }


    // (Your file continues with many helpers; preserved below as-is)
    // ───────────────────────────────────────────────────────────────────────
    // NOTE: Everything below is your existing content except for the two
    //       specific changes described above.
    // ───────────────────────────────────────────────────────────────────────

    function setWaterEffectEnabled(enabled: boolean): void {
        try { applyWaterEffectEnabled(viewer, enabled); } catch { /* ignore */ }
        viewer.scene.requestRender();
    }

    function repairGlobeSurface(reason: string) {
        try {
            const scene = viewer.scene;
            const globe = scene.globe;

            try { (globe as any).reload?.(); } catch { /* ignore */ }

            // Ensure we have at least one visible imagery layer
            const layers = scene.imageryLayers;
            if (layers.length === 0) {
                try {
                    layers.addImageryProvider(new OpenStreetMapImageryProvider({
                        url: "https://tile.openstreetmap.org/",
                        credit: "© OpenStreetMap contributors",
                    }));
                } catch (e) {
                    console.warn("[useGlobe] repairGlobeSurface: failed to re-add base imagery", e);
                }
            }

            // Ensure layers are visible (some paths accidentally alpha=0)
            for (let i = 0; i < layers.length; i++) {
                const l = layers.get(i);
                if (l) {
                    l.show = true;
                    if (typeof l.alpha === "number" && l.alpha <= 0) l.alpha = 1;
                }
            }

            scene.requestRender();
        } catch (e) {
            console.warn("[useGlobe] repairGlobeSurface failed:", reason, e);
        }
    }

    async function setElevationEnabled(enabled: boolean): Promise<void> {
        await setTerrainKey(enabled ? lastNonFlatTerrainKey : "flat");
    }

    async function setExaggeration(factor: number): Promise<void> {
        exag = Math.max(0, factor);

        // CHANGE #2:
        // Previously: if runtimeExagSupported(scene) was false, you called await rebuild().
        // That implicit rebuild destroys/replaces the top Viewer and breaks the split compositor.
        if (!runtimeExagSupported(scene)) {
            // Two-world compositor requirement:
            // Do NOT implicitly rebuild/destroy the top Viewer (split compositor holds a reference to it).
            // If you truly need a rebuild, do it explicitly from the UI layer and recreate splitHandle.
            console.warn(
                "[useGlobe] Runtime vertical exaggeration not supported; value will apply after an explicit rebuild:",
                exag
            );
            try { viewer.scene.requestRender(); } catch { /* ignore */ }
            return;
        }

        setSceneVerticalExaggeration(scene, exag);

        try { viewer.camera.moveForward(0.001); viewer.camera.moveBackward(0.001); } catch { }
        viewer.scene.requestRender();
        console.log("[useGlobe] Exaggeration set (scene):", exag);
    }

    async function setTerrainKey(key: TerrainKey): Promise<void> {
        const prevKey = terrainKey;

        terrainKey = key;

        // Normalize elevation/exaggeration policy (important when switching terrain modes)
        if (terrainKey === "flat") {
            elevationEnabled = false;
            exag = 0;
            setSceneVerticalExaggeration(viewer.scene, 0);
        } else {
            elevationEnabled = true;
            if (exag <= 0) {
                exag = 1;
                setSceneVerticalExaggeration(viewer.scene, 1);
            }
            lastNonFlatTerrainKey = terrainKey;
        }

        // CHANGE #1:
        // Previously: if (prevKey === "bathymetry" || terrainKey === "bathymetry") await rebuild(); return;
        // For split-terrain compositing, do NOT implicitly rebuild/destroy the top Viewer here.
        // If runtime terrain swaps wedge in your Cesium build/provider, recover explicitly from the UI
        // by calling api.rebuild() AND recreating the split compositor handle.

        // Cancel any previous terrain listeners
        detachTerrainListeners?.();
        detachTerrainListeners = null;

        const mySeq = ++terrainSwitchSeq;

        const terrain: Terrain = createTerrainForKey(terrainKey, true);

        // Keep Viewer state consistent with Scene state
        try { (viewer as any).terrain = terrain; } catch { /* ignore */ }

        viewer.scene.setTerrain(terrain);
        viewer.scene.requestRender();

        const onTerrainError = (err: any) => {
            if (mySeq !== terrainSwitchSeq) return;
            console.warn("[useGlobe] Terrain creation error:", err);

            if (terrainKey === "world") void setTerrainKey("flat");
        };

        const onProviderTileError = (err: any) => {
            if (mySeq !== terrainSwitchSeq) return;
            console.warn("[useGlobe] Terrain tile error:", err);

            if (terrainKey === "world") void setTerrainKey("flat");
        };

        const onTerrainReady = () => {
            if (mySeq !== terrainSwitchSeq) return;

            console.log("[useGlobe] Terrain ready:", terrainKey);

            // Critical: sync providers from the terrain we just set
            try {
                syncTerrainProviderReferences(viewer, terrain);
            } catch (e) {
                console.warn("[useGlobe] syncTerrainProviderReferences failed:", e);
            }

            try {
                (terrain as any).provider?.errorEvent?.addEventListener(onProviderTileError);
            } catch { /* ignore */ }

            // Nudge globe surface rebuild
            try { (viewer.scene.globe as any).reload?.(); } catch { /* ignore */ }

            viewer.scene.requestRender();
        };

        (terrain as any).errorEvent.addEventListener(onTerrainError);
        (terrain as any).readyEvent.addEventListener(onTerrainReady);

        detachTerrainListeners = () => {
            try { (terrain as any).errorEvent.removeEventListener(onTerrainError); } catch { }
            try { (terrain as any).readyEvent.removeEventListener(onTerrainReady); } catch { }
            try { (terrain as any).provider?.errorEvent?.removeEventListener(onProviderTileError); } catch { }
        };
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

            const needsSubdomains = String(url).includes("{s}");
            const subdomains =
                ap.subdomains ?? ap._subdomains ?? (needsSubdomains ? ["a", "b", "c"] : undefined);

            return new UrlTemplateImageryProvider({
                url,
                maximumLevel: max,
                tilingScheme: new WebMercatorTilingScheme(),
                credit: ap.credit ?? "",
                subdomains,
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

    type BaseLayerTemplateOptions = {
        minLevel?: number;
        maxLevel?: number;
        geographic?: boolean;                  // true => GeographicTilingScheme, else WebMercator
        subdomains?: string[] | string;
        attribution?: string;                 // credit string
        alpha?: number;                       // layer opacity (0..1)
    };

    function setImageryProvider(provider: ImageryProvider, alpha: number = 1) {
        const layers = viewer.scene.imageryLayers;

        // Replace only the *base* layer (index 0). Keep any overlays above it.
        try {
            if (layers.length > 0) {
                const base = layers.get(0);
                layers.remove(base, true);
            }
        } catch { /* ignore */ }

        const layer = layers.addImageryProvider(provider, 0);
        layer.show = true;
        layer.alpha = Math.max(0, Math.min(1, alpha));

        viewer.scene.requestRender();
    }

    function setBaseLayerTemplate(url: string, opts: BaseLayerTemplateOptions = {}) {
        const tilingScheme = opts.geographic ? new GeographicTilingScheme() : new WebMercatorTilingScheme();

        // If template uses {s} and no subdomains provided, default to a/b/c.
        const needsSubdomains = String(url).includes("{s}");
        const subdomains =
            opts.subdomains ??
            (needsSubdomains ? ["a", "b", "c"] : undefined);

        const prov = new UrlTemplateImageryProvider({
            url,
            minimumLevel: opts.minLevel,
            maximumLevel: opts.maxLevel,
            tilingScheme,
            credit: opts.attribution ?? "",
            subdomains,
        } as any);

        setImageryProvider(prov, opts.alpha ?? 1);
    }

    function setBaseLayer(key: string) {
        const entry = getStaticImageryByKey(key);

        if (!entry) {
            console.warn("[useGlobe] setBaseLayer: unknown imagery key:", key);
            // Fallback to OSM so you never end up with a blank globe due to a bad key.
            setImageryProvider(new OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" }), 1);
            return;
        }

        // Static entry: create provider and apply as base layer.
        try {
            const prov = entry.create();
            setImageryProvider(prov, 1);
        } catch (e) {
            console.warn("[useGlobe] setBaseLayer: failed to create provider for key:", key, e);
            setImageryProvider(new OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/" }), 1);
        }
    }

    function hardResetVisuals(reason: string = "manual") {
        try {
            const scene: any = viewer.scene;
            const globe: any = scene.globe;

            console.warn("[useGlobe] hardResetVisuals:", reason);

            // Ensure globe is on
            if (globe) {
                globe.show = true;
                globe.baseColor = Color.BLACK;
            }

            // Ensure scene primitive collections are visible (these are sometimes toggled during debugging)
            try { scene.primitives.show = true; } catch { /* ignore */ }
            try { scene.groundPrimitives.show = true; } catch { /* ignore */ }

            // Ensure imagery layers exist and are visible
            const layers = scene.imageryLayers;
            if (layers) {
                if (layers.length === 0) {
                    try {
                        layers.addImageryProvider(new OpenStreetMapImageryProvider({
                            url: "https://tile.openstreetmap.org/",
                            credit: "© OpenStreetMap contributors",
                        }), 0);
                    } catch { /* ignore */ }
                }

                for (let i = 0; i < layers.length; i++) {
                    const l = layers.get(i);
                    if (!l) continue;
                    l.show = true;
                    if (typeof l.alpha === "number" && l.alpha <= 0) l.alpha = 1;
                }
            }

            // Nudge the globe surface to rebuild tiles if supported
            try { globe?.reload?.(); } catch { /* ignore */ }

            // Force a render
            try { scene.requestRender?.(); } catch { /* ignore */ }
            try { viewer.scene.requestRender(); } catch { /* ignore */ }
        } catch (e) {
            console.warn("[useGlobe] hardResetVisuals failed:", e);
        }
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

        setTerrainKey,
        getTerrainKey,
        setWaterEffectEnabled,
        hardResetVisuals,
    };

    (window as any).MentatGlobe = api;
    return api;
}
