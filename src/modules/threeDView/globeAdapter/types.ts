import type { Viewer } from "cesium";
import type { GibsCloudOptions } from "@/modules/threeDView/weatherSkyController";

export type TrackPoint = { t: number; lon: number; lat: number; alt?: number };

export type UnitRenderable = {
    id: string;
    name?: string;
    lat: number;
    lon: number;

    alt?: number;
    altIsAgl?: boolean;
    track?: TrackPoint[];

    iconUrl?: string;
    clampToGround?: boolean;
    interpolation?: "linear" | "hermite" | "lagrange";

    render?: "billboard" | "block";
    hoverMeters?: number;
    blockSize?: { x: number; y: number; z: number };

    symbolOptions?: {
        fillColor?: string;
        iconFillColor?: string;
        [k: string]: any;
    };

    blockColorCss?: string;

    labelOffsetPxY?: number;

    validFromMs?: number;
    validToMs?: number;

    motionKeyframes?: Array<{ t: number; lon: number; lat: number; alt?: number }>;

    __sourceUnit?: any;

    getPositionAtTime?: (tUnixMs: number) => { lon: number; lat: number; alt?: number } | undefined;

    pathStyle?: { show?: boolean; leadTime?: number; trailTime?: number; width?: number; colorCss?: string };
};

export interface GlobePort {
    mount: (el: HTMLDivElement) => Promise<void>;
    unmount: () => void;
    getViewer?: () => Viewer | undefined;
    setUnits: (units: UnitRenderable[]) => void;
    upsertUnit: (u: UnitRenderable) => void;
    removeUnit: (id: string) => void;

    setTime?: (epochMs: number) => void;
    setTimeBounds?: (startMs: number, stopMs: number) => void;

    enableDayNight?: (enabled: boolean) => void;
    enableSkybox?: (enabled: boolean) => void;
    enableCloudOverlay?: (enabled: boolean, options?: GibsCloudOptions) => void;

    flyToLatLon: (lon: number, lat: number, height?: number) => void;

    setExaggeration: (factor: number) => Promise<void>;

    setRangeRingsVisible?: (visible: boolean) => void;

    setBaseLayer: (key: string) => void;
    setBaseLayerTemplate: (
        url: string,
        opts?: {
            minLevel?: number;
            maxLevel?: number;
            attribution?: string;
            geographic?: boolean;
            subdomains?: string[] | string;
        }
    ) => void;
    setTerrainKey: (key: "world" | "flat" | "bathymetry" | "bathy") => Promise<void>;
    setWaterEffectEnabled: (enabled: boolean) => void;

    updateUnitPosition?: (id: string, lon: number, lat: number, alt?: number) => void;

    addOverlayTemplate: (
        id: string,
        url: string,
        opts?: {
            minLevel?: number;
            maxLevel?: number;
            attribution?: string;
            geographic?: boolean;
            subdomains?: string[] | string;
            alpha?: number;
        }
    ) => void;
    removeOverlay: (id: string) => void;
    setOverlayVisibility: (id: string, show: boolean) => void;
    setOverlayAlpha: (id: string, alpha: number) => void;
    listOverlays: () => { id: string; show: boolean; alpha: number }[];

    setUnitFilter?: (fn?: (u: any) => boolean) => void;
    refreshVisibility?: () => void;
}
