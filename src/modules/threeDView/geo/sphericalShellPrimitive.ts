// src/modules/threeDView/geo/sphericalShellPrimitive.ts
import * as Cesium from "cesium";
import {
    Cartesian3,
    Color,
    EllipsoidGeometry,
    GeometryInstance,
    Material,
    MaterialAppearance,
    Primitive,
    Transforms,
} from "cesium";

export interface SphericalShellPrimitiveOptions {
    /** Outer horizontal radius, in meters (maxRange in metric). */
    outerRadius: number;
    /** Inner horizontal radius, in meters (minRange in metric). */
    innerRadius: number;
    /**
     * Vertical "radius" in meters. For a symmetric shell this is half of the
     * total vertical span you want (we just treat it like an ellipsoid Z radius).
     */
    verticalRadius: number;
    /** Optional angular tesselation parameters. */
    phiSegments?: number;   // stacks
    thetaSegments?: number; // slices
    /** Center of the shell in world (ECEF) coordinates. */
    center: Cartesian3;
    /** Shell color (including alpha). */
    color: Color;
}

/**
 * Build a *hollow* ellipsoidal shell primitive:
 *   - Uses Cesium.EllipsoidGeometry with innerRadii to cut out the core.
 *   - No direct access to .material.uniforms (avoids the 'uniforms' crash).
 */
export function buildSphericalShellPrimitive(
    opts: SphericalShellPrimitiveOptions,
): Primitive {
    const {
        outerRadius,
        innerRadius,
        verticalRadius,
        phiSegments = 32,
        thetaSegments = 64,
        center,
        color,
    } = opts;

    // Guard: if innerRadius is not positive, fall back to a solid ellipsoid
    const useInner = innerRadius > 0 && innerRadius < outerRadius;

    // Horizontal radii
    const outerRadii = new Cartesian3(
        Math.max(outerRadius, 1),
        Math.max(outerRadius, 1),
        Math.max(verticalRadius, 1),
    );

    // For the inner radii, keep the same vertical scaling ratio so the shell
    // thickness is roughly consistent in 3D.
    const innerScale = useInner ? innerRadius / outerRadius : 0;
    const innerRadii = useInner
        ? new Cartesian3(
              Math.max(innerRadius, 0.1),
              Math.max(innerRadius, 0.1),
              Math.max(verticalRadius * innerScale, 0.1),
          )
        : undefined;

    const geom = new EllipsoidGeometry({
        radii: outerRadii,
        innerRadii,
        stackPartitions: phiSegments,
        slicePartitions: thetaSegments,
    });

    const instance = new GeometryInstance({
        geometry: geom,
        // Place the shell at the requested center using an ENU frame
        modelMatrix: Transforms.eastNorthUpToFixedFrame(center),
    });

    // Simple color material; we don't touch .uniforms manually.
    const material = Material.fromType("Color", {
        color,
    });

    const appearance = new MaterialAppearance({
        material,
        translucent: color.alpha < 1.0,
        closed: false,
        faceForward: true,
    });

    const primitive = new Primitive({
        geometryInstances: instance,
        appearance,
        asynchronous: true,
    });

    return primitive;
}
