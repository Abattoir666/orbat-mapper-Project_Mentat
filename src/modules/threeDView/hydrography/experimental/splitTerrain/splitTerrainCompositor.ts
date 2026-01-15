// src/modules/threeDView/hydrography/experimental/splitTerrain/splitTerrainCompositor.ts
import {
    Viewer,
    Globe,
    Ellipsoid,
    Color,
    OpenStreetMapImageryProvider,
    type Viewer as CesiumViewer,
} from "cesium";

import { createTerrainForKey } from "@/geo/cesiumTerrain";
import { installCameraSync } from "./cameraSync";
import { loadOceanPolys, rasterizeOceanMask } from "./oceanMaskRasterizer";
import { createWebglCompositor } from "./webglCompositor";
import type { SplitTerrainCompositorHandle, SplitTerrainCompositorOptions } from "./types";

function setAllCanvasesOpacity(container: HTMLElement, opacity: string) {
    const canvases = container.querySelectorAll("canvas");
    canvases.forEach((c) => ((c as HTMLCanvasElement).style.opacity = opacity));
}

export async function createSplitTerrainCompositor(
    opts: SplitTerrainCompositorOptions
): Promise<SplitTerrainCompositorHandle> {
    const topViewer: CesiumViewer = opts.topViewer;
    const host = topViewer.container as HTMLElement;

    // Bottom viewer host (behind)
    const bottomHost = document.createElement("div");
    bottomHost.style.position = "absolute";
    bottomHost.style.inset = "0";
    bottomHost.style.zIndex = "0";
    bottomHost.style.pointerEvents = "none";
    bottomHost.style.opacity = "0";
    host.style.position = "relative";
    host.prepend(bottomHost);

    // Output compositor canvas (visually on top, but inputs pass through)
    const outCanvas = document.createElement("canvas");
    outCanvas.style.position = "absolute";
    outCanvas.style.inset = "0";
    outCanvas.style.zIndex = "2";
    outCanvas.style.pointerEvents = "none";
    outCanvas.style.opacity = "0";
    host.appendChild(outCanvas);

    // Optional debug mask canvas
    const maskCanvas = document.createElement("canvas");
    maskCanvas.style.position = "absolute";
    maskCanvas.style.inset = "0";
    maskCanvas.style.zIndex = "3";
    maskCanvas.style.pointerEvents = "none";
    maskCanvas.style.opacity = "0";
    host.appendChild(maskCanvas);

    // Bottom viewer (bathymetry)
    const bottomViewer = new Viewer(bottomHost, {
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
        globe: (() => {
            const g = new Globe(Ellipsoid.WGS84);
            g.baseColor = Color.BLACK;
            g.enableLighting = true;
            g.depthTestAgainstTerrain = true;
            (g as any).showWaterEffect = false;
            return g;
        })(),
        terrain: createTerrainForKey("bathy", true),
        imageryProvider: new OpenStreetMapImageryProvider({
            url: "https://tile.openstreetmap.org/",
            credit: "© OpenStreetMap contributors",
        }),
    });

    // Bottom viewer should not accept input
    bottomViewer.scene.screenSpaceCameraController.enableInputs = false;

    const destroyCameraSync = installCameraSync(topViewer, bottomViewer);
    const polys = await loadOceanPolys(opts.oceanGeoJsonUrl);
    const compositor = createWebglCompositor(outCanvas);

    const maxFps = Math.max(1, opts.maxFps ?? 30);
    const frameMinMs = 1000 / maxFps;

    let enabled = false;
    let raf = 0;
    let last = 0;
    let killed = false;

    const tick = (ts: number) => {
        raf = 0;
        if (!enabled || killed) return;

        if (ts - last < frameMinMs) {
            raf = requestAnimationFrame(tick);
            return;
        }
        last = ts;

        rasterizeOceanMask(topViewer, maskCanvas, polys);

        try {
            compositor.render(topViewer.canvas, bottomViewer.canvas, maskCanvas);
        } catch (e) {
            // Most common failure: CORS-tainted Cesium canvas prevents texImage2D(canvas)
            console.warn("[splitTerrain] compositor failed; disabling split mode", e);
            enabled = false;
            setAllCanvasesOpacity(host, "1");
            bottomHost.style.opacity = "0";
            outCanvas.style.opacity = "0";
            maskCanvas.style.opacity = "0";
            return;
        }

        raf = requestAnimationFrame(tick);
    };

    const enable = async () => {
        if (killed) return;
        enabled = true;

        // In split mode, top viewer should represent LAND baseline.
        try {
            (topViewer as any).terrain = createTerrainForKey("world", true) as any;
        } catch {
            // ignore
        }

        // Hide raw Cesium canvases, show compositor output
        setAllCanvasesOpacity(host, "0");
        bottomHost.style.opacity = "1";
        outCanvas.style.opacity = "1";
        maskCanvas.style.opacity = opts.debugShowMask ? "0.6" : "0";

        if (!raf) raf = requestAnimationFrame(tick);
    };

    const disable = () => {
        enabled = false;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;

        // Restore normal view
        setAllCanvasesOpacity(host, "1");
        bottomHost.style.opacity = "0";
        outCanvas.style.opacity = "0";
        maskCanvas.style.opacity = "0";
    };

    const destroy = () => {
        killed = true;
        disable();
        destroyCameraSync();
        compositor.destroy();
        try {
            bottomViewer.destroy();
        } catch { }
        bottomHost.remove();
        outCanvas.remove();
        maskCanvas.remove();
    };

    return { enable, disable, destroy };
}
