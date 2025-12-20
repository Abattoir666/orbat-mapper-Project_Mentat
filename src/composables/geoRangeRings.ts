import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { injectStrict } from "@/utils";
import { activeScenarioKey } from "@/components/injects";
import { clusterEach } from "@turf/clusters";
import circle from "@turf/circle";
import union from "@turf/union";
import { featureCollection } from "@turf/helpers";
import { GeoJSON } from "ol/format";
import type { NUnit } from "@/types/internalModels";
import { convertToMetric } from "@/utils/convert";
import { Stroke, Style } from "ol/style";
import Feature, { type FeatureLike } from "ol/Feature";
import { type FeatureId } from "@/types/scenarioGeoModels";
import { createSimpleStyle } from "@/geo/simplestyle";
import { type TScenario } from "@/scenariostore";

export function useRangeRingsLayer() {
  const scn = injectStrict(activeScenarioKey);
  const { rangeRingStyle, clearCache } = useRangeRingStyles(scn);
  const layer = createLayer();
  layer.setStyle(rangeRingStyle);

  const gjf = new GeoJSON({
    featureProjection: "EPSG:3857",
    dataProjection: "EPSG:4326",
  });

  function drawRangeRings() {
    layer.getSource()?.clear();
    clearCache();

    const rangeRings = featureCollection(
      scn.geo.everyVisibleUnit.value
        .filter((u) => u.rangeRings?.length)
        .map(createRangeRings)
        .flat(),
    );

    const unGrouped = featureCollection(
        rangeRings.features.filter((r) => r.properties && !r.properties.isGroup),
    );
    const grouped = featureCollection(
      rangeRings.features.filter((r) => r.properties.isGroup),
    );

      clusterEach(grouped, "id", (cluster: any) => {
          if (!cluster.features || cluster.features.length === 0) return;

          // Start from the first feature in the cluster
          let merged: any = cluster.features[0];

          // Union all remaining features into one polygon/multipolygon.
          for (let i = 1; i < cluster.features.length; i++) {
              merged = union(merged as any, cluster.features[i] as any) as any;
          }

          const baseProps = merged.properties || cluster.features[0].properties || {};
          merged.properties = {
              ...baseProps,
              id: baseProps.id,
              isGroup: true,
          };

          layer.getSource()?.addFeature(gjf.readFeature(merged) as Feature);
      });

    layer.getSource()?.addFeatures(gjf.readFeatures(unGrouped) as Feature[]);
  }

  return { rangeLayer: layer, drawRangeRings };
}

