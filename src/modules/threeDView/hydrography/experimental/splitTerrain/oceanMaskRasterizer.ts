// src/modules/threeDView/hydrography/experimental/splitTerrain/oceanMaskRasterizer.ts
import {
    Cartesian3,
    Cartographic,
    Ellipsoid,
    SceneTransforms,
    type Viewer,
} from "cesium";

type RingDeg = Array<[number, number]>; // [lon, lat] degrees
type PolyDeg = { outer: RingDeg; holes: RingDeg[] };

export async function loadOceanPolys(url: string): Promise<PolyDeg[]> {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) throw new Error(`loadOceanPolys: ${res.status} ${res.statusText}`);

    const gj = await res.json();
    const polys: PolyDeg[] = [];

    const pushPoly = (outer: any[], holes: any[][] = []) => {
        const conv = (ring: any[]): RingDeg => ring.map((p) => [Number(p[0]), Number(p[1])]);
        polys.push({
            outer: conv(outer),
            holes: holes.map(conv),
        });
    };

    const handleGeom = (g: any) => {
        if (!g) return;
        if (g.type === "Polygon") {
            const [outer, ...holes] = g.coordinates ?? [];
            if (outer?.length) pushPoly(outer, holes);
        } else if (g.type === "MultiPolygon") {
            for (const poly of g.coordinates ?? []) {
                const [outer, ...holes] = poly ?? [];
                if (outer?.length) pushPoly(outer, holes);
            }
        } else if (g.type === "GeometryCollection") {
            for (const gg of g.geometries ?? []) handleGeom(gg);
        }
    };

    if (gj.type === "FeatureCollection") {
        for (const f of gj.features ?? []) handleGeom(f.geometry);
    } else if (gj.type === "Feature") {
        handleGeom(gj.geometry);
    } else {
        handleGeom(gj);
    }

    return polys;
}

function worldToCssWindowXY(viewer: Viewer, world: Cartesian3): { x: number; y: number } | null {
    const scene: any = viewer.scene;
    const ST: any = SceneTransforms as any;

    let p: any = null;

    // Prefer true window coordinates when available
    if (ST && typeof ST.wgs84ToWindowCoordinates === "function") {
        p = ST.wgs84ToWindowCoordinates(scene, world);
    } else if (scene && typeof scene.cartesianToCanvasCoordinates === "function") {
        // Common fallback in many Cesium builds
        p = scene.cartesianToCanvasCoordinates(world);
    } else if (ST && typeof ST.wgs84ToDrawingBufferCoordinates === "function") {
        // Last resort
        p = ST.wgs84ToDrawingBufferCoordinates(scene, world);
    }

    if (!p) return null;

    let x = Number(p.x);
    let y = Number(p.y);

    // Normalize to CSS pixels if we got drawing-buffer coords.
    // Heuristic: if coords exceed CSS size but fit in buffer size, treat as buffer coords.
    const canvas = viewer.canvas as HTMLCanvasElement;
    const cssW = canvas.clientWidth || canvas.width;
    const cssH = canvas.clientHeight || canvas.height;
    const bufW = canvas.width || cssW;
    const bufH = canvas.height || cssH;

    const fitsCss = x >= -2 && x <= cssW + 2 && y >= -2 && y <= cssH + 2;
    const fitsBuf = x >= -2 && x <= bufW + 2 && y >= -2 && y <= bufH + 2;

    if (!fitsCss && fitsBuf && bufW && bufH && cssW && cssH) {
        x = x * (cssW / bufW);
        y = y * (cssH / bufH);
    }

    return { x, y };
}


/**
 * Paints a full-screen mask:
 * - black = land (mask.r = 0)
 * - white = ocean (mask.r = 1)
 *
 * Uses even-odd fill so holes behave correctly.
 */
export function rasterizeOceanMask(viewer: Viewer, maskCanvas: HTMLCanvasElement, polys: PolyDeg[]) {
    const w = viewer.canvas.clientWidth | 0;
    const h = viewer.canvas.clientHeight | 0;

    // If the viewer isn't laid out yet, avoid producing a 0x0 mask.
    if (w <= 2 || h <= 2) return;

    if (maskCanvas.width !== w) maskCanvas.width = w;
    if (maskCanvas.height !== h) maskCanvas.height = h;

    const ctx = maskCanvas.getContext("2d");
    if (!ctx) return;

    // Background: land = black
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, w, h);

    // Oceans: white
    ctx.fillStyle = "white";

    const ellipsoid = Ellipsoid.WGS84;

    const addRingToPath = (ring: RingDeg) => {
        let started = false;

        for (const [lon, lat] of ring) {
            // Convert to window coords
            const carto = Cartographic.fromDegrees(lon, lat, 0);
            const world = ellipsoid.cartographicToCartesian(carto, new Cartesian3());

            const win = worldToCssWindowXY(viewer, world);

            if (!win) {
                started = false;
                continue;
            }

            if (!started) {
                ctx.moveTo(win.x, win.y);
                started = true;
            } else {
                ctx.lineTo(win.x, win.y);
            }
        }

        if (started) ctx.closePath();
    };

    // One global path is fine; even-odd fill will handle holes.
    ctx.beginPath();
    for (const p of polys) {
        addRingToPath(p.outer);
        for (const hole of p.holes) addRingToPath(hole);
    }
    ctx.fill("evenodd");
}
