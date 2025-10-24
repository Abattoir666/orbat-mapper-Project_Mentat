// src/modules/threeDView/useGlobe.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as CesiumNS from "cesium";
import {
    Viewer,
    Ion,
    Globe,
    Ellipsoid,
    Color,
    Cartesian3,
    Cartographic,
    ScreenSpaceEventHandler,
    ScreenSpaceEventType,
    Terrain,
    EllipsoidTerrainProvider,
    type TerrainProvider,
    ImageryProvider,
    OpenStreetMapImageryProvider,
    UrlTemplateImageryProvider,
    WebMercatorTilingScheme,
} from "cesium";
import type { Unit } from "@/types/scenarioModels";

// Expose Cesium in console for debugging
(globalThis as any).Cesium = CesiumNS;

// Ion token (flat fallback if missing)
Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN || "";

export type GlobeInitOptions = {
    imageryProvider?: ImageryProvider;
    // start with elevation enabled or not (defaults: enabled if Ion token present)
    elevationEnabled?: boolean;
    // start exaggeration (defaults to 1 when elevation is enabled, 0 when disabled)
    exaggeration?: number;
};

export type GlobeApi = {
    viewer: Viewer;
    // imagery
    setImageryProvider: (p: ImageryProvider) => void;
    // elevation & exaggeration
    setElevationEnabled: (enabled: boolean) => Promise<void>;
    setExaggeration: (factor: number) => Promise<void>;
    // convenience (optional, wire your own key->provider in adapter)
    rebuild: () => Promise<void>;
    destroy: () => void;
};

