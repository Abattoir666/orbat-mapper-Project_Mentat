// installations.ts
import {
    Cartesian2,
    Cartesian3,
    Color,
    HeightReference,
    HorizontalOrigin,
    VerticalOrigin,
    DistanceDisplayCondition,
    LabelStyle,
    PolygonHierarchy,
} from "cesium";
import * as Cesium from "cesium";

/** WGS84 radius (meters) */
const EARTH_R = 6378137;

/** Convert half-width/half-height in meters to delta-degrees at latitude */
function metersToDeg(lon: number, lat: number, halfWidthM: number, halfHeightM: number) {
    const latRad = (lat * Math.PI) / 180;
    const dLatDeg = (halfHeightM / EARTH_R) * (180 / Math.PI);
    const dLonDeg = (halfWidthM / (EARTH_R * Math.cos(latRad))) * (180 / Math.PI);
    return { dLonDeg, dLatDeg };
}

// (kept) label helper
function makeSideLabel(
    text: string,
    heightRef: HeightReference,
    side: "left" | "right" = "left",
    pixelOffsetY: number = -12,
) {
    const isLeft = side === "left";
    const offsetX = isLeft ? -12 : 12;
    const hOrigin = isLeft ? HorizontalOrigin.RIGHT : HorizontalOrigin.LEFT;

    return {
        text,
        font: "bold 14px 'Segoe UI', system-ui, -apple-system, Roboto, Arial",
        style: LabelStyle.FILL_AND_OUTLINE,
        fillColor: Color.BLACK,
        outlineColor: Color.WHITE,
        outlineWidth: 3,
        showBackground: false,
        heightReference: heightRef,
        verticalOrigin: VerticalOrigin.BOTTOM,
        horizontalOrigin: hOrigin,
        pixelOffset: new Cartesian2(offsetX, pixelOffsetY),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new DistanceDisplayCondition(0.0, 2_000_000.0),
        scaleByDistance: new Cesium.NearFarScalar(800, 1.1, 2_000_000, 0.5),
        translucencyByDistance: new Cesium.NearFarScalar(50_000, 1.0, 1_500_000, 0.4),
        pixelOffsetScaleByDistance: new Cesium.NearFarScalar(800, 1.0, 2_000_000, 0.4),
    };
}

/** Robust installation detector across common APP-6/2525 layouts. */
export function isInstallationBySidc(u: any): boolean {
    const sidc: string | undefined =
        u?.sidc ?? u?.symbolOptions?.sidc ?? (u as any)?.__sourceUnit?.sidc;
    if (typeof sidc !== "string") return false;
    const s = sidc.trim();

    // Standard APP-6C/D: "installation" appears as code "20" in the function ID.
    // Try both common placements (0-based slice):
    //   - positions 4..6  (5th-6th chars)
    //   - positions 10..12 (11th-12th chars)  — seen in some pipelines
    const a = s.length >= 6 && s.slice(4, 6) === "20";
    const b = s.length >= 12 && s.slice(10, 12) === "20";

    // Also accept explicit flags if your pipeline sets them
    const f = !!(u?.isInstallation || u?.symbolOptions?.isInstallation);

    return a || b || f;
}

export function resolveFillCssWithParents(
    u: any,
    getParentById?: (id: string) => any | undefined
): string | undefined {
    const direct = u?.blockColorCss ?? u?.symbolOptions?.fillColor ?? u?.fillColorCss;
    if (direct) return direct;
    if (!getParentById) return undefined;

    const visited = new Set<string>();
    let cur: any = u;
    while (cur && (cur._pid || cur.parent_id)) {
        const pid = (cur._pid ?? cur.parent_id) as string;
        if (!pid || visited.has(pid)) break;
        visited.add(pid);
        const p = getParentById(pid);
        if (!p) break;
        const c = p?.blockColorCss ?? p?.symbolOptions?.fillColor ?? p?.fillColorCss;
        if (c) return c;
        cur = p;
    }
    return undefined;
}

export type UnitRenderable = {
    id: string;
    name?: string;
    lat: number; lon: number;
    blockSize?: { x: number; y: number; z: number }; // meters
    blockColorCss?: string;
    labelOffsetPxY?: number;
};

export function applyInstallationGraphics(
    ent: Cesium.Entity,
    u: UnitRenderable,
    opts?: {
        getParentById?: (id: string) => any | undefined;
        defaultSize?: { x: number; y: number; z: number };
        /** "footprint" = flat on terrain (2D-style); "block" = sticks out of ground */
        style?: "footprint" | "block";
    }
) {
    const style = opts?.style ?? "footprint";
    const size = u.blockSize ?? opts?.defaultSize ?? { x: 20, y: 20, z: 10 };
    const css =
        resolveFillCssWithParents(u as any, opts?.getParentById) ??
        u.blockColorCss ??
        "rgba(255,255,255,0.92)";
    const color = Color.fromCssColorString(css);

    // Clear other graphics first
    ent.billboard = undefined as any;
    ent.point = undefined as any;
    ent.box = undefined as any;
    ent.rectangle = undefined as any;

    if (style === "footprint") {
        // Build a small ground-clamped polygon centered at lon/lat, sized in meters
        const halfW = size.x / 2;
        const halfH = size.y / 2;
        const { dLonDeg, dLatDeg } = metersToDeg(u.lon, u.lat, halfW, halfH);

        const west = u.lon - dLonDeg;
        const east = u.lon + dLonDeg;
        const south = u.lat - dLatDeg;
        const north = u.lat + dLatDeg;

        // 4-corner polygon (clockwise), clamped to terrain
        const corners = Cesium.Cartesian3.fromDegreesArray([
            west, south,   // SW
            east, south,   // SE
            east, north,   // NE
            west, north,   // NW
        ]);

        // Clear other graphics
        ent.billboard = undefined as any;
        ent.point = undefined as any;
        ent.box = undefined as any;
        ent.rectangle = undefined as any;

        ent.position = undefined; // polygon doesn't need a position anchor
        ent.polygon = {
            hierarchy: new Cesium.PolygonHierarchy(corners),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            material: color,
            outline: true,
            outlineColor: Color.BLACK,
            classificationType: Cesium.ClassificationType.TERRAIN,
            // Visibility controls (optional)
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 2_000_000.0),
        } as Cesium.PolygonGraphics;
    } else {
        // (unchanged) "block" style
        const agl = Math.max(0.1, size.z / 2);
        ent.position = Cesium.Cartesian3.fromDegrees(u.lon, u.lat, agl);
        ent.box = {
            dimensions: new Cartesian3(size.x, size.y, size.z),
            material: color,
            heightReference: HeightReference.RELATIVE_TO_GROUND,
            outline: true,
            outlineColor: Color.BLACK,
        } as Cesium.BoxGraphics;
    }


    if (u.name) {
        const lift = u.labelOffsetPxY ?? -14;
        ent.label = makeSideLabel(u.name, HeightReference.RELATIVE_TO_GROUND, "left", lift) as any;
    } else {
        ent.label = undefined;
    }
}
