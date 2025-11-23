// src/modules/threeDView/geo/sphericalShell.ts
import { Cartesian3, PrimitiveType } from "cesium";

export type SphericalShellOptions = {
  outerRadius: number;    // meters
  innerRadius: number;    // meters (>= 0, < outer)
  verticalRadius?: number; // z-radius, defaults to outerRadius
  phiSegments?: number;   // vertical slices
  thetaSegments?: number; // horizontal slices
};

/**
 * Procedurally constructs a hollow spherical shell mesh.
 * Returns raw Cesium-ready buffers.
 */
export function buildSphericalShellMesh(opts: SphericalShellOptions) {
  const {
    outerRadius,
    innerRadius,
    verticalRadius = outerRadius,
    phiSegments = 32,
    thetaSegments = 64,
  } = opts;

  const positions: number[] = [];
  const indices: number[] = [];

  function pushVertex(r: number, vr: number, phi: number, theta: number) {
    const sinPhi = Math.sin(phi);
    const x = r * sinPhi * Math.cos(theta);
    const y = r * sinPhi * Math.sin(theta);
    const z = vr * Math.cos(phi);
    positions.push(x, y, z);
  }

  const rowVerts = thetaSegments + 1;

  // Outer surface
  for (let i = 0; i <= phiSegments; i++) {
    const phi = (i / phiSegments) * Math.PI;
    for (let j = 0; j <= thetaSegments; j++) {
      const theta = (j / thetaSegments) * 2 * Math.PI;
      pushVertex(outerRadius, verticalRadius, phi, theta);
    }
  }

  // Outer indices
  for (let i = 0; i < phiSegments; i++) {
    for (let j = 0; j < thetaSegments; j++) {
      const a = i * rowVerts + j;
      const b = a + rowVerts;
      const c = b + 1;
      const d = a + 1;

      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  const innerOffset = positions.length / 3;

  // Inner surface (reverse winding)
  for (let i = 0; i <= phiSegments; i++) {
    const phi = (i / phiSegments) * Math.PI;
    for (let j = 0; j <= thetaSegments; j++) {
      const theta = (j / thetaSegments) * 2 * Math.PI;
      pushVertex(innerRadius, verticalRadius * (innerRadius / outerRadius), phi, theta);
    }
  }

  // Inner indices (reversed)
  for (let i = 0; i < phiSegments; i++) {
    for (let j = 0; j < thetaSegments; j++) {
      const a = innerOffset + i * rowVerts + j;
      const b = a + rowVerts;
      const c = b + 1;
      const d = a + 1;

      indices.push(a, d, b);
      indices.push(b, d, c);
    }
  }

  return {
    positions: new Float64Array(positions),
    indices: new Uint32Array(indices),
    primitiveType: PrimitiveType.TRIANGLES,
  };
}