export async function useGlobe(
    container: HTMLDivElement,
    opts: GlobeInitOptions = {}
): Promise<GlobeApi> {
    // --------- Internal state (single source of truth)
    let elevationEnabled =
        typeof opts.elevationEnabled === "boolean"
            ? opts.elevationEnabled
            : !!Ion.defaultAccessToken;

    // NOTE: exaggeration now lives on Scene, not Globe.
    // We'll mirror it in local state for UI, but always write to scene.verticalExaggeration.
    let exag = Math.max(0, opts.exaggeration ?? (elevationEnabled ? 1 : 0));

    // --------- Helpers to always target *current* viewer
    const getScene = () => viewer.scene;
    const getGlobe = () => viewer.scene.globe;
    const getSSC = () => viewer.scene.screenSpaceCameraController;

    // --------- Build a Globe with safe defaults (no blue orb)
    function ensureBaseLayer() {
        const layers = viewer.scene.imageryLayers;
        if (layers.length === 0) {
            const osm = new OpenStreetMapImageryProvider({
                url: "https://tile.openstreetmap.org/",
            });
            const ly = layers.addImageryProvider(osm);
            ly.alpha = 1;
            ly.show = true;
            viewer.scene.globe.material = undefined;
        }
    }
    function makeGlobe(): Globe {
        const g = new Globe(Ellipsoid.WGS84);
        g.baseColor = Color.BLACK;
        g.showGroundAtmosphere = false;
        (g as any).showWaterEffect = false;
        g.enableLighting = false;
        g.depthTestAgainstTerrain = false;
        return g;
    }

    // --------- Terrain provider (no hard Ion dependency; graceful fallback)
    function makeTerrain(): Terrain {
        if (!elevationEnabled || exag <= 0) {
            return new Terrain(new EllipsoidTerrainProvider());
        }
        try {
            return Terrain.fromWorldTerrain({ requestVertexNormals: true });
        } catch {
            console.warn("[useGlobe] World terrain unavailable; using flat ellipsoid");
            return new Terrain(new EllipsoidTerrainProvider());
        }
    }

    // --------- Default imagery if none is provided
    const defaultOSM = new OpenStreetMapImageryProvider({
        url: "https://tile.openstreetmap.org/",
        credit: "\u00A9 OpenStreetMap contributors",
    });

    // --------- Viewer creation
    let viewer = new Viewer(container, {
        scene3DOnly: true,
        animation: false,
        timeline: false,
        baseLayerPicker: false, // (terrain dropdown removed)
        geocoder: false,
        homeButton: false,
        navigationHelpButton: false,
        infoBox: false,
        skyBox: false,
        skyAtmosphere: false,
        globe: makeGlobe(),
        terrain: makeTerrain(),
        // IMPORTANT: do NOT rely on old terrainExaggeration option here.
        imageryProvider: opts.imageryProvider ?? defaultOSM,
    });

    const unitPrims = new Map<string, Cesium.Entity>(); // id -> entity
    const unitCache = new Map<string, Unit>();          // id -> Unit (rehydrate after rebuilds)

    function toCartesian3(u: Unit, defaultHeight = 0): Cesium.Cartesian3 | undefined {
        if (!u || typeof u.lat !== "number" || typeof u.lon !== "number") return undefined;
        const h = (u as any).alt ?? (u as any).height ?? defaultHeight;
        return Cesium.Cartesian3.fromDegrees(u.lon, u.lat, h);
    }

    // Stub: wire this to your real SIDC -> icon if/when ready
    function resolveSidcBillboard(u: Unit): Cesium.BillboardGraphics.ConstructorOptions | undefined {
        return undefined;
    }

    function unitLabelText(u: Unit): string {
        return u?.name ?? "";
    }
    function upsertUnit(u: Unit) {
        if (!u?.id || !viewer) return;

        const pos = toCartesian3(u, 0);
        if (!pos) return;

        // cache for rebuilds
        unitCache.set(u.id, u);

        const existing = unitPrims.get(u.id);
        if (existing) {
            existing.position = pos;
            if (existing.label) existing.label.text = new Cesium.ConstantProperty(unitLabelText(u));
            // If you later use billboard icons, update here as well
            return;
        }

        const billboardOpts = resolveSidcBillboard(u);
        const ent = viewer.entities.add(
            new Cesium.Entity({
                id: u.id,
                position: pos,
                billboard: billboardOpts ? new Cesium.BillboardGraphics(billboardOpts) : undefined,
                label: new Cesium.LabelGraphics({
                    text: unitLabelText(u),
                    font: "14px sans-serif",
                    pixelOffset: new Cesium.Cartesian2(0, -28),
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    showBackground: true,
                    backgroundPadding: new Cesium.Cartesian2(6, 4),
                    backgroundColor: new Cesium.Color(0, 0, 0, 0.4),
                }),
            })
        );
        unitPrims.set(u.id, ent);
    }
    function removeUnit(id: string) {
        unitCache.delete(id);
        if (!viewer) { unitPrims.delete(id); return; }

        const ent = unitPrims.get(id);
        if (ent) {
            try { viewer.entities.remove(ent); } catch { }
            unitPrims.delete(id);
        }
    }
    function upsertUnitsBulk(units: Unit[]) {
        if (!units?.length) return;
        for (const u of units) {
            if (u?.id) unitCache.set(u.id, u);
        }
        for (const u of units) upsertUnit(u);
    }

    // --------- Scene defaults
    const scene = getScene();
    scene.backgroundColor = Color.BLACK;
    (scene as any).clearColor = Color.BLACK;
    scene.fog.enabled = false;
    scene.highDynamicRange = false;

    // Apply initial exaggeration on the Scene (the correct, modern API)
    try {
        (scene as any).verticalExaggeration = Math.max(0, exag || 0);
        (scene as any).verticalExaggerationRelativeHeight = 0;
    } catch {
        console.warn("[useGlobe] Could not set scene.verticalExaggeration at init");
    }

    // DOM backgrounds
    try {
        const canvas = (viewer as any).canvas as HTMLCanvasElement;
        const el = viewer.container as HTMLElement;
        if (canvas) canvas.style.background = "transparent";
        if (el) el.style.background = "black";
    } catch { }

    // Camera to sane place
    viewer.camera.setView({
        destination: Cartesian3.fromDegrees(-20, 25, 2_500_000),
    });

    // make sure we don’t start black
    ensureBaseLayer();
    viewer.scene.requestRender();

    // --------- Diagnostics: tile progress
    let detachTileDiag: (() => void) | null = null;
    function attachTileDiagnostics() {
        if (detachTileDiag) {
            try {
                detachTileDiag();
            } catch { }
            detachTileDiag = null;
        }
        let last = -1;
        const g = getGlobe();
        const on = (n: number) => {
            if (n !== last) {
                last = n;
                if (n === 0) console.log("[tileLoadProgress] ✅ All imagery tiles loaded");
            }
        };
        g.tileLoadProgressEvent.addEventListener(on);
        detachTileDiag = () => {
            try {
                g.tileLoadProgressEvent.removeEventListener(on);
            } catch { }
        };
    }
    attachTileDiagnostics();

    // --------- Ready clamp (optional safety)
    const MIN_AGL_METERS = 50;
    let mapReady = false;
    function clampAGL() {
        if (!mapReady) return;
        try {
            const globe = getGlobe();
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
                    getScene().requestRender();
                }
            }
        } catch { }
    }

    function wireReadiness() {
        mapReady = false;
        const sc = getScene();
        const ssc = getSSC();
        ssc.enableCollisionDetection = false;

        const mark = () => {
            const g = getGlobe();
            if (g?.tilesLoaded && (viewer.terrainProvider?.ready ?? true)) {
                mapReady = true;
                ssc.enableCollisionDetection = true;
                sc.postRender.addEventListener(clampAGL);
            }
        };

        const onTiles = (c: number) => {
            if (c === 0) mark();
        };
        const g = getGlobe();
        g.tileLoadProgressEvent.addEventListener(onTiles);
        sc.postRender.addEventListener(mark);
    }
    wireReadiness();
    getSSC().minimumZoomDistance = 50;

    // --------- Imagery
    function clearImagery() {
        const layers = getScene().imageryLayers;
        for (let i = layers.length - 1; i >= 0; i--) {
            try {
                layers.remove(layers.get(i), true);
            } catch { }
        }
    }

    function setImageryProvider(provider: ImageryProvider) {
        const sc = getScene();
        if (!provider) {
            console.warn("[useGlobe] setImageryProvider: no provider");
            return;
        }
        const layers = sc.imageryLayers;
        clearImagery();
        const layer = layers.addImageryProvider(provider);
        sc.globe.material = undefined;
        layer.alpha = 1;
        layer.show = true;
        sc.requestRender();
        console.log("[useGlobe] Imagery provider set:", provider.constructor.name);
    }

    // Utility: clone the current base imagery (so rebuild keeps it)
    function cloneImageryProvider(p?: ImageryProvider): ImageryProvider {
        if (!p) {
            return new OpenStreetMapImageryProvider({
                url: "https://tile.openstreetmap.org/",
            });
        }
        const ap: any = p;
        const name = ap?.constructor?.name;

        if (name === "OpenStreetMapImageryProvider") {
            return new OpenStreetMapImageryProvider({
                url: ap.url ?? "https://tile.openstreetmap.org/",
                credit: ap.credit ?? "\u00A9 OpenStreetMap contributors",
            });
        }
        if (name === "UrlTemplateImageryProvider") {
            const url =
                ap.url ||
                ap._resource?.url ||
                "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
            const max = ap.maximumLevel ?? 19;
            return new UrlTemplateImageryProvider({
                url,
                maximumLevel: max,
                tilingScheme: new WebMercatorTilingScheme(),
                credit: ap.credit ?? "",
            });
        }
        // fallback
        return new OpenStreetMapImageryProvider({
            url: "https://tile.openstreetmap.org/",
        });
    }

    // --------- Exaggeration & elevation toggles
    function runtimeExagSupported(): boolean {
        // Modern Cesium exposes vertical exaggeration on Scene
        const sc: any = getScene();
        return "verticalExaggeration" in sc && "verticalExaggerationRelativeHeight" in sc;
    }

    // Rebuild viewer when needed (preserves camera + baselayer)
    async function rebuild(): Promise<void> {
        console.log("[useGlobe] Rebuild start", { elevationEnabled, exag });
        const container = viewer.container as HTMLDivElement;

        // snapshot camera & imagery
        const pos = viewer.camera.positionWC.clone();
        const dir = viewer.camera.directionWC.clone();
        const up = viewer.camera.upWC.clone();

        const layers = getScene().imageryLayers;
        const activeLayer = layers.length > 0 ? layers.get(0) : undefined;
        const activeProvider = activeLayer?.imageryProvider;
        const baseProv = cloneImageryProvider(
            activeProvider ?? opts.imageryProvider ?? defaultOSM
        );

        try {
            detachTileDiag?.();
        } catch { }

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
            terrain: makeTerrain(), // respects elevationEnabled
            imageryProvider: baseProv, // preserve base layer
        });

        const sc = getScene();
        sc.backgroundColor = Color.BLACK;
        (sc as any).clearColor = Color.BLACK;
        sc.fog.enabled = false;
        sc.highDynamicRange = false;

        // Re-apply exaggeration on Scene after rebuild
        try {
            (sc as any).verticalExaggeration = Math.max(0, exag || 0);
            (sc as any).verticalExaggerationRelativeHeight = 0;
        } catch { }

        viewer.camera.setView({ destination: pos, orientation: { direction: dir, up } });
        getSSC().minimumZoomDistance = 50;

        attachTileDiagnostics();
        wireReadiness();

        // nudge + render
        try {
            const c = viewer.camera;
            c.moveForward(0.001);
            c.moveBackward(0.001);
        } catch { }
        sc.requestRender(); // ensure immediate draw
        console.log("[useGlobe] Rebuild done");
    }

    async function setElevationEnabled(enabled: boolean): Promise<void> {
        elevationEnabled = enabled;

        // Swap terrain and keep the same scene exaggeration
        viewer.terrain = makeTerrain();

        // keep various references in sync for older Cesium patterns
        (viewer as any).terrainProvider = (viewer.terrain as any)?.provider ?? null;
        (getScene() as any).terrainProvider = (viewer.terrain as any)?.provider ?? null;
        (getGlobe() as any).terrainProvider = (viewer.terrain as any)?.provider ?? null;

        // nudge + render
        try {
            const c = viewer.camera;
            c.moveForward(0.001);
            c.moveBackward(0.001);
        } catch { }
        getScene().requestRender();

        console.log("[useGlobe] Elevation:", elevationEnabled, "exag(scene):", (getScene() as any).verticalExaggeration);
    }

    async function setExaggeration(factor: number): Promise<void> {
        exag = Math.max(0, factor);

        if (!runtimeExagSupported()) {
            // Super defensive fallback (older builds) – rebuild to apply
            await rebuild();
            console.log("[useGlobe] Exaggeration set (fallback rebuild):", exag);
            return;
        }

        // Modern path: write directly to Scene
        const sc: any = getScene();
        sc.verticalExaggeration = exag;
        sc.verticalExaggerationRelativeHeight = 0;

        // If exag == 0, we can optionally disable elevation to save work
        const wantElevation = exag > 0;
        if (wantElevation !== elevationEnabled) {
            await setElevationEnabled(wantElevation);
        }

        // nudge to ensure redraw
        try {
            const c = viewer.camera;
            c.moveForward(0.001);
            c.moveBackward(0.001);
        } catch { }
        sc.requestRender();

        console.log("[useGlobe] Exaggeration set (scene):", exag);
    }

    // --------- Minimal picking (kept simple)
    let handler: ScreenSpaceEventHandler | null = new ScreenSpaceEventHandler(
        getScene().canvas
    );
    handler.setInputAction((click) => {
        const picked = getScene().pick(click.position);
        const id: any = picked?.id;
        if (id?.id) console.log("[pick] entity:", id.id);
    }, ScreenSpaceEventType.LEFT_CLICK);

    function destroy() {
        try {
            handler?.destroy();
        } catch { }
        handler = null;
        try {
            detachTileDiag?.();
        } catch { }
        viewer.destroy();
    }

    // --------- Debug helpers
    (globalThis as any).GL = {
        get viewer() {
            return viewer;
        },
        get scene() {
            return getScene();
        },
        get globe() {
            return getGlobe();
        },
        dumpLayers() {
            const layers = getScene().imageryLayers;
            console.log("[dumpLayers] count=", layers.length);
            for (let i = 0; i < layers.length; i++) {
                const ly = layers.get(i) as any;
                const p = ly.imageryProvider as any;
                console.log(`[layer ${i}]`, {
                    alpha: ly.alpha,
                    show: ly.show,
                    type: p?.constructor?.name,
                    url: p?.url || p?._resource?.url,
                    tiling: p?.tilingScheme?.constructor?.name,
                    min: p?.minimumLevel,
                    max: p?.maximumLevel,
                });
            }
        },
        info() {
            const sc: any = getScene();
            const g: any = getGlobe();
            const t: any = (viewer as any).terrain;
            const prov =
                t?.provider ??
                (viewer as any).terrainProvider ??
                (getScene() as any).terrainProvider ??
                (g as any).terrainProvider ??
                null;
            console.log({
                elevationEnabled,
                exag,
                runtimeExagSupported:
                    "verticalExaggeration" in sc &&
                    "verticalExaggerationRelativeHeight" in sc,
                provider: prov?.constructor?.name ?? "null",
                ready: !!prov?.ready,
                sceneVerticalExaggeration: sc.verticalExaggeration,
            });
        },
    };

    // --------- Public API
    return {
        viewer,
        setImageryProvider,
        setElevationEnabled,
        setExaggeration,
        rebuild,
        destroy,
    };
}
