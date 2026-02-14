import type { ProductFootprint } from "./types";

export type TerrainHeightSamplerSync = (lonDeg: number, latDeg: number) => number;

export type GroundConformQuery = {
  lonDeg: number;
  latDeg: number;
  footprint?: ProductFootprint;
  headingRad?: number;
  clearanceMeters?: number;
  includeCenterSample?: boolean;
};

export type GroundConformPose = {
  anchorHeightMeters: number;
  headingRad: number;
  pitchRad: number;
  rollRad: number;
  upEast: number;
  upNorth: number;
  upUp: number;
};

const METERS_PER_DEGREE_LAT = 111_320;
const MIN_COS_LAT = 0.01;

function metersToDegreeOffsets(
  latDeg: number,
  eastMeters: number,
  northMeters: number,
): { dLon: number; dLat: number } {
  const latRad = (latDeg * Math.PI) / 180;
  const cosLat = Math.max(Math.abs(Math.cos(latRad)), MIN_COS_LAT);
  const dLat = northMeters / METERS_PER_DEGREE_LAT;
  const dLon = eastMeters / (METERS_PER_DEGREE_LAT * cosLat);
  return { dLon, dLat };
}

function rotateEnu(east: number, north: number, headingRad = 0): { east: number; north: number } {
  if (!headingRad) return { east, north };
  const c = Math.cos(headingRad);
  const s = Math.sin(headingRad);
  return {
    east: east * c - north * s,
    north: east * s + north * c,
  };
}

function cornerOffsets(footprint: ProductFootprint): Array<{ east: number; north: number }> {
  const hw = Math.max(0, footprint.halfWidthMeters);
  const hl = Math.max(0, footprint.halfLengthMeters);
  const heading = footprint.headingRad ?? 0;
  return [
    rotateEnu(hw, hl, heading),
    rotateEnu(hw, -hl, heading),
    rotateEnu(-hw, hl, heading),
    rotateEnu(-hw, -hl, heading),
  ];
}

export function computeGroundAnchorHeightMeters(
  sampler: TerrainHeightSamplerSync,
  query: GroundConformQuery,
): number {
  const clearanceMeters = Math.max(0, query.clearanceMeters ?? 0);
  const includeCenterSample = query.includeCenterSample !== false;

  let maxHeight = includeCenterSample ? sampler(query.lonDeg, query.latDeg) : Number.NEGATIVE_INFINITY;

  if (query.footprint) {
    for (const c of cornerOffsets(query.footprint)) {
      const d = metersToDegreeOffsets(query.latDeg, c.east, c.north);
      const h = sampler(query.lonDeg + d.dLon, query.latDeg + d.dLat);
      if (h > maxHeight) maxHeight = h;
    }
  }

  if (!Number.isFinite(maxHeight)) maxHeight = sampler(query.lonDeg, query.latDeg);
  return maxHeight + clearanceMeters;
}

function fitPlaneLeastSquares(points: Array<{ east: number; north: number; h: number }>): { a: number; b: number; c: number } {
  let see = 0;
  let snn = 0;
  let sen = 0;
  let se = 0;
  let sn = 0;
  let seh = 0;
  let snh = 0;
  let sh = 0;
  let n = 0;
  for (const p of points) {
    see += p.east * p.east;
    snn += p.north * p.north;
    sen += p.east * p.north;
    se += p.east;
    sn += p.north;
    seh += p.east * p.h;
    snh += p.north * p.h;
    sh += p.h;
    n += 1;
  }

  // Solve normal equations for h = a*east + b*north + c.
  const m00 = see; const m01 = sen; const m02 = se;
  const m10 = sen; const m11 = snn; const m12 = sn;
  const m20 = se; const m21 = sn; const m22 = n;
  const det =
    m00 * (m11 * m22 - m12 * m21)
    - m01 * (m10 * m22 - m12 * m20)
    + m02 * (m10 * m21 - m11 * m20);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) {
    const c = n > 0 ? sh / n : 0;
    return { a: 0, b: 0, c };
  }

  const inv00 = (m11 * m22 - m12 * m21) / det;
  const inv01 = (m02 * m21 - m01 * m22) / det;
  const inv02 = (m01 * m12 - m02 * m11) / det;
  const inv10 = (m12 * m20 - m10 * m22) / det;
  const inv11 = (m00 * m22 - m02 * m20) / det;
  const inv12 = (m02 * m10 - m00 * m12) / det;
  const inv20 = (m10 * m21 - m11 * m20) / det;
  const inv21 = (m01 * m20 - m00 * m21) / det;
  const inv22 = (m00 * m11 - m01 * m10) / det;

  const a = inv00 * seh + inv01 * snh + inv02 * sh;
  const b = inv10 * seh + inv11 * snh + inv12 * sh;
  const c = inv20 * seh + inv21 * snh + inv22 * sh;
  return { a, b, c };
}

export function computeGroundConformPose(
  sampler: TerrainHeightSamplerSync,
  query: GroundConformQuery,
): GroundConformPose {
  const clearanceMeters = Math.max(0, query.clearanceMeters ?? 0);
  const headingRad = query.headingRad ?? query.footprint?.headingRad ?? 0;
  const includeCenterSample = query.includeCenterSample !== false;

  const points: Array<{ east: number; north: number; h: number }> = [];
  if (includeCenterSample) {
    points.push({
      east: 0,
      north: 0,
      h: sampler(query.lonDeg, query.latDeg),
    });
  }

  if (query.footprint) {
    for (const c of cornerOffsets({ ...query.footprint, headingRad })) {
      const d = metersToDegreeOffsets(query.latDeg, c.east, c.north);
      points.push({
        east: c.east,
        north: c.north,
        h: sampler(query.lonDeg + d.dLon, query.latDeg + d.dLat),
      });
    }
  }

  if (points.length === 0) {
    points.push({ east: 0, north: 0, h: sampler(query.lonDeg, query.latDeg) });
  }

  const { a, b, c } = fitPlaneLeastSquares(points);
  const upLen = Math.hypot(a, b, 1) || 1;
  const upEast = -a / upLen;
  const upNorth = -b / upLen;
  const upUp = 1 / upLen;

  // Raise center so no sampled corner sits above the model bottom plane.
  let requiredCenterTerrain = c;
  for (const p of points) {
    const predicted = a * p.east + b * p.north + c;
    const delta = p.h - predicted;
    if (delta > 0) requiredCenterTerrain += delta;
  }

  return {
    anchorHeightMeters: requiredCenterTerrain + clearanceMeters,
    headingRad,
    // retained for compatibility, but orientation should prefer up-vector basis.
    pitchRad: Math.atan2(-a, 1),
    rollRad: Math.atan2(b, 1),
    upEast,
    upNorth,
    upUp,
  };
}
