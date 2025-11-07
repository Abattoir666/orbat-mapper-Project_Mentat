// src/modules/threeDView/unitMotion.ts
import {
  Cartesian3,
  Cartographic,
  CallbackProperty,
  SampledPositionProperty,
  JulianDate,
  Math as CesiumMath,
  sampleTerrainMostDetailed,
  type TerrainProvider,
} from "cesium";

/** Shape we’ll adapt from each unit. Adjust selectors to your data model. */
export type UnitLike = {
  id: string | number;
  // If you have discrete keyframes you fill this; otherwise leave undefined.
  // Times in UNIX ms, lon/lat in degrees, alt in meters (optional).
  motionKeyframes?: Array<{ t: number; lon: number; lat: number; alt?: number }>;

  // If your 2D engine computes position procedurally, provide an evaluator:
  // given UNIX ms → {lon,lat,alt?}. Return undefined when off-map/not moving.
  getPositionAtTime?: (tUnixMs: number) =>
    | { lon: number; lat: number; alt?: number }
    | undefined;

  // Fallback/static position if neither is present:
  lon?: number; lat?: number; alt?: number;
};

export type BuildMotionOptions = {
  /** If true, we’ll query terrain heights for keyframes to keep the unit on ground. */
  clampKeyframesToTerrain?: boolean;
  /** Maximum spacing (seconds) when densifying sparse keyframes (0 = off). */
  maxKeyframeSpacingSec?: number;
  /** Interpolation: "linear" | "hermite" | "lagrange" (Cesium supports both Hermite/Lagrange). */
  interpolation?: "linear" | "hermite" | "lagrange";
};

/** Utility: deg → Cartesian3 at (lon, lat, height m). */
function cartesianFromDeg(lon: number, lat: number, height = 0): Cartesian3 {
  return Cartesian3.fromDegrees(lon, lat, height);
}

/** Build a Cesium PositionProperty for a unit. */
export async function buildPositionPropertyForUnit(
  unit: UnitLike,
  terrainProvider: TerrainProvider | undefined,
  opts: BuildMotionOptions = {}
) {
  const {
    clampKeyframesToTerrain = true,
    maxKeyframeSpacingSec = 0,
    interpolation = "hermite",
  } = opts;

  // CASE A: Keyframed motion → SampledPositionProperty
  if (unit.motionKeyframes && unit.motionKeyframes.length >= 1) {
    // Optionally densify long gaps so interpolation looks smooth.
    const frames = densifyKeyframes(unit.motionKeyframes, maxKeyframeSpacingSec);

    // Sample terrain heights if requested and possible.
    if (clampKeyframesToTerrain && terrainProvider) {
      await applyTerrainHeights(frames, terrainProvider);
    }

    const spp = new SampledPositionProperty();
    for (const kf of frames) {
      const jd = JulianDate.fromDate(new Date(kf.t));
      const pos = cartesianFromDeg(kf.lon, kf.lat, kf.alt ?? 0);
      spp.addSample(jd, pos);
    }

    if (interpolation !== "linear") {
      // Cesium defaults to linear; switch to a smooth polynomial if desired.
      spp.setInterpolationOptions({
        interpolationDegree: interpolation === "hermite" ? 2 : 5,
        interpolationAlgorithm:
          interpolation === "hermite"
            ? (Cesium as any).HermitePolynomialApproximation
            : (Cesium as any).LagrangePolynomialApproximation,
      });
    }

    return spp as Cesium.PositionProperty;
  }

  // CASE B: Procedural/continuous motion → CallbackProperty
  if (typeof unit.getPositionAtTime === "function") {
    const position = new CallbackProperty((_time: any, _result?: Cartesian3) => {
      // Cesium gives a JulianDate; derive UNIX ms.
      const unixMs = julianToUnixMs(_time as JulianDate);
      const p = unit.getPositionAtTime!(unixMs);
      if (!p) return undefined;
      // Treat alt as "above terrain" via heightReference on billboards/labels.
      return cartesianFromDeg(p.lon, p.lat, p.alt ?? 0);
    }, false /* not constant */);

    return position as Cesium.PositionProperty;
  }

  // CASE C: Static fallback
  if (typeof unit.lon === "number" && typeof unit.lat === "number") {
    const pos = cartesianFromDeg(unit.lon, unit.lat, unit.alt ?? 0);
    const spp = new SampledPositionProperty();
    spp.addSample(JulianDate.fromDate(new Date(0)), pos); // any anchor time
    return spp as Cesium.PositionProperty;
  }

  // No data → undefined; globe adapter can decide to skip rendering this unit.
  return undefined;
}

/** Densify frames so that adjacent samples are at most N seconds apart. */
function densifyKeyframes(
  frames: Array<{ t: number; lon: number; lat: number; alt?: number }>,
  maxSpacingSec: number
) {
  if (!maxSpacingSec || frames.length < 2) return frames.slice().sort((a,b)=>a.t-b.t);

  const out: typeof frames = [];
  const sorted = frames.slice().sort((a,b)=>a.t-b.t);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    out.push(a);

    const dt = (b.t - a.t) / 1000;
    const steps = Math.floor(dt / maxSpacingSec);
    for (let s = 1; s <= steps; s++) {
      const f = s * (maxSpacingSec / dt);
      out.push({
        t: a.t + s * maxSpacingSec * 1000,
        lon: CesiumMath.lerp(a.lon, b.lon, f),
        lat: CesiumMath.lerp(a.lat, b.lat, f),
        alt: a.alt != null && b.alt != null ? CesiumMath.lerp(a.alt, b.alt, f) : a.alt ?? b.alt,
      });
    }
  }
  out.push(sorted[sorted.length - 1]);
  return out;
}

/** Replace (or fill) altitudes using most-detailed terrain heights. */
async function applyTerrainHeights(
  frames: Array<{ t: number; lon: number; lat: number; alt?: number }>,
  terrainProvider: TerrainProvider
) {
  const cartos = frames.map(f => Cartographic.fromDegrees(f.lon, f.lat));
  const sampled = await sampleTerrainMostDetailed(terrainProvider, cartos);
  sampled.forEach((c, i) => { frames[i].alt = c.height || 0; });
}

/** Convert Cesium JulianDate → UNIX ms. */
function julianToUnixMs(jd: JulianDate): number {
  // Date.fromJulianDate isn’t exposed; do the subtract:
  const jsDate = JulianDate.toDate(jd);
  return jsDate.getTime();
}
