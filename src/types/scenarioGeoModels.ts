import type { Feature as GeoJsonFeature, Geometry } from "geojson";
import type { FillStyleSpec, SimpleStyleSpec, StrokeStyleSpec } from "@/geo/simplestyle";
import type { ScenarioTime } from "@/types/base";
import type {
    CurrentStateType,
    Media,
    ScenarioEventDescription,
} from "@/types/scenarioModels";

export interface VisibilityInfo {
    visibleFromT: ScenarioTime;
    visibleUntilT: ScenarioTime;
}

export type FeatureId = string | number;
export type LayerId = string | number;
export type Position2D = [number, number];
export type Position3D = [number, number, number];
export type Position = Position2D | Position3D;
export type ScenarioFeatureType =
    | "Point"
    | "LineString"
    | "Polygon"
    | "Circle"
    | "MultiPoint"
    | "MultiLineString"
    | "MultiPolygon"
    | "GeometryCollection";

export interface ScenarioFeatureProperties
    extends Partial<SimpleStyleSpec>,
    Partial<VisibilityInfo> {
    type: ScenarioFeatureType;
    name?: string;
    description?: string;

    [attribute: string]: any;
}

export interface ScenarioFeatureMeta extends Partial<VisibilityInfo> {
    type: ScenarioFeatureType;
    name?: string;
    description?: string;
    externalUrl?: string;
    radius?: number;
    locked?: boolean;
    // internal runtime only state
    _zIndex?: number;
}

export interface ScenarioFeatureState extends Partial<ScenarioEventDescription> {
    id: string;
    t: ScenarioTime;
    geometry?: Geometry;
    properties?: ScenarioFeatureProperties;
}

export interface CurrentScenarioFeatureState extends Omit<ScenarioFeatureState, "id"> {
    type?: CurrentStateType;
}

// A scenario feature is basically just a GeoJSON Feature with a required id field.
export interface ScenarioFeature extends GeoJsonFeature {
    id: FeatureId;
    meta: ScenarioFeatureMeta;
    style: Partial<SimpleStyleSpec>;
    state?: ScenarioFeatureState[];
    media?: Media[];
    // internal runtime only state
    _hidden?: boolean;
    _state?: CurrentScenarioFeatureState | null;
}

export interface ScenarioLayer extends Partial<VisibilityInfo> {
    id: FeatureId;
    name: string;
    description?: string;
    attributions?: string;
    externalUrl?: string;
    features: ScenarioFeature[];
    isHidden?: boolean;
    opacity?: number;
    locked?: boolean;
    _isNew?: boolean;
    _isOpen?: boolean;
    _hidden?: boolean;
}

interface ScenarioMapLayerBase extends Partial<VisibilityInfo> {
    id: FeatureId;
    name: string;
    description?: string;
    attributions?: string;
    externalUrl?: string;
    isHidden?: boolean;
    opacity?: number;
    extent?: number[];
    _isNew?: boolean;
    _status?: "uninitialized" | "loading" | "initialized" | "error";
    _isTemporary?: boolean;
}

export interface ScenarioImageLayer extends ScenarioMapLayerBase {
    type: "ImageLayer";
    url: string;
    imageCenter?: number[];
    imageScale?: number | number[];
    imageRotate?: number;
}

export interface ScenarioKMLLayer extends ScenarioMapLayerBase {
    type: "KMLLayer";
    url: string;
    extractStyles?: boolean;
}

export interface ScenarioXYZLayer extends ScenarioMapLayerBase {
    type: "XYZLayer";
    url: string;
}

export interface ScenarioTileJSONLayer extends ScenarioMapLayerBase {
    type: "TileJSONLayer";
    url: string;
}

/**
 * NASA FIRMS integration (Area API CSV)
 * `area` must be either "world" or "west,south,east,north".
 *
 * We optionally store `countryFiles` so the UI can compute a union bbox for FIRMS,
 * and optionally clip detections to borders client-side.
 */
export type FirmsTimeMode = "hour" | "day" | "window";
export type FirmsAreaMode = "world" | "bbox" | "countries";

export interface ScenarioFIRMSLayer extends ScenarioMapLayerBase {
    type: "FIRMSLayer";

    /** Base endpoint, e.g. https://firms.modaps.eosdis.nasa.gov/api/area/csv */
    url: string;

    /** FIRMS MAP_KEY */
    mapKey: string;

    /** e.g. VIIRS_SNPP_NRT, VIIRS_SNPP_SP, etc. */
    source: string;

    /**
     * FIRMS "area coordinates".
     * - "world", OR
     * - "west,south,east,north"
     */
    area: string;

    /** How time is interpreted */
    timeMode?: FirmsTimeMode;

    /** Only used if timeMode === "window" */
    windowBackHours?: number;
    windowForwardHours?: number;

    /** Rendering controls */
    maxDetections?: number;
    pointRadius?: number;

    /** UI/runtime helpers */
    areaMode?: FirmsAreaMode;

    /** When areaMode === "countries": filenames under /public/countrybordersjsons/ */
    countryFiles?: string[];

    /** If true and countryFiles provided: clip points to polygons client-side */
    clipToCountries?: boolean;
}

export type ScenarioMapLayer =
    | ScenarioImageLayer
    | ScenarioTileJSONLayer
    | ScenarioXYZLayer
    | ScenarioKMLLayer
    | ScenarioFIRMSLayer;

export type ScenarioMapLayerType = ScenarioMapLayer["type"];

export interface ScenarioLayerInstance extends ScenarioLayer {
    //isVisible?: boolean;
}

export interface LayerFeatureItem {
    id: FeatureId;
    type: "layer" | ScenarioFeatureType;
    name: string;
    description?: string;
    _pid?: FeatureId;
}

export type RangeRingShape = "circle" | "square" | "ellipse";

export interface RangeRing {
    name: string;
    range: number;          // existing: treat as maxRange
    uom: "m" | "km" | "mi" | "nmi";
    group?: string | null;

    // existing vertical extent (legacy)
    verticalMeters?: number;

    // existing shape fields
    shape?: "circle" | "square" | "ellipse" | "sphere" | "spheroid";
    secondaryRange?: number | null;

    // NEW: horizontal inner radius (same units as `range`)
    minRange?: number;             // default 0 -> no donut hole

    // NEW: vertical floor (AGL) & ceiling (AGL)
    minVerticalMeters?: number;    // default 0 -> starts at ground/adjusted terrain
    maxVerticalMeters?: number;    // default verticalMeters or baseAlt + verticalMeters
}

export interface RangeRingGroup {
    name: string;
    style?: Partial<RangeRingStyle>;
}

export interface RangeRingStyle extends StrokeStyleSpec, FillStyleSpec { }
