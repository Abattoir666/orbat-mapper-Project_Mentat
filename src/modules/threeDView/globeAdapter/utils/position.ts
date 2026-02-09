import * as Cesium from "cesium";

const posEquals = (a?: Cesium.Cartesian3, b?: Cesium.Cartesian3) =>
    !!a && !!b && Cesium.Cartesian3.equalsEpsilon(a, b, Cesium.Math.EPSILON7);

export function setEntityPosition(ent: Cesium.Entity, lon: number, lat: number, alt = 0) {
    const next = Cesium.Cartesian3.fromDegrees(lon, lat, alt);
    const now = ent.position?.getValue?.(new Cesium.JulianDate());
    if (!posEquals(now, next)) ent.position = next;
}
