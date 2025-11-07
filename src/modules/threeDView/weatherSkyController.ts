// src/modules/threeDView/weatherSkyController.ts
import * as Cesium from "cesium";

/** ───────────────────────── Feature Flag ─────────────────────────
 * Set in `.env.local`:
 *   VITE_ENABLE_CLOUDS=false
 * Flip to `true` later and restart Vite to re-enable.
 */
const CLOUDS_ENABLED = (import.meta.env.VITE_ENABLE_CLOUDS ?? "false") === "true";

/** Modern, valid GIBS cloud layers we actually request (EPSG:4326) */
type GibsCloudProduct =
    | "MODIS_Aqua_Cloud_Fraction_Day"
    | "MODIS_Terra_Cloud_Fraction_Day";

/** Rendering modes */
type CloudRenderMode = "imagery" | "particles";

export type GibsCloudOptions = {
    /** Valid modern ID or a legacy alias; we normalize it. */
    product?: string | GibsCloudProduct;
    /** "2km" or "1km"; MODIS cloud-fraction is typically "2km". */
    tileMatrixSet?: "2km" | "1km";
    /** Date YYYY-MM-DD; if omitted (and autoDate=true) we use scenario clock. */
    date?: string;
    /** If true, update date whenever onTimeChanged(...) is called. */
    autoDate?: boolean;
    /** 0..1 opacity (both modes honor this). */
    opacity?: number;
    /** Simple mask-like look (imagery mode only; we also cull colors). */
    asMask?: boolean;
    /** "imagery" (draped) or "particles" (~10k ft above terrain). */
    mode?: CloudRenderMode;

    /** Particle tuning (only used in "particles" mode) */
    particle?: {
        /** Meters above *terrain* (or ellipsoid if terrain unavailable). Default ≈ 3048 (~10k ft). */
        heightMeters?: number;
        /** Sample step in source tile (bigger = fewer particles). Default 4. */
        sampleStep?: number;
        /** Base pixel size (scaled by intensity). Default 2. */
        baseSize?: number;
        /** Intensity to alpha scale (0..1 multiplier). Default 1.0. */
        alphaScale?: number;
        /** Max particles cap (safety). Default 60_000. */
        maxParticles?: number;
    };
};

function fmtYmd(epochMs: number) {
    const d = new Date(epochMs);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

/** Legacy → modern product mapping */
const LEGACY_PRODUCT_ALIASES: Record<string, GibsCloudProduct> = {
    MODIS_Aqua_Cloud_Mask_Daily: "MODIS_Aqua_Cloud_Fraction_Day",
    MODIS_Terra_Cloud_Mask_Daily: "MODIS_Terra_Cloud_Fraction_Day",
};

const PRODUCT_RANGE: Record<GibsCloudProduct, { start: string; end: string }> = {
    MODIS_Terra_Cloud_Fraction_Day: { start: "2000-02-24", end: "2022-12-31" },
    MODIS_Aqua_Cloud_Fraction_Day: { start: "2002-07-04", end: "2025-12-31" }, // generous end
};

function isValidProduct(p: string): p is GibsCloudProduct {
    return (
        p === "MODIS_Aqua_Cloud_Fraction_Day" ||
        p === "MODIS_Terra_Cloud_Fraction_Day"
    );
}

function normalizeProduct(input: string | undefined, dateYmd: string): GibsCloudProduct {
    let p = input || "MODIS_Aqua_Cloud_Fraction_Day";
    if (!isValidProduct(p)) p = LEGACY_PRODUCT_ALIASES[p] || p;
    if (!isValidProduct(p)) {
        console.warn(
            "[GIBS] Unknown product id:",
            input,
            "→ falling back to MODIS_Aqua_Cloud_Fraction_Day"
        );
        p = "MODIS_Aqua_Cloud_Fraction_Day";
    }
    if (p === "MODIS_Terra_Cloud_Fraction_Day" && dateYmd > PRODUCT_RANGE[p].end)
        return "MODIS_Aqua_Cloud_Fraction_Day";
    if (p === "MODIS_Aqua_Cloud_Fraction_Day" && dateYmd < PRODUCT_RANGE[p].start)
        return "MODIS_Terra_Cloud_Fraction_Day";
    return p;
}

function clampDateToRange(dateYmd: string, product: GibsCloudProduct) {
    const r = PRODUCT_RANGE[product];
    if (dateYmd < r.start) return r.start;
    if (dateYmd > r.end) return r.end;
    return dateYmd;
}

/** TileMatrix labels for EPSG:4326 */
const TILE_LABELS: Record<"2km" | "1km", string[]> = {
    "2km": ["0", "1", "2", "3", "4", "5", "6", "7"],
    "1km": ["0", "1", "2", "3", "4", "5", "6", "7", "8"],
};

/** Small transparent canvas used when clouds are globally disabled to preserve types without network I/O */
function transparentCanvas(w = 1, h = 1): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    return canvas;
}

