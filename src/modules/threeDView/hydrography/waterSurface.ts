import {
    GeoJsonDataSource,
    Color,
    ColorMaterialProperty,
    HeightReference,
    type Viewer,
} from "cesium";

export type WaterSurfaceConfig = {
    url?: string;
    geojson?: any;
    heightMeters?: number; // slight lift reduces z-fighting
    baseColor?: Color;
};

type NormalizedCfg = {
    url?: string;
    geojson?: any;
    heightMeters: number;
    baseColor: Color;
};

export class WaterSurfaceLayer {
    private viewer: Viewer;
    private cfg: NormalizedCfg;

    private ds: GeoJsonDataSource | null = null;
    private alpha = 0.45;

    constructor(viewer: Viewer, cfg: WaterSurfaceConfig) {
        if (!viewer) throw new Error("WaterSurfaceLayer: viewer is required");

        this.viewer = viewer;
        this.cfg = {
            url: cfg.url,
            geojson: cfg.geojson,
            heightMeters: cfg.heightMeters ?? 0.5,
            baseColor: cfg.baseColor ?? Color.fromCssColorString("#2b6cff"),
        };
    }

    // Arrow functions bind `this` even if the method is passed around.
    setEnabled = async (on: boolean): Promise<void> => {
        if (!on) {
            if (this.ds) this.ds.show = false;
            this.viewer.scene.requestRender();
            return;
        }

        // Disable Cesium water shader so it doesn't fight our translucent surface.
        this.viewer.scene.globe.showWaterEffect = false;

        if (!this.ds) {
            const source = this.cfg.geojson ?? this.cfg.url;
            if (!source) throw new Error("WaterSurfaceLayer: missing geojson or url");

            this.ds = await GeoJsonDataSource.load(source, { clampToGround: false });

            const mat = new ColorMaterialProperty(this.computeColor());
            for (const e of this.ds.entities.values) {
                const p = e.polygon;
                if (!p) continue;

                p.material = mat;
                p.outline = false;

                // Sea-level plane (NOT clamped)
                p.height = this.cfg.heightMeters;
                p.heightReference = HeightReference.NONE;
                p.perPositionHeight = false;
            }

            this.viewer.dataSources.add(this.ds);
        }

        this.ds.show = true;
        this.viewer.scene.requestRender();
    };

    setAlpha = (alpha01: number): void => {
        this.alpha = Math.max(0, Math.min(1, alpha01));

        if (this.ds) {
            const mat = new ColorMaterialProperty(this.computeColor());
            for (const e of this.ds.entities.values) {
                if (e.polygon) e.polygon.material = mat;
            }
        }

        this.viewer.scene.requestRender();
    };

    private computeColor(): Color {
        const c = this.cfg.baseColor.clone();
        c.alpha = this.alpha;
        return c;
    }
}