function buildRangeRingFeature(unit: NUnit, r: any, i: number) {
  // Default shape
  const rawShape = r.shape ?? "circle";

  // 2D/top-down interpretation:
  //  - sphere → circle
  //  - spheroid → ellipse
  const shape =
    rawShape === "sphere"
      ? "circle"
      : rawShape === "spheroid"
      ? "ellipse"
      : rawShape;

  const center = unit._state!.location!;
  const [lon, lat] = center as [number, number];

  // ── New: outer & inner radii in meters ──
  const outerM = convertToMetric(r.range, r.uom || "km");
  const minRaw =
    r.minRange != null
      ? convertToMetric(r.minRange, r.uom || "km")
      : 0;

  // clamp so 0 ≤ inner ≤ outer
  const innerM = Math.max(0, Math.min(minRaw, outerM));

  // secondary range follows old semantics: "other axis" for square/ellipse
  const secondaryM =
    r.secondaryRange != null
      ? convertToMetric(r.secondaryRange, r.uom || "km")
      : outerM;

  const props = {
    id: r.group ? r.group : `${unit.id}-${i}`,
    isGroup: !!r.group,
  };

  // ──────────────────────────────
  // Case 1: Circle (possibly donut)
  //   - We avoid Turf.difference because it is fragile.
  //   - Instead we build a polygon with a hole:
  //       coordinates: [outerRing, innerRingReversed]
  // ──────────────────────────────
  if (shape === "circle") {
    const outer = circle(center, outerM / 1000, { properties: props });

    // Safety: if no inner radius or inner >= outer, just draw a solid disk.
    const EPS = 1e-3;
    if (innerM <= 0 || innerM >= outerM - EPS) {
      return outer;
    }

    const inner = circle(center, innerM / 1000, { properties: props });

    const outerCoords: any =
      (outer as any).geometry?.coordinates?.[0] ?? (outer as any).geometry?.coordinates;
    const innerCoords: any =
      (inner as any).geometry?.coordinates?.[0] ?? (inner as any).geometry?.coordinates;

    // If we can't get usable coordinates, fall back to solid disk.
    if (
      !outerCoords ||
      !innerCoords ||
      !Array.isArray(outerCoords) ||
      !Array.isArray(innerCoords)
    ) {
      return outer;
    }

    // Build a polygon with a hole: [outerRing, innerRingReversed]
    const donut: any = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          outerCoords,                // outer boundary
          [...innerCoords].reverse(), // inner hole, reversed for proper winding
        ],
      },
      properties: props,
    };

    return donut;
  }


  // Common helpers for square/ellipse
  const R = 6378137; // WGS-84 Earth radius (m)
  const latRad = (lat * Math.PI) / 180;

  const metersToLatDeg = (m: number) => (m / R) * (180 / Math.PI);
  const metersToLonDeg = (m: number) =>
    (m / (R * Math.cos(latRad))) * (180 / Math.PI);

  // ──────────────────────────────
  // Case 2: Square (axis-aligned)
  // ──────────────────────────────
  if (shape === "square") {
    // Treat outerM / secondaryM as half-side lengths in meters
    const halfX = outerM;
    const halfY = secondaryM;

    const dLatN = metersToLatDeg(+halfY);
    const dLatS = -dLatN;
    const dLonE = metersToLonDeg(+halfX);
    const dLonW = -dLonE;

    const coords: [number, number][] = [
      [lon + dLonW, lat + dLatS], // SW
      [lon + dLonE, lat + dLatS], // SE
      [lon + dLonE, lat + dLatN], // NE
      [lon + dLonW, lat + dLatN], // NW
      [lon + dLonW, lat + dLatS], // close ring
    ];

    return {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [coords],
      },
      properties: props,
    } as any;
  }

  // ──────────────────────────────
  // Case 3: Ellipse (axis-aligned)
  // Used for both "ellipse" and "spheroid" in top-down 2D
  // ──────────────────────────────
  const steps = 64;
  const coords: [number, number][] = [];

  for (let j = 0; j <= steps; j++) {
    const theta = (2 * Math.PI * j) / steps;

    // outerM = semi-major (E/W), secondaryM = semi-minor (N/S)
    const dx = outerM * Math.cos(theta); // meters east
    const dy = secondaryM * Math.sin(theta); // meters north

    const dLat = metersToLatDeg(dy);
    const dLon = metersToLonDeg(dx);

    coords.push([lon + dLon, lat + dLat]);
  }

  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [coords],
    },
    properties: props,
  } as any;
}



function createRangeRings(unit: NUnit) {
  return (
    unit.rangeRings
      ?.map((r, i) => (!r.hidden ? buildRangeRingFeature(unit, r, i) : null))
      .filter((e) => e !== null) || []
  );
}

const defaultStyle = new Style({
  stroke: new Stroke({ width: 2, color: "red" }),
});

function createLayer() {
  const layer = new VectorLayer({
    source: new VectorSource(),
    style: defaultStyle,
  });
  layer.set("title", "Range rings");
  return layer;
}

function useRangeRingStyles(scn: TScenario) {
  const styleCache = new Map<any, Style>();

  function clearCache() {
    styleCache.clear();
  }

  function rangeRingStyle(feature: FeatureLike, resolution: number) {
    const id = feature.get("id");
    let style = styleCache.get(id);
    if (!style) {
      const isGroup = feature.get("isGroup");
      if (isGroup) {
        const groupStyle = scn.store.state.rangeRingGroupMap[id]?.style;
        style = groupStyle
          ? createSimpleStyle({ fill: null, stroke: "red", ...groupStyle })
          : defaultStyle;
      } else {
        const parts = id.split("-");
        const index = parts.pop();
        const unitId = parts.join("-");
        const unit = scn.helpers.getUnitById(unitId);
        const ring = unit.rangeRings?.[index];
        style = ring?.style
          ? createSimpleStyle({ fill: null, stroke: "red", ...ring.style })
          : defaultStyle;
      }
      styleCache.set(id, style);
    }
    return style;
  }

  function invalidateStyle(featureId: FeatureId) {
    styleCache.delete(featureId);
  }

  return {
    clearCache,
    rangeRingStyle,
    invalidateStyle,
  };
}