/** --- Simple utility: sample a WMTS tile into a canvas --- */
async function fetchTileToCanvas(url: string): Promise<HTMLCanvasElement> {
    if (!CLOUDS_ENABLED) return transparentCanvas(); // short-circuit when disabled
    const img = await Cesium.Resource.fetchImage({ url, flipY: false });
    const canvas = document.createElement("canvas");
    canvas.width = (img as any).width;
    canvas.height = (img as any).height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img as any, 0, 0);
    return canvas;
}

/** Compute luminance 0..1 for RGB */
function luma(r: number, g: number, b: number) {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Try to decide if a pixel is “no-data/background” — GIBS palettes often include a solid low-end color. */
function isBackground(r: number, g: number, b: number): boolean {
    // Heuristic: strong red-ish or very dark/black treated as background; tweak if palette changes.
    const isRedBlob = r > 180 && g < 80 && b < 80;
    const isVeryDark = r < 8 && g < 8 && b < 8;
    return isRedBlob || isVeryDark;
}

export class WeatherSkyController {
    private viewer: Cesium.Viewer;
    private cloudLayer: Cesium.ImageryLayer | null = null; // imagery mode
    private particleCollection: Cesium.PointPrimitiveCollection | null = null; // (unused in sheets mode)
    private lastOpts: GibsCloudOptions | null = null;
    private currentDate: string | null = null;
    private cloudSheetEntities: Cesium.Entity[] = [];

    constructor(viewer: Cesium.Viewer) {
        this.viewer = viewer;
    }

    dispose() {
        if (this.cloudLayer) {
            try {
                this.viewer.imageryLayers.remove(this.cloudLayer, true);
            } catch { }
            this.cloudLayer = null;
        }
        if (this.particleCollection) {
            try {
                this.viewer.scene.primitives.remove(this.particleCollection);
            } catch { }
            this.particleCollection = null;
        }
        if (this.cloudSheetEntities.length) {
            try {
                for (const e of this.cloudSheetEntities) this.viewer.entities.remove(e);
            } catch { }
            this.cloudSheetEntities.length = 0;
        }
    }

    enableDayNight(enabled: boolean) {
        this.viewer.scene.globe.enableLighting = enabled;
        const g: any = this.viewer.scene.globe;
        if ("dynamicAtmosphereLighting" in g) g.dynamicAtmosphereLighting = enabled;
        if ("dynamicAtmosphereLightingFromSun" in g) g.dynamicAtmosphereLightingFromSun = enabled;
        this.viewer.scene.light = enabled ? new Cesium.SunLight() : undefined;
        this.viewer.shadows = enabled;
        if (this.viewer.shadowMap) {
            this.viewer.shadowMap.enabled = enabled;
            this.viewer.shadowMap.softShadows = true;
        }
    }

    enableSkybox(enabled: boolean) {
        if (!this.viewer.scene.skyAtmosphere) {
            this.viewer.scene.skyAtmosphere = new Cesium.SkyAtmosphere();
        }
        this.viewer.scene.skyAtmosphere.show = enabled;

        if (!this.viewer.scene.sun) this.viewer.scene.sun = new Cesium.Sun();
        if (!this.viewer.scene.moon) this.viewer.scene.moon = new Cesium.Moon();
        this.viewer.scene.sun.show = enabled;
        this.viewer.scene.moon.show = enabled;

        if (enabled) {
            try {
                this.viewer.scene.skyBox = new Cesium.SkyBox({
                    sources: {
                        positiveX: Cesium.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_px.jpg"),
                        negativeX: Cesium.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_mx.jpg"),
                        positiveY: Cesium.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_py.jpg"),
                        negativeY: Cesium.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_my.jpg"),
                        positiveZ: Cesium.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_pz.jpg"),
                        negativeZ: Cesium.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_mz.jpg"),
                    },
                });
            } catch {
                /* ok */
            }
        } else if (this.viewer.scene.skyBox) {
            this.viewer.scene.skyBox.show = false;
        }
    }

    /**
     * Enable/disable clouds.
     * - "imagery": draped WMTS (with background color culled via colorToAlpha)
     * - "particles": clustered sheets ~10k ft above terrain (non-blocking to base layers)
     */
    async enableCloudOverlay(enabled: boolean, options?: GibsCloudOptions) {
        // Always remember opts (so time changes can rebuild when re-enabled later)
        this.lastOpts = { ...options };

        // If globally disabled, just ensure everything is removed/no-op
        if (!CLOUDS_ENABLED || !enabled) {
            if (this.cloudLayer) {
                try {
                    this.viewer.imageryLayers.remove(this.cloudLayer, true);
                } catch { }
                this.cloudLayer = null;
            }
            if (this.particleCollection) {
                try {
                    this.viewer.scene.primitives.remove(this.particleCollection);
                } catch { }
                this.particleCollection = null;
            }
            if (this.cloudSheetEntities.length) {
                try {
                    for (const e of this.cloudSheetEntities) this.viewer.entities.remove(e);
                } catch { }
                this.cloudSheetEntities.length = 0;
            }
            if (!CLOUDS_ENABLED) {
                console.log("[Clouds] Globally disabled via VITE_ENABLE_CLOUDS=false.");
            }
            return;
        }

        const tileMatrixSet = options?.tileMatrixSet ?? "2km";
        const opacity = options?.opacity ?? 0.55;
        const mode: CloudRenderMode = options?.mode ?? "particles"; // default to sheets/particles

        // Date
        const requestedDate = options?.date ?? this.currentDate ?? "2024-07-15";
        const normalizedProduct = normalizeProduct(options?.product as string | undefined, requestedDate);
        const timeYmd = clampDateToRange(requestedDate, normalizedProduct);

        if (mode === "imagery") {
            // Build WMTS URL (RESTful)
            const url =
                `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/` +
                `${normalizedProduct}/default/${timeYmd}/${tileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png`;

            const start = Cesium.JulianDate.fromDate(new Date(`${timeYmd}T00:00:00Z`));
            const stop = Cesium.JulianDate.fromDate(new Date(`${timeYmd}T23:59:59Z`));

            const provider = new Cesium.WebMapTileServiceImageryProvider({
                url,
                layer: normalizedProduct,
                style: "default",
                format: "image/png",
                tileMatrixSetID: tileMatrixSet,
                tilingScheme: new Cesium.GeographicTilingScheme(),
                tileMatrixLabels: TILE_LABELS[tileMatrixSet],
                credit: "NASA GIBS",
                clock: this.viewer.clock,
                times: new Cesium.TimeIntervalCollection([new Cesium.TimeInterval({ start, stop })]),
            });

            if (this.cloudLayer) {
                try {
                    this.viewer.imageryLayers.remove(this.cloudLayer, true);
                } catch { }
                this.cloudLayer = null;
            }
            this.cloudLayer = this.viewer.imageryLayers.addImageryProvider(provider);
            this.cloudLayer.alpha = opacity;

            // Cull likely background (fixes “giant red blob”), keep clouds visible
            (this.cloudLayer as any).colorToAlpha = Cesium.Color.fromBytes(200, 0, 0, 255); // red-ish bg
            (this.cloudLayer as any).colorToAlphaThreshold = 0.2;

            if (options?.asMask) {
                this.cloudLayer.alpha = opacity;
            }

            console.log("[GIBS] imagery clouds mounted", {
                normalizedProduct,
                date: timeYmd,
                set: tileMatrixSet,
                url,
            });
            return;
        }

        // --------- CLUSTERED CLOUD SHEET MODE (lightweight, terrain-relative) ----------
        {
            // Remove previous imagery/particles
            if (this.cloudLayer) {
                try {
                    this.viewer.imageryLayers.remove(this.cloudLayer, true);
                } catch { }
            }
            this.cloudLayer = null;
            if (this.particleCollection) {
                try {
                    this.viewer.scene.primitives.remove(this.particleCollection);
                } catch { }
            }
            this.particleCollection = null;
            if (this.cloudSheetEntities.length) {
                try {
                    for (const e of this.cloudSheetEntities) this.viewer.entities.remove(e);
                } catch { }
                this.cloudSheetEntities.length = 0;
            }

            const level = tileMatrixSet === "2km" ? 2 : 3; // modest zoom
            const minClusterPixels = 5; // relaxed
            const luminanceThreshold = 0.04; // relaxed
            const sheetOffsetMeters = 3048; // ~10k ft above local terrain

            const tiling = new Cesium.GeographicTilingScheme();
            const viewRect =
                this.viewer.scene.camera.computeViewRectangle(tiling.ellipsoid) ??
                Cesium.Rectangle.MAX_VALUE;
            const center = Cesium.Rectangle.center(viewRect);
            const centerXY = tiling.positionToTileXY(center, level);

            // 5x5 around center to avoid edge cutoffs
            const tiles: Array<{ x: number; y: number; level: number }> = [];
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    tiles.push({ x: centerXY.x + dx, y: centerXY.y + dy, level });
                }
            }

            const clusterRects: Cesium.Rectangle[] = [];

            for (const t of tiles) {
                const url =
                    `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/` +
                    `${normalizedProduct}/default/${timeYmd}/${tileMatrixSet}/${t.level}/${t.y}/${t.x}.png`;

                let cv: HTMLCanvasElement | undefined;
                try {
                    cv = await fetchTileToCanvas(url);
                } catch {
                    continue;
                }
                if (!cv) continue;

                const w = cv.width,
                    h = cv.height;
                const ctx = cv.getContext("2d")!;
                const data = ctx.getImageData(0, 0, w, h).data;

                // Flood-fill clustering
                const visited = new Uint8Array(w * h);
                const rectForTile = tiling.tileXYToRectangle(t.x, t.y, t.level);

                function pxIndex(px: number, py: number) {
                    return (py * w + px) * 4;
                }

                for (let py = 0; py < h; py++) {
                    for (let px = 0; px < w; px++) {
                        const vi = py * w + px;
                        if (visited[vi]) continue;

                        const i = pxIndex(px, py);
                        const r = data[i],
                            g = data[i + 1],
                            b = data[i + 2],
                            a = data[i + 3];
                        if (a === 0 || isBackground(r, g, b) || luma(r, g, b) < luminanceThreshold) continue;

                        // New cluster
                        let minX = px,
                            maxX = px,
                            minY = py,
                            maxY = py;
                        const queue: Array<[number, number]> = [[px, py]];
                        visited[vi] = 1;

                        while (queue.length) {
                            const [qx, qy] = queue.pop()!;
                            minX = Math.min(minX, qx);
                            maxX = Math.max(maxX, qx);
                            minY = Math.min(minY, qy);
                            maxY = Math.max(maxY, qy);

                            // 4-neighbor
                            const neigh = [
                                [1, 0],
                                [-1, 0],
                                [0, 1],
                                [0, -1],
                            ] as const;
                            for (const [dx2, dy2] of neigh) {
                                const nx = qx + dx2,
                                    ny = qy + dy2;
                                if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                                const nvi = ny * w + nx;
                                if (visited[nvi]) continue;
                                const ii = pxIndex(nx, ny);
                                const rr = data[ii],
                                    gg = data[ii + 1],
                                    bb = data[ii + 2],
                                    aa = data[ii + 3];
                                if (aa === 0 || isBackground(rr, gg, bb) || luma(rr, gg, bb) < luminanceThreshold)
                                    continue;
                                visited[nvi] = 1;
                                queue.push([nx, ny]);
                            }
                        }

                        const clusterArea = (maxX - minX + 1) * (maxY - minY + 1);
                        if (clusterArea < minClusterPixels) continue;

                        // Convert bounding pixels → geographic rectangle
                        const west = Cesium.Math.lerp(rectForTile.west, rectForTile.east, minX / (w - 1));
                        const east = Cesium.Math.lerp(rectForTile.west, rectForTile.east, maxX / (w - 1));
                        const south = Cesium.Math.lerp(rectForTile.south, rectForTile.north, minY / (h - 1));
                        const north = Cesium.Math.lerp(rectForTile.south, rectForTile.north, maxY / (h - 1));

                        clusterRects.push(Cesium.Rectangle.fromRadians(west, south, east, north));
                    }
                }
            }

            // Loosen size a touch so tiny strips don't spam entities
            const relaxedClusterRects = clusterRects.filter((r) => {
                const w = r.east - r.west;
                const h = r.north - r.south;
                return w > Cesium.Math.toRadians(0.02) && h > Cesium.Math.toRadians(0.02);
            });

            console.log("[GIBS] cluster candidates:", {
                found: clusterRects.length,
                afterSizeFilter: relaxedClusterRects.length,
            });

            // Remove any previous sheets before drawing new ones
            if (this.cloudSheetEntities.length) {
                try {
                    for (const e of this.cloudSheetEntities) this.viewer.entities.remove(e);
                } catch { }
                this.cloudSheetEntities.length = 0;
            }

            // Helper: sample center terrain height (returns meters above ellipsoid)
            const sampleCenterHeight = async (rect: Cesium.Rectangle): Promise<number> => {
                const c = Cesium.Rectangle.center(rect);
                const carto = new Cesium.Cartographic(c.longitude, c.latitude);
                try {
                    if (this.viewer.terrainProvider && (this.viewer.terrainProvider as any).availability) {
                        const [sampled] = await Cesium.sampleTerrainMostDetailed(
                            this.viewer.terrainProvider,
                            [carto]
                        );
                        if (sampled && sampled.height != null && isFinite(sampled.height)) return sampled.height;
                    }
                } catch { }
                return 0; // ellipsoid
            };

            let made = 0;
            for (const rect of relaxedClusterRects) {
                const baseHeight = await sampleCenterHeight(rect);
                const sheetHeightMeters = baseHeight + sheetOffsetMeters;

                // Use entity rectangles at a fixed absolute height (not draped)
                const entity = this.viewer.entities.add({
                    rectangle: {
                        coordinates: rect,
                        height: sheetHeightMeters,
                        extrudedHeight: sheetHeightMeters,
                        material: new Cesium.Color(1, 1, 1, Math.min(1, opacity)),
                        outline: false,
                    },
                });
                this.cloudSheetEntities.push(entity);
                made++;
            }

            console.log("[GIBS] cloud sheets placed:", made);

            // If nothing got drawn, fall back to imagery to verify there is data
            if (made === 0) {
                console.warn(
                    "[GIBS] No cloud clusters after filtering — falling back to imagery to verify data."
                );
                const url =
                    `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/` +
                    `${normalizedProduct}/default/${timeYmd}/${tileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png`;

                const start = Cesium.JulianDate.fromDate(new Date(`${timeYmd}T00:00:00Z`));
                const stop = Cesium.JulianDate.fromDate(new Date(`${timeYmd}T23:59:59Z`));

                const provider = new Cesium.WebMapTileServiceImageryProvider({
                    url,
                    layer: normalizedProduct,
                    style: "default",
                    format: "image/png",
                    tileMatrixSetID: tileMatrixSet,
                    tilingScheme: new Cesium.GeographicTilingScheme(),
                    tileMatrixLabels: TILE_LABELS[tileMatrixSet],
                    credit: "NASA GIBS",
                    clock: this.viewer.clock,
                    times: new Cesium.TimeIntervalCollection([new Cesium.TimeInterval({ start, stop })]),
                });

                if (this.cloudLayer) {
                    try {
                        this.viewer.imageryLayers.remove(this.cloudLayer, true);
                    } catch { }
                }
                this.cloudLayer = this.viewer.imageryLayers.addImageryProvider(provider);
                this.cloudLayer.alpha = Math.max(opacity, 0.5);
                (this.cloudLayer as any).colorToAlpha = Cesium.Color.fromBytes(200, 0, 0, 255);
                (this.cloudLayer as any).colorToAlphaThreshold = 0.2;
            }

            return;
        }
    }

    /** Mount a near-real-time geostationary layer (e.g., GOES ABI) with time dimension. */
    async enableRealtimeClouds(
        enabled: boolean,
        opts: {
            layerId: string; // e.g., "GOES-East_ABI_GeoColor"
            tileMatrixSet?: "2km" | "1km"; // match the layer’s advertised set
            opacity?: number;
            // time control
            cadenceMinutes?: number; // e.g., 10
            time?: string; // ISO like "2025-10-27T12:30:00Z" (optional; else we round now)
            colorToAlpha?: Cesium.Color; // optional background culling
            colorToAlphaThreshold?: number;
        }
    ) {
        // If globally disabled or not enabled, ensure removal and bail
        if (!CLOUDS_ENABLED || !enabled) {
            if (this.cloudLayer) {
                try {
                    this.viewer.imageryLayers.remove(this.cloudLayer, true);
                } catch { }
            }
            this.cloudLayer = null;
            if (!CLOUDS_ENABLED) {
                console.log("[Realtime clouds] Globally disabled via VITE_ENABLE_CLOUDS=false.");
            }
            return;
        }

        const tileMatrixSet = opts.tileMatrixSet ?? "2km";
        const opacity = opts.opacity ?? 0.7;
        const cadence = Math.max(1, Math.floor(opts.cadenceMinutes ?? 10));

        // Remove sheets/particles if present
        if (this.cloudSheetEntities.length) {
            try {
                for (const e of this.cloudSheetEntities) this.viewer.entities.remove(e);
            } catch { }
            this.cloudSheetEntities.length = 0;
        }
        if (this.particleCollection) {
            try {
                this.viewer.scene.primitives.remove(this.particleCollection);
            } catch { }
            this.particleCollection = null;
        }

        // Round a time to cadence (or use provided)
        const roundToCadence = (d: Date) => {
            const t = new Date(d.toISOString());
            const m = t.getUTCMinutes();
            const snapped = Math.floor(m / cadence) * cadence;
            t.setUTCMinutes(snapped, 0, 0);
            return t.toISOString().replace(".000", "");
        };
        const timeIso = opts.time ?? roundToCadence(new Date());

        // Use the WMTS Capabilities endpoint style (cgi) + dimensions: { time }
        const provider = new Cesium.WebMapTileServiceImageryProvider({
            url: "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi",
            layer: opts.layerId,
            style: "default",
            format: "image/png",
            tileMatrixSetID: tileMatrixSet,
            tilingScheme: new Cesium.GeographicTilingScheme(),
            tileMatrixLabels:
                tileMatrixSet === "2km"
                    ? ["0", "1", "2", "3", "4", "5", "6", "7"]
                    : ["0", "1", "2", "3", "4", "5", "6", "7", "8"],
            credit: "NASA GIBS",
            dimensions: { time: timeIso }, // <— dynamic timestamp
        });

        if (this.cloudLayer) {
            try {
                this.viewer.imageryLayers.remove(this.cloudLayer, true);
            } catch { }
        }
        this.cloudLayer = this.viewer.imageryLayers.addImageryProvider(provider);
        this.cloudLayer.alpha = opacity;

        // Optional: cull background to get transparency (tune per layer)
        if (opts.colorToAlpha) {
            (this.cloudLayer as any).colorToAlpha = opts.colorToAlpha;
            (this.cloudLayer as any).colorToAlphaThreshold = opts.colorToAlphaThreshold ?? 0.2;
        }

        console.log("[Realtime clouds] mounted", { layer: opts.layerId, time: timeIso, cadence });

        // Tiny updater that re-snaps time and refreshes dimensions periodically
        const updateOnce = () => {
            const nowIso = roundToCadence(new Date());
            try {
                (provider as any)._dimensions.time = nowIso; // refresh WMTS time
                if (this.cloudLayer) this.cloudLayer.alpha = opacity; // keep alpha
                console.log("[Realtime clouds] update", nowIso);
            } catch { }
        };

        // Expose a simple interval on window so you can stop it elsewhere if desired
        (window as any).__realtimeCloudsInterval &&
            clearInterval((window as any).__realtimeCloudsInterval);
        (window as any).__realtimeCloudsInterval = setInterval(
            updateOnce,
            cadence * 60 * 1000
        );
        updateOnce(); // initial tick
    }

    /** Hook from globeAdapter.setTime(epochMs) */
    onTimeChanged(epochMs: number) {
        // If globally disabled, do nothing
        if (!CLOUDS_ENABLED) return;

        const d = fmtYmd(epochMs);
        if (this.currentDate === d) return;
        this.currentDate = d;

        if (!this.lastOpts?.autoDate) return;

        // Rebuild with new date
        this.enableCloudOverlay(true, {
            ...this.lastOpts,
            date: this.currentDate,
        });
    }
}
