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
      rangeRings.features.filter((r) => !r.properties.isGroup),
    );
    const grouped = featureCollection(
      rangeRings.features.filter((r) => r.properties.isGroup),
    );

    clusterEach(grouped, "id", (cluster) => {
      const merged =
        cluster.features.length > 1
          ? union(cluster, {
              properties: { id: cluster.features[0].properties.id, isGroup: true },
            })
          : cluster.features[0];
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

  const primaryM = convertToMetric(r.range, r.uom || "km");
  const secondaryM =
    r.secondaryRange != null
      ? convertToMetric(r.secondaryRange, r.uom || "km")
      : primaryM;

  const props = {
    id: r.group ? r.group : `${unit.id}-${i}`,
    isGroup: !!r.group,
  };

  // Circle: keep existing Turf circle behavior
  if (shape === "circle") {
    return circle(center, primaryM / 1000, { properties: props });
  }

  // Common helpers for square/ellipse
  const R = 6378137; // WGS-84 Earth radius (m)
  const latRad = (lat * Math.PI) / 180;

  const metersToLatDeg = (m: number) => (m / R) * (180 / Math.PI);
  const metersToLonDeg = (m: number) =>
    (m / (R * Math.cos(latRad))) * (180 / Math.PI);

  // ── Case 2: Square (axis-aligned) ──
  if (shape === "square") {
    // Treat primary/secondary as half-side lengths in meters
    const halfX = primaryM;
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

  // ── Case 3: Ellipse (axis-aligned) ──
  // Used for both "ellipse" and "spheroid"
  const steps = 64;
  const coords: [number, number][] = [];

  for (let j = 0; j <= steps; j++) {
    const theta = (2 * Math.PI * j) / steps;

    // primaryM = semi-major (E/W), secondaryM = semi-minor (N/S)
    const dx = primaryM * Math.cos(theta); // meters east
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
