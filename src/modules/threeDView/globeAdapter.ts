// src/modules/threeDView/globeAdapter.ts
import proj4 from "proj4";
import {
    Cartesian3,
    Cartesian2,
    Cartographic,
    Color,
    HeightReference,
    VerticalOrigin,
    HorizontalOrigin,
    sampleTerrainMostDetailed,
    UrlTemplateImageryProvider,
    JulianDate,
    TimeInterval,
    TimeIntervalCollection,
    ClockRange,
    type Viewer,
    SunLight,
    SkyAtmosphere,
    SkyBox,
    Moon,
    Sun,
    CallbackProperty,
    SampledPositionProperty,
    VelocityOrientationProperty,
} from "cesium";

import * as Cesium from "cesium";
import { useGlobe, type GlobeApi } from "./useGlobe";
import { makeImageryProviders } from "./makeImageryProviders";
import { ICON_PX, TOE_UNDERBAR_SUFFIX, PEDESTAL_SUFFIX, PEDESTAL_LINES_SUFFIX } from "./globeAdapter/constants";
import type { GlobePort, UnitRenderable } from "./globeAdapter/types";
import { extractGroupFill, normalizeHex, safeCssColor, withSymbolColor } from "./globeAdapter/utils/color";
import { setEntityPosition } from "./globeAdapter/utils/position";
import { currentViewerMs, evtTime } from "./globeAdapter/utils/time";
import { getUnitPositionAtTime } from "@/scenariostore/time";
import { getSidcIconSync } from "@/symbology/iconCache";
import { WeatherSkyController } from "./weatherSkyController";
import type { GibsCloudOptions } from "./weatherSkyController";
import {
    applyInstallationGraphics,
} from "@/modules/threeDView/graphics/installations";
import {
    isLandEquipmentSidc,
    resolveLandEquipmentCategoryFromSidc,
    resolveLandEquipmentSubcategoryFromSidc,
    resolveSidcShapeOverride,
    resolveSymbol3DRenderMode,
} from "@/modules/threeDView/symbols";
import {
    buildIndexFromScenarioStore,
    applyGroupFillColors,
    applyGroupFillColorToUnit,
} from "@/modules/threeDView/graphics/unitparser";
import {
    compileRecipeToInstances,
    findBestOverrideRow,
    type CompiledInstance,
} from "@/modules/threeDView/symbols/landEquipment/landEquipmentRecipeEngine";
import {
    LAND_EQUIP_SHAPE_OVERRIDES,
    SHAPE_GRAMMAR_TOKENS,
    findLandEquipShapeOverrideForSidc,
    hasLandEquipRecipeOverrideForSidc,
} from "@/modules/threeDView/symbols/landEquipment/shapeOverrideMapping";
import {
    expectedVehicleMobilityPartCount,
    resolveLandEquipmentMobilityProfileFromSidc,
} from "@/modules/threeDView/symbols/landEquipment/mobilityModifiers";
import {
    buildVehicleHullAddonSpecs,
    parseSidcCoreParts,
    resolveVehicleBaseBodyHeightForSidc,
    resolveVehicleHullSizeForSidc,
    type VehicleHullSize,
} from "@/modules/threeDView/symbols/landEquipment/vehicleSizingController";
import {
    computeGroundConformPose,
    createProductAggregator,
    type ProductDescriptor,
    type ProductFootprint,
} from "@/modules/threeDView/symbols/Products";
import { convertToMetric } from "@/utils/convert";
import { buildSphericalShellPrimitive } from "./geo/sphericalShellPrimitive";
import { setSurfaceHeightSampler } from "@/geo/surfaceHeightRegistry";
import { toeMapUnderbarEnabled } from "@/symbology/underbars/toeMapUnderbarToggle";
import { usePersonnelEditStore } from "@/stores/toeStore";
import {
    computeToePctForUnit,
    makeToeUnderbarSvgDataUrl,
} from "@/symbology/underbars/toeUnderbarBillboard";
import { effectiveToeUnderbarEnabled } from "@/symbology/underbars/underbarSettings";


/** True if the unit should be hidden in 3D based ONLY on side/group visibility.
 *  We deliberately do NOT filter on "has current location" here, because
 *  time-based on/off-map is handled by updateAllUnitsAtTime(…) via computeSnapshot.
 */
function isHidden2D(u: any): boolean {
    try {
        const sc = (window as any).__scenario;
        const store = sc?.store ?? sc;
        if (!store || !u) return false;

        const base = (u as any).__sourceUnit ?? u;
        const id = base?.id ?? u?.id;
        if (!id) return false;

        // Use the same state maps 2D uses for side/group visibility
        const state = (store as any).state ?? store;
        const sideGroupMap = state?.sideGroupMap;
        const sideMap = state?.sideMap;
        const unitMap = state?.unitMap;

        if (!sideGroupMap || !sideMap || !unitMap) {
            // If we can't see the same structures 2D uses, don't hide anything.
            return false;
        }

        const unit = unitMap[id] ?? base;

        // Rebuild the "hiddenGroups" logic from geo.ts:
        //   hiddenGroups = groups where group.isHidden || side[group._pid].isHidden
        const gid =
            unit._gid ??
            unit.groupId ??
            unit.group?.id ??
            (base as any)._gid ??
            (base as any).groupId ??
            (base as any).group?.id;

        // If the unit has no group, don't treat it as hidden here;
        // its on/off-map is controlled purely by event/location logic.
        if (!gid) {
            return false;
        }

        const group = sideGroupMap[gid];
        if (!group) {
            return false;
        }

        const parentSide = sideMap[group._pid];
        const groupHidden = !!group.isHidden;
        const sideHidden = !!parentSide?.isHidden;

        // 3D-hidden ? side/group is hidden. Location is dealt with per-time-tick.
        return groupHidden || sideHidden;
    } catch {
        return false;
    }
}

const pedestalTipCache = new Map<string, Cesium.Cartesian3>();

// Keep the debug export lines as they are:
try { (window as any).isHidden2D = isHidden2D; } catch {}

try {
    (window as any).lastSidcAtOrBefore = lastSidcAtOrBefore;
    (window as any).lastLocEventAtOrBefore = lastLocEventAtOrBefore;
    (window as any).computeSnapshot3D = computeSnapshot;
} catch { }

function applyIconLift(ent: Cesium.Entity, u: UnitRenderable) {
    const liftPx = Number((u as any).__iconLiftPx ?? 0) || 0;
    setUnitIconLiftPx(ent, u, liftPx);

    try { if (ent.billboard) (ent.billboard as any).disableDepthTestDistance = 0; } catch { }
    try { if (ent.label) (ent.label as any).disableDepthTestDistance = 0; } catch { }
}

/** Extract the SIDC currently encoded in an entity's billboard image URL. */
function sidcFromBillboard(ent?: Cesium.Entity, now?: Cesium.JulianDate): string | undefined {
    try {
        const bb: any = ent?.billboard;
        if (!bb) return;

        // Resolve the image value at 'now' if provided, else at "current" time.
        const val = (bb.image && typeof bb.image.getValue === "function")
            ? bb.image.getValue(now ?? new Cesium.JulianDate())
            : bb.image;

        if (typeof val !== "string") return;

        // Works for both http(s) and data: URLs if you append ?sidc=... to data URLs.
        const m = /(?:[?&])sidc=([^&]+)/i.exec(val);
        return m ? decodeURIComponent(m[1]) : undefined;
    } catch {
        return undefined;
    }
}

/** Try to get a synchronous 2D snapshot of a SIDC icon from app globals. */
function tryGet2DIconSnapshotSync(sidc: string, size = 48, hex?: string): string | undefined {
    try {
        const w: any = window;

        // Preferred sync hook if your 2D cache exposes one
        if (typeof w.__get2DIconForSidcSync === "function") {
            const out = w.__get2DIconForSidcSync(sidc, { size, fill: hex, fc: hex });
            if (typeof out === "string" && out.startsWith("data:image/")) return out;
            if (typeof out === "string" && /^https?:\/\//i.test(out)) return out;
        }

        // Alternate name often used
        if (typeof w.__get2DIconDataUrl === "function") {
            const out = w.__get2DIconDataUrl(sidc, size, hex);
            if (typeof out === "string" && out.startsWith("data:image/")) return out;
        }

        // Example: a Map cache you might have on window
        if (w.__symbolCache && typeof w.__symbolCache.get === "function") {
            const out = w.__symbolCache.get({ sidc, size, fill: hex, fc: hex });
            if (typeof out === "string" && out.startsWith("data:image/")) return out;
        }
    } catch { /* ignore */ }
    return undefined;
}

/** Prefer app/global base endpoint if provided; else undefined. */
function getGlobalSymbolBase(): string | undefined {
    const w = window as any;
    const base = w?.__symbolBase ?? w?.__symbolEndpoint;
    return (typeof base === "string" && base.trim()) ? base : undefined;
}

/** Build a URL like `${base}?sidc=...&size=...` (does not append if already there). */
function urlFromBaseAndSidc(base: string, sidc: string, size = 48): string {
    const hasQ = base.includes("?");
    const sep = hasQ ? "&" : "?";
    let url = `${base}${sep}sidc=${encodeURIComponent(sidc)}`;
    // add size if caller expects it (harmless if server ignores it)
    url += `&size=${size}`;
    return url;
}

/** Optional, synchronous milsymbol fallback ? dataURL. */
function tryMilsymbolDataUrlSync(sidc: string, size = 48, fillHex?: string): string | undefined {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const MS = (window as any).milsymbol ?? require("milsymbol");
        if (!MS) return undefined;
        const opts: any = { size };
        if (fillHex) opts.fillColor = fillHex;
        const sym = new MS.Symbol(sidc, opts);
        const canvas = sym.asCanvas?.();
        const durl = canvas?.toDataURL?.("image/png");
        return (typeof durl === "string" && durl.startsWith("data:image/")) ? durl : undefined;
    } catch { return undefined; }
}

const lastToeUnderbarSig = new Map<string, string>();
// Cesium box axes are ENU-aligned by default:
// x=east/west (width), y=north/south (length), z=up (height).
const VEHICLE_BLOCK_SIZE_METERS = { x: 3.5, y: 6.5, z: 3.0 } as const;
const TANK_TURRET_SIZE_METERS = { x: 2.2, y: 2.4, z: 1.0 } as const;
const TANK_BARREL_LENGTH_M = 3.6;
const TANK_BARREL_RADIUS_M = 0.2;
const TANK_BARREL_UP_FROM_TURRET_M = 0.05;
const ARMORED_TURRET_SIZE_METERS = { x: 1.8, y: 2.0, z: 0.8 } as const;
const ARMORED_BARREL_LENGTH_M = 2.2;
const ARMORED_BARREL_RADIUS_M = 0.16;
const ARMORED_BARREL_UP_FROM_TURRET_M = 0.05;
const ARMORED_BARREL_FORWARD_FROM_TURRET_M =
    (ARMORED_TURRET_SIZE_METERS.y / 2) + (ARMORED_BARREL_LENGTH_M / 2) - 0.08;
const IFV_TURRET_SIZE_METERS = { x: 1.45, y: 1.55, z: 0.62 } as const;
const IFV_BARREL_LENGTH_M = 1.65;
const IFV_BARREL_RADIUS_M = 0.12;
const IFV_BARREL_UP_FROM_TURRET_M = 0.04;
const IFV_BARREL_FORWARD_FROM_TURRET_M =
    (IFV_TURRET_SIZE_METERS.y / 2) + (IFV_BARREL_LENGTH_M / 2) - 0.05;
const RECOVERY_BOOM_LENGTH_M = 3.2;
const RECOVERY_BOOM_RADIUS_M = 0.22;
const RECOVERY_BOOM_UP_OFFSET_M = (VEHICLE_BLOCK_SIZE_METERS.z / 2) + 0.6;
const RECOVERY_BOOM_NORTH_OFFSET_M = -0.7;
const APC_MODULE_SIZE_METERS = { x: 2.0, y: 2.4, z: 1.1 } as const;
const APC_MODULE_UP_OFFSET_M =
    (VEHICLE_BLOCK_SIZE_METERS.z / 2) + (APC_MODULE_SIZE_METERS.z / 2) + 0.05;
const APC_MODULE_NORTH_OFFSET_M = -1.1;
const APC_MED_POD_SIZE_METERS = { x: 1.2, y: 1.8, z: 0.55 } as const;
const APC_MED_MODULE_UP_OFFSET_M =
    (VEHICLE_BLOCK_SIZE_METERS.z / 2) + (APC_MODULE_SIZE_METERS.z / 2) + 0.08;
const APC_MED_POD_UP_FROM_MODULE_M =
    (APC_MODULE_SIZE_METERS.z / 2) + (APC_MED_POD_SIZE_METERS.z / 2) + 0.03;
const RECON_MAST_LENGTH_M = 1.9;
const RECON_MAST_RADIUS_M = 0.12;
const RECON_MAST_BASE_UP_OFFSET_M = (VEHICLE_BLOCK_SIZE_METERS.z / 2) + (RECON_MAST_LENGTH_M / 2) + 0.05;
const RECON_MAST_NORTH_OFFSET_M = 0.85;
const CARGO_MODULE_SIZE_METERS = { x: 2.45, y: 3.0, z: 1.35 } as const;
const CARGO_MODULE_UP_OFFSET_M =
    (VEHICLE_BLOCK_SIZE_METERS.z / 2) + (CARGO_MODULE_SIZE_METERS.z / 2) + 0.05;
const CARGO_MODULE_NORTH_OFFSET_M = -0.95;
const COMMAND_MODULE_SIZE_METERS = { x: 2.2, y: 2.6, z: 1.0 } as const;
const COMMAND_MODULE_UP_OFFSET_M =
    (VEHICLE_BLOCK_SIZE_METERS.z / 2) + (COMMAND_MODULE_SIZE_METERS.z / 2) + 0.08;
const COMMAND_MODULE_NORTH_OFFSET_M = -0.4;
const COMMAND_MAST_LENGTH_M = 1.55;
const COMMAND_MAST_RADIUS_M = 0.1;
const COMMAND_MAST_UP_FROM_MODULE_M = (COMMAND_MODULE_SIZE_METERS.z / 2) + (COMMAND_MAST_LENGTH_M / 2) + 0.05;
const COMMAND_HEAD_SIZE_METERS = { x: 0.95, y: 1.15, z: 0.32 } as const;
const COMMAND_HEAD_UP_FROM_MAST_M = (COMMAND_MAST_LENGTH_M / 2) + (COMMAND_HEAD_SIZE_METERS.z / 2) + 0.04;
const RECOVERY_RIG_BOOM_LENGTH_M = 3.0;
const RECOVERY_RIG_BOOM_RADIUS_M = 0.2;
const RECOVERY_RIG_BOOM_UP_OFFSET_M = (VEHICLE_BLOCK_SIZE_METERS.z / 2) + 0.62;
const RECOVERY_RIG_BOOM_NORTH_OFFSET_M = -0.8;
const RECOVERY_RIG_HOOK_SIZE_METERS = { x: 0.52, y: 0.72, z: 0.42 } as const;
const RECOVERY_RIG_HOOK_FORWARD_FROM_BOOM_M = (RECOVERY_RIG_BOOM_LENGTH_M / 2) - 0.25;
const RECOVERY_RIG_HOOK_UP_FROM_BOOM_M = -0.18;
const ARMORED_UPPER_HULL_WIDTH_SCALE = 0.75;
const ARMORED_UPPER_HULL_LENGTH_SCALE = 0.75;
const ARMORED_LOWER_HULL_VOLUME_SHARE = 0.6;
const ARMORED_UPPER_HULL_VOLUME_SHARE = 0.4;
const ARMORED_UPPER_HULL_HEIGHT_SCALE = 0.5;
const GROUND_PRIMITIVE_CLEARANCE_M = 0.08;
const TERRAIN_CACHE_DECIMALS = 5;
const terrainHeightCacheMeters = new Map<string, number>();
const terrainHeightRequestsInFlight = new Set<string>();
type VehicleProductBlueprint = ProductDescriptor & {
    baseBodyHeight: number;
    useArmoredSplitHull: boolean;
};
const vehicleProductCache = createProductAggregator<VehicleProductBlueprint>();

function terrainCacheKey(lonDeg: number, latDeg: number): string {
    return `${lonDeg.toFixed(TERRAIN_CACHE_DECIMALS)},${latDeg.toFixed(TERRAIN_CACHE_DECIMALS)}`;
}

function requestTerrainHeightSample(
    viewer: Cesium.Viewer | undefined,
    lonDeg: number,
    latDeg: number,
) {
    if (!viewer) return;
    const key = terrainCacheKey(lonDeg, latDeg);
    if (terrainHeightCacheMeters.has(key) || terrainHeightRequestsInFlight.has(key)) return;
    terrainHeightRequestsInFlight.add(key);
    sampleHeight(viewer, lonDeg, latDeg)
        .then((h) => {
            if (typeof h === "number" && Number.isFinite(h)) {
                terrainHeightCacheMeters.set(key, h);
            }
        })
        .catch(() => { /* ignore */ })
        .finally(() => {
            terrainHeightRequestsInFlight.delete(key);
        });
}

function isFixedVehicleBlockSidc(sidc?: string): boolean {
    return resolveSidcShapeOverride(sidc) === "vehicleBox";
}

function isVehicleTankTurretSidc(sidc?: string): boolean {
    return resolveSidcShapeOverride(sidc) === "vehicleTankTurret";
}

function isVehicleIfvTurretSidc(sidc?: string): boolean {
    return resolveSidcShapeOverride(sidc) === "vehicleIfvTurret";
}

function isVehicleArmoredTurretSidc(sidc?: string): boolean {
    return resolveSidcShapeOverride(sidc) === "vehicleArmoredTurret";
}

function isVehicleRecoveryBoomSidc(sidc?: string): boolean {
    return resolveSidcShapeOverride(sidc) === "vehicleRecoveryBoom";
}

function isVehicleApcModuleSidc(sidc?: string): boolean {
    return resolveSidcShapeOverride(sidc) === "vehicleApcModule";
}

function isVehicleApcAmbulanceSidc(sidc?: string): boolean {
    return resolveSidcShapeOverride(sidc) === "vehicleApcAmbulance";
}

function isVehicleReconMastSidc(sidc?: string): boolean {
    return resolveSidcShapeOverride(sidc) === "vehicleReconMast";
}

function isVehicleCargoModuleSidc(sidc?: string): boolean {
    return resolveSidcShapeOverride(sidc) === "vehicleCargoModule";
}

function isVehicleCommandMastSidc(sidc?: string): boolean {
    return resolveSidcShapeOverride(sidc) === "vehicleCommandMast";
}

function isVehicleRecoveryRigSidc(sidc?: string): boolean {
    return resolveSidcShapeOverride(sidc) === "vehicleRecoveryRig";
}

function isLandEquipmentWeaponsSidc(sidc?: string): boolean {
    const shape = resolveSidcShapeOverride(sidc);
    return (
        shape === "weaponCylinder"
        || shape === "weaponTriangle"
        || shape === "weaponDualTubeLauncher"
        || shape === "weaponSixTubeLauncher"
        || shape === "weaponSingleLargeTubeLauncher"
    );
}

function isGroundPrimitiveSidc(sidc?: string): boolean {
    return isLandEquipmentWeaponsSidc(sidc)
        || isFixedVehicleBlockSidc(sidc)
        || isVehicleTankTurretSidc(sidc)
        || isVehicleIfvTurretSidc(sidc)
        || isVehicleArmoredTurretSidc(sidc)
        || isVehicleRecoveryBoomSidc(sidc)
        || isVehicleApcModuleSidc(sidc)
        || isVehicleApcAmbulanceSidc(sidc)
        || isVehicleReconMastSidc(sidc)
        || isVehicleCargoModuleSidc(sidc)
        || isVehicleCommandMastSidc(sidc)
        || isVehicleRecoveryRigSidc(sidc)
        || hasLandEquipRecipeOverrideForSidc(sidc);
}

function groundPrimitiveCenterOffsetMeters(sidc?: string): number {
    if (
        isFixedVehicleBlockSidc(sidc)
        || isVehicleTankTurretSidc(sidc)
        || isVehicleIfvTurretSidc(sidc)
        || isVehicleArmoredTurretSidc(sidc)
        || isVehicleRecoveryBoomSidc(sidc)
        || isVehicleApcModuleSidc(sidc)
        || isVehicleApcAmbulanceSidc(sidc)
        || isVehicleReconMastSidc(sidc)
        || isVehicleCargoModuleSidc(sidc)
        || isVehicleCommandMastSidc(sidc)
        || isVehicleRecoveryRigSidc(sidc)
    ) {
        return vehicleCenterOffsetForSidc(sidc);
    }
    const row = findLandEquipShapeOverrideForSidc(sidc);
    if (row?.primitiveRecipe) {
        try {
            return getCompiledLandEquipRecipe(row.primitiveRecipe).bodyHalfH;
        } catch { /* ignore */ }
    }
    return getManPortableDimensions().height / 2;
}

function groundPrimitiveFootprintForSidc(sidc?: string): ProductFootprint | undefined {
    const shape = resolveSidcShapeOverride(sidc);
    if (
        shape === "vehicleBox"
        || shape === "vehicleTankTurret"
        || shape === "vehicleIfvTurret"
        || shape === "vehicleArmoredTurret"
        || shape === "vehicleRecoveryBoom"
        || shape === "vehicleApcModule"
        || shape === "vehicleApcAmbulance"
        || shape === "vehicleReconMast"
        || shape === "vehicleCargoModule"
        || shape === "vehicleCommandMast"
        || shape === "vehicleRecoveryRig"
    ) {
        return getVehicleProductBlueprint(sidc).footprint;
    }
    if (shape === "weaponDualTubeLauncher" || shape === "weaponSixTubeLauncher" || shape === "weaponSingleLargeTubeLauncher") {
        return {
            halfWidthMeters: LAUNCHER_BASE_SIZE_M.x / 2,
            halfLengthMeters: LAUNCHER_BASE_SIZE_M.y / 2,
        };
    }
    if (shape === "weaponTriangle") {
        const triHeight = (Math.sqrt(3) / 2) * WEAPON_TRIANGLE_SIDE_M;
        return {
            halfWidthMeters: WEAPON_TRIANGLE_SIDE_M / 2,
            halfLengthMeters: (2 * triHeight) / 3,
        };
    }
    if (shape === "weaponCylinder") {
        const dims = getManPortableDimensions();
        return {
            halfWidthMeters: dims.radius,
            halfLengthMeters: dims.radius,
        };
    }
    const row = findLandEquipShapeOverrideForSidc(sidc);
    if (row?.primitiveRecipe) {
        try {
            return getCompiledLandEquipRecipe(row.primitiveRecipe).footprint;
        } catch {
            return undefined;
        }
    }
    return undefined;
}

function pedestalLinesIdForUnit(id: string) {
    return `${id}${PEDESTAL_LINES_SUFFIX}`;
}

function upsertPedestalLines(
    viewer: Cesium.Viewer,
    unitEnt: Cesium.Entity,
    unitId: string,
    pedestalWpx: number,
    pedestalHpx: number,
) {
    if (!unitEnt) return;

    // If pedestal is not meaningful, hide our pedestal polyline if present.
    if (!pedestalWpx || !pedestalHpx || pedestalWpx <= 0 || pedestalHpx <= 0) {
        const hasMine = Boolean((unitEnt as any).__hasPedestalPolyline);
        if (hasMine && unitEnt.polyline) {
            (unitEnt.polyline as any).show = false;
        }
        return;
    }


    unitEnt.polyline = new Cesium.PolylineGraphics({
        show: true,
        positions: new Cesium.CallbackProperty(() => {
            try {
                const pos = unitEnt.position?.getValue?.(viewer.clock.currentTime);
                if (!pos) return undefined;

                const carto = Cesium.Cartographic.fromCartesian(pos);

                // Terrain-aware ground point (fallback to cached, then near-0)
                let ground = pedestalTipCache.get(unitId);

                try {
                    const h = viewer.scene?.globe?.getHeight?.(
                        new Cesium.Cartographic(carto.longitude, carto.latitude, carto.height),
                    );

                    if (typeof h === "number" && Number.isFinite(h)) {
                        ground = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, h + 0.2);
                        pedestalTipCache.set(unitId, ground);
                    } else if (!ground) {
                        ground = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 0.2);
                    }
                } catch {
                    if (!ground) {
                        ground = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 0.2);
                    }
                }
                // --- Pedestal size vs camera distance ---
                // Much smaller close-up, much larger far away, with “gradual then steep” shrink when zooming in.
                const BASE_MAX_M = 2000; // try 2000..8000 depending on your typical standoff
                const BASE_MIN_M = 20; // 0.5..1.5 feels right close-up

                // Calibrate the transition band to *real* camera distances.
                // Near = where you want it to be basically “small”, Far = where you want it basically “max”.
                const NEAR_M =100000;      // close orbit / inspection distance
                const FAR_M = 200000;   // ~200 km standoff for “strategic” view

                const d = Cesium.Cartesian3.distance(viewer.camera.positionWC, ground);

                // normalize [0..1]
                let t = (d - NEAR_M) / (FAR_M - NEAR_M);
                t = Math.min(1, Math.max(0, t));

                // This shape increases quickly near t=0, then flattens near t=1.
                // When you zoom in (t decreases), it shrinks gradually at first, then steeply near close-up.
                const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);

                // Exponent < 1 makes it *more* aggressive near close-up (steeper shrink as you get very close)
                const shaped = Math.pow(easeOutCubic(t), 2.5);

                const baseM = BASE_MIN_M + (BASE_MAX_M - BASE_MIN_M) * shaped;


                // Keep arms 22.5° off vertical (45° between arms)
                const TAN_22_5 = 0.41421356237309503;
                const halfWidthM = baseM * 0.5;
                let heightM = halfWidthM / TAN_22_5;

                // ---- cap height so the V ends below the icon ----
                try {
                    const u = unitMeta.get(unitId);
                    const liftPx = Number((u as any)?.__iconLiftPx ?? 0) || 0;

                    if (liftPx > 0) {
                        // Convert pixels to meters at the ground point for current camera distance
                        const w = viewer.scene.drawingBufferWidth || viewer.canvas.clientWidth;
                        const h = viewer.scene.drawingBufferHeight || viewer.canvas.clientHeight;
                        const mpp = viewer.camera.getPixelSize(new Cesium.BoundingSphere(ground, 1.0), w, h);

                        if (typeof mpp === "number" && Number.isFinite(mpp) && mpp > 0) {
                            const liftM = liftPx * mpp;

                            // Keep pedestal top below the icon (85% of lift, with a small safety margin)
                            const capM = Math.max(0.5, liftM * 0.85);
                            heightM = Math.min(heightM, capM);
                        }
                    }
                } catch { /* ignore */ }
                const enu = Cesium.Transforms.eastNorthUpToFixedFrame(ground);

                const leftTop = Cesium.Matrix4.multiplyByPoint(
                    enu,
                    new Cesium.Cartesian3(-halfWidthM, 0, heightM),
                    new Cesium.Cartesian3(),
                );

                const rightTop = Cesium.Matrix4.multiplyByPoint(
                    enu,
                    new Cesium.Cartesian3(halfWidthM, 0, heightM),
                    new Cesium.Cartesian3(),
                );

                // V-shape (left -> ground -> right)
                return [leftTop, ground, rightTop];
            } catch {
                return undefined;
            }
        }, false),

        width: 2,
        arcType: Cesium.ArcType.NONE,
        material: Cesium.Color.BLACK.withAlpha(0.55),
        depthFailMaterial: Cesium.Color.TRANSPARENT,
    });
}





function pedestalIdForUnit(id: string) {
    return `${id}${PEDESTAL_SUFFIX}`;
}
function isPedestalId(id: string) {
    return id.endsWith(PEDESTAL_SUFFIX);
}
function baseIdFromPedestalId(id: string) {
    return id.slice(0, -PEDESTAL_SUFFIX.length);
}

function isPedestalLinesId(id: string) {
    return id.endsWith(PEDESTAL_LINES_SUFFIX);
}
function baseIdFromPedestalLinesId(id: string) {
    return id.slice(0, -PEDESTAL_LINES_SUFFIX.length);
}

function makePedestalSvgDataUrl(iconPx: number) {
    const w = Math.max(12, Math.round(iconPx * 0.42));
    const h = Math.max(14, Math.round(iconPx * 0.62));

    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
        `<polygon points="0,0 ${w},0 ${w / 2},${h}" fill="rgba(255,255,255,0.22)" stroke="rgba(0,0,0,0.55)" stroke-width="1"/>` +
        `</svg>`;

    return { url: "data:image/svg+xml;utf8," + encodeURIComponent(svg), w, h };
}

function setToeWinsUnderbarPolicy(u: any, toeDataAvailableForUnit: boolean) {
    // If TOE data is available for this unit, suppress any SIDC-menu underbar
    // baked into icon generation so underbar sources are mutually exclusive.
    (u as any).__toeWinsUnderbar = !!toeDataAvailableForUnit;
}

function toeUnderbarIdForUnit(id: string) {
    return `${id}${TOE_UNDERBAR_SUFFIX}`;
}
function isToeUnderbarId(id: string) {
    return id.endsWith(TOE_UNDERBAR_SUFFIX);
}
function baseIdFromToeUnderbarId(id: string) {
    return id.slice(0, -TOE_UNDERBAR_SUFFIX.length);
}

function tagEntityWithUnitId(ent: any, unitId: string) {
    try {
        const props: any = ent?.properties;
        if (!props) {
            ent.properties = new Cesium.PropertyBag({ unitId: new Cesium.ConstantProperty(unitId) });
        } else {
            props.unitId = new Cesium.ConstantProperty(unitId);
        }
    } catch {
        /* ignore */
    }
}


function getScenarioUnitById(id: string): any {
    try {
        const sc = (window as any).__scenario;
        const store = sc?.store ?? sc;
        const state = (store as any)?.state ?? store;
        const unitMap = state?.unitMap;
        return unitMap?.[id];
    } catch {
        return undefined;
    }
}

function readPersonnelIncludeSubs(): boolean {
    try {
        const st: any = usePersonnelEditStore();
        const v: any = st?.includeSubordinates;
        return typeof v === "boolean" ? v : !!v?.value;
    } catch {
        return true; // default to 2D’s common mode
    }
}

function resolvePixelOffsetY(v: any): number {
    try {
        if (!v) return 0;
        if (typeof v.getValue === "function") {
            const vv = v.getValue(new Cesium.JulianDate());
            return (vv && typeof vv.y === "number") ? vv.y : 0;
        }
        return (typeof v.y === "number") ? v.y : 0;
    } catch {
        return 0;
    }
}

function resolvePixelOffsetX(v: any): number {
    try {
        if (!v) return 0;
        if (typeof v.getValue === "function") {
            const vv = v.getValue(new Cesium.JulianDate());
            return (vv && typeof vv.x === "number") ? vv.x : 0;
        }
        return (typeof v.x === "number") ? v.x : 0;
    } catch {
        return 0;
    }
}

/** Lift the icon + label up in pixel space so the underbar can sit on the ground. */
function setUnitIconLiftPx(unitEnt: Cesium.Entity, u: UnitRenderable, liftPx: number) {
    const bb: any = unitEnt?.billboard;
    if (bb) {
        const x = resolvePixelOffsetX(bb.pixelOffset);
        // Cesium screen-space: negative Y moves UP
        bb.pixelOffset = new Cartesian2(x, -liftPx);
    }

    const lab: any = unitEnt?.label;

    // If the postRender aligner is installed, it owns label.pixelOffset.
    const hasAlignTick = !!(unitEnt as any).__labelAlignTick;
    if (lab && !hasAlignTick) {
        const x = resolvePixelOffsetX(lab.pixelOffset);
        const baseY = (u as any)?.labelOffsetPxY ?? -12;
        lab.pixelOffset = new Cartesian2(x, baseY - liftPx);
    }
}


function hideToeUnderbar(viewer: Cesium.Viewer, unitId: string) {
    const ubId = toeUnderbarIdForUnit(unitId);
    const ub = viewer.entities.getById(ubId);
    if (ub) ub.show = false;

    // Pedestal is now attached to the UNIT entity (unitEnt.polyline),
    // so we hide that instead of a separate pedestal-lines entity.
    const unitEnt = viewer.entities.getById(unitId);
    if (unitEnt && (unitEnt as any).__hasPedestalPolyline && unitEnt.polyline) {
        (unitEnt.polyline as any).show = false;
    }

    pedestalTipCache.delete(unitId);

    // Reset icon/label lift so we don’t leave the unit “floating”
    const u = unitMeta.get(unitId);
    if (unitEnt && u) {
        (u as any).__iconLiftPx = 0;
        setUnitIconLiftPx(unitEnt, u, 0);
    }
}

function updateToeUnderbarForUnit(
    viewer: Cesium.Viewer,
    unitEnt: Cesium.Entity,
    u: UnitRenderable,
    tMs: number,
) {
    const iconPx = getBillboardBasePx(viewer, unitEnt, ICON_PX);
    const enabled = Boolean((effectiveToeUnderbarEnabled as any)?.value ?? toeMapUnderbarEnabled.value);
    const ubId = toeUnderbarIdForUnit(u.id);
    const pedId = pedestalIdForUnit(u.id);

    // Treat alt==0 as "surface" for now (common in your current pipeline)
    const surfaceAnchored = (u.clampToGround !== false) && (u.alt == null || u.alt === 0);

    if (!enabled || !unitEnt?.show) {
        hideToeUnderbar(viewer, u.id); // hides pedestal + underbar + resets lift
        setToeWinsUnderbarPolicy(u, false);
        applySymbolAwareBillboardGraphics(unitEnt as any, u as any, viewer);
        return;
    }

    // -------------------------------------------------------------
    // 1) Pedestal FIRST (so it shows even if pct cannot be computed)
    // -------------------------------------------------------------
    let pedestalH = 0;

    if (surfaceAnchored) {
        const { w: pedW, h: pedH } = makePedestalSvgDataUrl(iconPx);
        pedestalH = pedH;
        upsertPedestalLines(viewer, unitEnt, u.id, pedW, pedH);
    } else {
        if ((unitEnt as any).__hasPedestalPolyline && unitEnt.polyline) {
            (unitEnt.polyline as any).show = false;
        }
    }
    // -------------------------------------------------------------
    // 2) Compute pct using the scenario unitMap (authoritative)
    // -------------------------------------------------------------
    const baseUnit = getScenarioUnitById(u.id) ?? (u as any).__sourceUnit ?? u;
    const includeSubs = readPersonnelIncludeSubs();

    let pct: number | null = null;
    try {
        pct = computeToePctForUnit(baseUnit, tMs, includeSubs, getScenarioUnitById);
    } catch {
        pct = null;
    }

    // TOE wins if we have enough personnel/baseline data to compute TOE pct.
    // This keeps SIDC-menu underbars mutually exclusive with TOE-driven underbars.
    const toeDataAvailableForUnit = pct != null && Number.isFinite(pct);

    const prevToeWins = Boolean((u as any).__toeWinsUnderbar);
    setToeWinsUnderbarPolicy(u, toeDataAvailableForUnit);

    // If policy changed, force an icon rebuild this tick so baked underbar disappears/returns.
    if (prevToeWins !== toeDataAvailableForUnit) {
        // Only force “plain SIDC icon” if we can actually build one.
        const sidcNow = effectiveSidc(u, viewer);
        const canBuildPlain = (typeof sidcNow === "string" && sidcNow.trim().length > 0);

        if (toeDataAvailableForUnit && canBuildPlain) {
            // Only clear generated (data:) icons; don't nuke user media URLs.
            if (typeof u.iconUrl === "string" && u.iconUrl.startsWith("data:")) {
                u.iconUrl = undefined;
            }
            applySymbolAwareBillboardGraphics(unitEnt as any, u as any, viewer);
        } else if (!toeDataAvailableForUnit) {
            // TOE no longer winning ? allow baked SIDC-menu underbar again.
            applySymbolAwareBillboardGraphics(unitEnt as any, u as any, viewer);
        }
    }


    // If pct not available or full strength, hide ONLY the underbar (keep pedestal).
    if (pct == null) {
        const ub = viewer.entities.getById(ubId);
        if (ub) ub.show = false;

        // Persist lift so later billboard rebuilds don’t drop the icon back onto the ground
        const liftPx = surfaceAnchored ? (pedestalH + 2) : 0;
        (u as any).__iconLiftPx = liftPx;

        setUnitIconLiftPx(unitEnt, u, liftPx);
        return;
    }

    // -------------------------------------------------------------
    // 3) Underbar render
    // -------------------------------------------------------------
    const { url: rawUrl, w, h, gapPx } = makeToeUnderbarSvgDataUrl(pct, iconPx);
    const url = sanitizeIconUrlForImageLoad(rawUrl);

    function getBillboardBasePx(viewer: Cesium.Viewer, ent: Cesium.Entity, fallbackPx: number): number {
        try {
            const bb: any = ent.billboard;
            if (!bb) return fallbackPx;

            const t = viewer.clock?.currentTime;
            const w = (bb.width && typeof bb.width.getValue === "function")
                ? bb.width.getValue(t)
                : bb.width;

            return (typeof w === "number" && w > 0) ? w : fallbackPx;
        } catch {
            return fallbackPx;
        }
    }

    const verticalOrigin = surfaceAnchored ? VerticalOrigin.BOTTOM : VerticalOrigin.TOP;
    const heightReference = HeightReference.CLAMP_TO_GROUND;

    const BAR_PLATFORM_GAP_PX = 2;   // bar sits this far above the cone top
    const ICON_BAR_GAP_PX = 6;       // increase this if you want more separation

    const barBaseY = pedestalH + BAR_PLATFORM_GAP_PX;

    // Underbar placement (surface): bar anchored above the cone “platform”
    const pixelOffset = surfaceAnchored
        ? new Cartesian2(0, -barBaseY)   // negative moves UP
        : new Cartesian2(0, -gapPx);

    // Icon lift: cone -> bar -> gap -> icon
    const liftPx = surfaceAnchored
        ? (pedestalH + BAR_PLATFORM_GAP_PX + h + ICON_BAR_GAP_PX)
        : 0;

    (u as any).__iconLiftPx = liftPx;
    setUnitIconLiftPx(unitEnt, u, liftPx);


    const ubEnt = viewer.entities.getById(ubId) ?? viewer.entities.add({ id: ubId });
    tagEntityWithUnitId(ubEnt, u.id);
    ubEnt.position = unitEnt.position;
    ubEnt.orientation = undefined as any;

    const sig = `${Math.round(pct * 10) / 10}`;
    const prev = lastToeUnderbarSig.get(u.id);

    if (prev !== sig || !ubEnt.billboard) {
        lastToeUnderbarSig.set(u.id, sig);
        ubEnt.billboard = new Cesium.BillboardGraphics({
            image: url,
            width: w,
            height: h,
            horizontalOrigin: HorizontalOrigin.CENTER,
            verticalOrigin,
            pixelOffset,
            heightReference,
            disableDepthTestDistance: 0,
            scaleByDistance: new Cesium.NearFarScalar(800, 1.0, 2_000_000, 0.4),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 10_000_000.0),
        });
    } else {
        const bb: any = ubEnt.billboard;
        bb.verticalOrigin = verticalOrigin;
        bb.pixelOffset = pixelOffset;
        bb.heightReference = heightReference;
        bb.width = w;
        bb.height = h;
        bb.disableDepthTestDistance = 0;
    }
    const unitBB: any = unitEnt.billboard;
    const ubBB: any = ubEnt.billboard;
    if (unitBB?.scaleByDistance && ubBB) ubBB.scaleByDistance = unitBB.scaleByDistance;
    ubEnt.show = true;
}

function stripSidcMenuUnderbarEncoding(sidc: string): string {
    // Underbar-encoded example: 10031030161211000000
    // Plain version:            10031000161211000000
    if (typeof sidc !== "string" || sidc.length < 8) return sidc;

    const a = sidc.split("");

    // 0-based indices: 6 = 7th char, 7 = 8th char
    if (a[6] === "3") a[6] = "0";
    if (a[7] === "3") a[7] = "0";

    return a.join("");
}

function stripSidcUnderbarForIcon(u: UnitRenderable, forcedSidc?: string): UnitRenderable {
    const copy: any = { ...u };

    // Force builders/hooks that read u.sidc (instead of the sidc argument) to see the *plain* SIDC.
    if (typeof forcedSidc === "string" && forcedSidc.trim()) {
        copy.sidc = forcedSidc;
        if (copy.__sourceUnit && typeof copy.__sourceUnit === "object") {
            copy.__sourceUnit = { ...copy.__sourceUnit, sidc: forcedSidc };
        }
    }

    delete copy.iconUrl;
    if (copy.__sourceUnit && typeof copy.__sourceUnit === "object") {
        const su = { ...copy.__sourceUnit };
        delete su.iconUrl;
        copy.__sourceUnit = su;
    }

    // Remove common direct fields (defensive)
    delete copy.underbar;
    delete copy.underbars;
    delete copy.underbarText;
    delete copy.underbarValue;
    delete copy.underbarEnabled;

    // Scrub symbolOptions keys containing "underbar" (if present)
    if (copy.symbolOptions && typeof copy.symbolOptions === "object") {
        const so: any = { ...copy.symbolOptions };
        for (const k of Object.keys(so)) {
            if (/underbar/i.test(k)) delete so[k];
        }
        copy.symbolOptions = so;
    }

    return copy as UnitRenderable;
}

/** Build a URL/dataURL for a unit's icon synchronously (no async, no point fallback). */
function buildIconUrlSync(u: UnitRenderable, viewer?: Cesium.Viewer): string | undefined {
    let toeWins = Boolean((u as any).__toeWinsUnderbar);

    // If we cannot resolve a SIDC, never suppress iconUrl/2D snapshot;
    // otherwise we risk removing the unit billboard entirely (common at TOE=0 edge cases).
    const sidcForToe = effectiveSidc(u, viewer);
    if (!(typeof sidcForToe === "string" && sidcForToe.trim())) {
        toeWins = false;
    }

    // 0) If we already have an explicit image, keep it (do NOT invalidate it).
    if (!toeWins && typeof u.iconUrl === "string" && u.iconUrl.trim()) {
        const hex0 = normalizeHex(extractGroupFill(u));
        // Only tint real URLs; data: already baked
        const kept = (hex0 && !u.iconUrl.startsWith("data:"))
            ? (withSymbolColor(u.iconUrl, hex0) ?? u.iconUrl)
            : u.iconUrl;
        u.iconUrl = kept;
        return kept;
    }

    // 1) Resolve a SIDC if possible, but do NOT fail just because we can't.
    let sidc = effectiveSidc(u, viewer) ?? (u as any)?.sidc;

    // TOE wins: prevent SIDC-menu underbar from being baked into the ICON by normalizing
    // the underbar-encoded SIDC only for the billboard render.
    if (toeWins && typeof sidc === "string" && sidc.trim()) {
        sidc = stripSidcMenuUnderbarEncoding(sidc);
    }

    const hex = normalizeHex(extractGroupFill(u));

    // 2D snapshot is allowed even when TOE wins because we pass the *stripped* SIDC.
    const from2D = sidc ? tryGet2DIconSnapshotSync(sidc, ICON_PX, hex) : undefined;
    if (from2D && typeof from2D === "string") {
        return from2D;
    }

    const uForIcon = toeWins ? stripSidcUnderbarForIcon(u, sidc) : u;

    // 3) Builders (also allowed when TOE wins; uForIcon has sidc stripped)
    const fromBuilder = tryGlobalUnitIconBuilder(uForIcon, sidc);
    if (fromBuilder && typeof fromBuilder === "string") return fromBuilder;

    const fromSidc = buildIconUrlForSidc(uForIcon, sidc);
    if (fromSidc && typeof fromSidc === "string") return fromSidc;

    // 3) App-level URL builders (prefer URL so we can tint later on change).
    let url: string | undefined = undefined;

    // IMPORTANT: when TOE wins, skip app hooks/builders that may re-apply SIDC underbars
    // by reading u.sidc / unit state internally. Let the SIDC-only fallbacks below run.
    if (sidc && !toeWins) {
        url = tryGlobalUnitIconBuilder(uForIcon, sidc) ?? buildIconUrlForSidc(uForIcon, sidc);
    }

    // 4) If still nothing and we have a global symbol base, build a URL.
    if (!url && sidc) {
        const base = getGlobalSymbolBase();
        if (base) url = urlFromBaseAndSidc(base, sidc, ICON_PX);
    }

    // 5) If still nothing and we *do* have a SIDC, render a synchronous data URL.
    if (!url && sidc) {
        url = tryMilsymbolDataUrlSync(sidc, ICON_PX, hex);
    }
    // 5b) Fallback: use the app icon cache (works even if milsymbol isn't available in 3D)
    if (!url && sidc) {
        const cached = getSidcIconSync(sidc, { fillColor: hex }, ICON_PX);
        if (typeof cached === "string" && cached.length > 0) {
            url = cached;
        }
    }
    // 6) Final guard: if we still have nothing, don’t nuke the entity—return undefined
    // so the caller can keep whatever billboard it already had. (applyBillboardGraphics
    // already avoids creating a billboard when no string is returned.)
    if (!url) return undefined;

    // 7) Only append color to real URLs; data: already baked
    if (hex && !url.startsWith("data:")) {
        url = withSymbolColor(url, hex) ?? url;
    }

    u.iconUrl = url;
    return url;
}



/* --------------------- Motion helpers (time-dynamic) --------------------- */

function hasDynamicPosition(u: UnitRenderable, ent: Cesium.Entity): boolean {
    // If we gave Cesium a CallbackProperty or SampledPositionProperty, let Cesium drive position from clock time
    const pos = ent.position as any;
    if (!pos) return false;
    const isCallback = pos instanceof CallbackProperty;
    const isSampled = pos instanceof SampledPositionProperty;
    // Also treat unit’s own motion definitions as dynamic
    const unitDynamic = typeof u.getPositionAtTime === "function" || (u.motionKeyframes?.length ?? 0) > 0;
    return Boolean(isCallback || isSampled || unitDynamic);
}

function lastLocEventAtOrBefore(uSrc: any, tMs: number): any | undefined {
    const evts: any[] = Array.isArray(uSrc?.state) ? uSrc.state : [];
    let best: any | undefined;
    for (const e of evts) {
        const te = evtTime(e); if (te == null) continue;
        if (!Object.prototype.hasOwnProperty.call(e, "location")) continue;
        if (te <= tMs && (!best || te > evtTime(best)!)) best = e;
    }
    return best;
}

function firstFutureNonNullLocEvent(uSrc: any, tMs: number): any | undefined {
    const evts: any[] = Array.isArray(uSrc?.state) ? uSrc.state : [];
    let best: any | undefined;
    for (const e of evts) {
        const te = evtTime(e); if (te == null) continue;
        if (!Array.isArray(e?.location)) continue;
        if (te >= tMs && (!best || te < evtTime(best)!)) best = e;
    }
    return best;
}

function lastExplicitSidcEventAtOrBefore(uSrc: any, tMs: number): string | undefined {
    const evts: any[] = Array.isArray(uSrc?.state) ? uSrc.state : [];
    let bestSidc: string | undefined;
    let bestT = -Infinity;
    for (const e of evts) {
        const te = evtTime(e); if (te == null) continue;
        if (te <= tMs && typeof e?.sidc === "string" && e.sidc.trim() && te >= bestT) {
            bestT = te;
            bestSidc = e.sidc;
        }
    }
    return bestSidc;
}

function buildPositionPropertyForUnit(u: UnitRenderable) {
    if (u.motionKeyframes && u.motionKeyframes.length) {
        const spp = new SampledPositionProperty();
        const frames = [...u.motionKeyframes].sort((a, b) => a.t - b.t);
        for (const kf of frames) {
            const jd = JulianDate.fromDate(new Date(kf.t));
            const pos = Cartesian3.fromDegrees(kf.lon, kf.lat, kf.alt ?? 0);
            spp.addSample(jd, pos);
        }
        return spp as Cesium.PositionProperty;
    }

    if (typeof u.getPositionAtTime === "function") {
        const cb = new CallbackProperty((time: JulianDate) => {
            try {
                const unixMs = JulianDate.toDate(time).getTime();
                const p = u.getPositionAtTime!(unixMs);
                return p ? Cartesian3.fromDegrees(p.lon, p.lat, p.alt ?? 0) : undefined;
            } catch {
                return undefined;
            }
        }, false);
        return cb as Cesium.PositionProperty;
    }

    return undefined; // static
}

function applyPathGraphics(ent: Cesium.Entity, u: UnitRenderable) {
    const wantShow = u.pathStyle?.show ?? false;
    const pos: any = ent.position;
    const supportsRef = pos && typeof pos.getValueInReferenceFrame === "function";

    if (!wantShow || !supportsRef) {
        ent.path = undefined;
        return;
    }

    const width = u.pathStyle?.width ?? 2;
    const lead = u.pathStyle?.leadTime ?? 60;
    const trail = u.pathStyle?.trailTime ?? 300;
    const color = Color.fromCssColorString(u.pathStyle?.colorCss ?? "rgba(255,255,255,0.6)");

    ent.path = {
        show: true,
        width,
        leadTime: lead,
        trailTime: trail,
        material: color,
        clampToGround: true,
    };
}

/* ------------------------------- Types ------------------------------- */

export type { TrackPoint, UnitRenderable, GlobePort } from "./globeAdapter/types";

/* ------------------------------- CRS & terrain ------------------------------- */

const wgs84 = "EPSG:4326";
const merc = "EPSG:3857";

export function toWgs84(lon3857: number, lat3857: number) {
    const [lon, lat] = proj4(merc, wgs84, [lon3857, lat3857]);
    return { lon, lat };
}

export async function sampleHeight(viewer: Viewer, lon: number, lat: number) {
    const c = Cartographic.fromDegrees(lon, lat);
    const provider = (viewer.terrain as any).provider;
    const [result] = await sampleTerrainMostDetailed(provider, [c]);
    return result?.height ?? 0;
}

/* ----------------------------- Label helper ----------------------------- */

function makeSideLabel(
    text: string,
    heightRef: HeightReference,
    side: "left" | "right" = "left",
    pixelOffsetY = -12
) {
    const isLeft = side === "left";
    const offsetX = isLeft ? -12 : 12;
    const hOrigin = isLeft ? HorizontalOrigin.RIGHT : HorizontalOrigin.LEFT;

    return {
        text,
        font: "bold 14px 'Segoe UI', system-ui, -apple-system, Roboto, Arial",
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        fillColor: Color.BLACK,
        outlineColor: Color.WHITE,
        outlineWidth: 3,
        showBackground: false,
        heightReference: heightRef,
        verticalOrigin: VerticalOrigin.BOTTOM,
        horizontalOrigin: hOrigin,
        pixelOffset: new Cartesian2(offsetX, pixelOffsetY),
        disableDepthTestDistance: 0,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 2_000_000.0),
        scaleByDistance: new Cesium.NearFarScalar(800, 1.1, 2_000_000, 0.5),
        translucencyByDistance: new Cesium.NearFarScalar(50_000, 1.0, 1_500_000, 0.4),
        pixelOffsetScaleByDistance: new Cesium.NearFarScalar(800, 1.0, 2_000_000, 0.4),
    };
}

/* --------------------- Exaggeration-aware heights --------------------- */

const entities = new Map<string, Cesium.Entity>();
const unitMeta = new Map<string, UnitRenderable>();
const lastFillHex = new Map<string, string | undefined>();
let exaggerationFactor = 1;
let groupColorIdx: Map<string | number, string> = new Map();
const rangeRingEntities = new Map<string, Cesium.Entity>();

// Global visibility switch for 3D range-rings
let rangeRingsVisible = true;

/* filter state */
let _unitFilter: (u: any) => boolean = () => true;
let _lastUnitsInput: UnitRenderable[] = [];

/* imagery & overlays */
let baseImageryLayer: Cesium.ImageryLayer | undefined;
const overlayLayers = new Map<string, Cesium.ImageryLayer>();

/** Publish debug handles to window so the console can inspect current 3D units. */
function publishDebug(viewer?: Cesium.Viewer) {
    try {
        const w: any = window;
        // Preserve existing MentatGlobe object (adapter) and just attach/refresh .viewer
        w.MentatGlobe = w.MentatGlobe || {};
        if (viewer) w.MentatGlobe.viewer = viewer;
        else if (!w.MentatGlobe.viewer) w.MentatGlobe.viewer = undefined;

        const dbg = w.MentatGlobeAdapterDebug ?? {};
        Object.assign(dbg, {
            viewer: viewer ?? dbg.viewer,
            _entities: entities,
            _unitMeta: unitMeta,
            getCounts: () => ({
                entities: (viewer ?? dbg.viewer)?.entities?.values?.length ?? 0,
                rawCount: w.__mentatLastSetUnits?.rawCount ?? null,
                filteredCount: w.__mentatLastSetUnits?.filteredCount ?? null,
                sample: w.__mentatLastSetUnits?.sample ?? null,
            }),
        });
        w.MentatGlobeAdapterDebug = dbg;

        w.MentatList3D = () => {
            const d = w.MentatGlobeAdapterDebug;
            if (d?._entities && typeof d._entities.keys === "function") {
                return Array.from(d._entities.keys());
            }
            const v = d?.viewer;
            return v ? (v.entities.values as any[]).map(e => e.id) : [];
        };

        w.MentatDebugSIDC = (id?: string) => {
            const d = w.MentatGlobeAdapterDebug;
            const v = d?.viewer;
            const t = v ? Cesium.JulianDate.toDate(v.clock.currentTime).getTime() : Date.now();
            let targetId = id;
            if (!targetId) {
                targetId = d?._entities ? Array.from(d._entities.keys())[0] : v?.entities?.values?.[0]?.id;
            }
            const ent = targetId ? (d?._entities?.get(targetId) ?? v?.entities?.getById?.(targetId)) : undefined;
            const u = ent ? d?._unitMeta?.get(ent.id) : undefined;
            const src = u?.__sourceUnit ?? u ?? null;
            const sidcFromEvents = src ? (w.lastSidcAtOrBefore?.(src, t)) : undefined;
            const sidcFromUnit = src?.sidc ?? u?.sidc;
            return { id: ent?.id, t, sidcFromEvents, sidcFromUnit, u, src };
        };

        w.MentatDebugMobility = (id?: string) => {
            const d = w.MentatGlobeAdapterDebug;
            const v = d?.viewer;
            let targetId = id;
            if (!targetId) {
                targetId = d?._entities ? Array.from(d._entities.keys())[0] : v?.entities?.values?.[0]?.id;
            }
            const ent = targetId ? (d?._entities?.get(targetId) ?? v?.entities?.getById?.(targetId)) : undefined;
            const u = ent ? d?._unitMeta?.get(ent.id) : undefined;
            const sidc = u ? mobilitySidcForUnit(u, v) : undefined;
            return {
                id: ent?.id,
                sidc,
                profile: resolveLandEquipmentMobilityProfileFromSidc(sidc),
                mobilityPartIds: ent ? vehicleMobilityPartIdsForUnit(v, ent.id as string) : [],
                cache: (w.__3dMobilityLastProfileByUnit ?? {})[ent?.id ?? ""],
            };
        };
    } catch { /* no-op */ }
}


function scaledHover(h?: number) {
    return Math.max(0, h ?? 0) * exaggerationFactor;
}
function scaledAlt(alt?: number) {
    return (alt ?? 0) * exaggerationFactor;
}

function applyAvailability(ent: Cesium.Entity, u: UnitRenderable) {
    ent.availability = undefined;
}

/* ----------------------------- Graphics appliers ----------------------------- */

/** Place the label so its RIGHT edge sits at the icon's LEFT edge (minus pad),
 *  using the icon's *real* pixel width (naturalWidth/width * scale * scaleByDistance).
 *  It tracks image changes and re-evaluates each frame.
 */

function installIconLiftTick(viewer: Cesium.Viewer, ent: Cesium.Entity, u: UnitRenderable) {
    if ((ent as any).__iconLiftTick) return;

    const tick = () => {
        const liftPx = Number((u as any).__iconLiftPx ?? 0) || 0;
        if (!ent.billboard) return;

        // Force as a Cesium Property to avoid any “POJO vs Graphics” weirdness.
        (ent.billboard as any).pixelOffset =
            new Cesium.ConstantProperty(new Cesium.Cartesian2(0, -liftPx));

        // Keep terrain-safe behavior stable
        (ent.billboard as any).disableDepthTestDistance = 0;
    };

    (ent as any).__iconLiftTick = tick;
    viewer.scene.postRender.addEventListener(tick);
}

function uninstallIconLiftTick(viewer: Cesium.Viewer, ent: Cesium.Entity) {
    const tick = (ent as any).__iconLiftTick;
    if (!tick) return;
    viewer.scene.postRender.removeEventListener(tick);
    (ent as any).__iconLiftTick = undefined;
}

function alignLabelToIconLeftEdge(
    viewer: Cesium.Viewer,
    ent: Cesium.Entity,
    u: UnitRenderable,
    padPx = 2
) {
    const bb = ent.billboard as Cesium.BillboardGraphics | undefined;
    const label = ent.label as Cesium.LabelGraphics | undefined;
    if (!bb || !label) return;

    // Label’s right edge should sit flush to the icon’s left edge
    label.horizontalOrigin = Cesium.HorizontalOrigin.RIGHT;
    label.verticalOrigin = Cesium.VerticalOrigin.CENTER;

    // keep your vertical lift behavior
    const iconLift = Number((u as any).__iconLiftPx ?? 0) || 0;
    const baseY = (u as any)?.labelOffsetPxY ?? -12;
    const lift = baseY - iconLift;

    // Clean any previous tick
    try {
        const old = (ent as any).__labelAlignTick as (() => void) | undefined;
        if (old) viewer.scene.postRender.removeEventListener(old);
    } catch { }

    // Small cache of intrinsic image width (so URLs without bb.width work)
    let intrinsicW: number | undefined;
    let intrinsicH: number | undefined;

    // Utility: read “property-or-value” at the viewer clock time
    const now = () => viewer.clock.currentTime;
    const v = <T,>(maybeProp: any, fallback: T): T => {
        try {
            if (maybeProp && typeof maybeProp.getValue === "function") {
                const out = maybeProp.getValue(now());
                return (out ?? fallback) as T;
            }
            return (maybeProp ?? fallback) as T;
        } catch { return fallback; }
    };

    // Try to ensure we have intrinsic width even when bb.width isn't set and image is a URL
    const ensureIntrinsicWidth = () => {
        const rawImgVal: any = v(bb.image, undefined);
        const imgVal: any = typeof rawImgVal === "string"
            ? sanitizeIconUrlForImageLoad(rawImgVal)
            : rawImgVal;
        if (!imgVal) return;

        // If already an HTMLImageElement (from 2D cache), use its dimensions directly
        if (imgVal && (imgVal.naturalWidth || imgVal.width)) {
            intrinsicW = (imgVal.naturalWidth ?? imgVal.width) as number;
            intrinsicH = (imgVal.naturalHeight ?? imgVal.height) as number;
            return;
        }

        // If it's a string (URL or data URL) and we haven’t cached yet, preload once
        if (typeof imgVal === "string" && !intrinsicW) {
            try {
                const key = imgVal; // include sidc/fill params so size caches per symbol
                const cache = ((window as any).__bbSizeCache ||= new Map<string, number>());
                const cached = cache.get(key);
                if (cached) { intrinsicW = cached; return; }

                const im = new Image();
                im.onload = () => {
                    intrinsicW = im.naturalWidth || im.width || undefined;
                    intrinsicH = im.naturalHeight || im.height || undefined;
                    if (intrinsicW) cache.set(key, intrinsicW);
                };
                im.onerror = () => { /* ignore; we'll retry next frame */ };
                im.src = imgVal;
            } catch { /* ignore */ }
        }
    };

    // Evaluate Cesium.NearFarScalar like Cesium does
    const evalNearFar = (nfs: Cesium.NearFarScalar | undefined, d: number): number => {
        if (!nfs) return 1;
        const near = (nfs as any).near ?? (nfs as any)._near ?? 1;
        const nVal = (nfs as any).nearValue ?? (nfs as any)._nearValue ?? 1;
        const far = (nfs as any).far ?? (nfs as any)._far ?? 1e9;
        const fVal = (nfs as any).farValue ?? (nfs as any)._farValue ?? 1;
        if (d <= near) return nVal;
        if (d >= far) return fVal;
        const t = (d - near) / Math.max(1e-9, far - near);
        return nVal + (fVal - nVal) * t;
    };

    const tick = () => {
        const time = now();
        const pos = ent.position?.getValue(time) as Cesium.Cartesian3 | undefined;
        if (!pos) return;

        ensureIntrinsicWidth();
        // 1) Base width: prefer explicit bb.width, else intrinsic (naturalWidth)
        let baseW = v<number | undefined>(bb.width, undefined);
        if (!(typeof baseW === "number" && baseW > 0)) baseW = intrinsicW;
        if (!(typeof baseW === "number" && baseW > 0)) return; // width unknown yet

        // 2) Effective scale = scale * scaleByDistance(distance)
        const baseScale = v<number>(bb.scale, 1);
        let distScale = 1;
        try {
            const dist = Cesium.Cartesian3.distance(viewer.camera.positionWC, pos);
            distScale = evalNearFar(v<Cesium.NearFarScalar | undefined>(bb.scaleByDistance, undefined), dist);
        } catch { /* ignore */ }
        const effScale = baseScale * distScale;

        // 3) Effective billboard width in screen pixels
        const effWidthPx = baseW * effScale;

        // 4) Respect billboard.horizontalOrigin & pixelOffset
        const bbH = v<number>(bb.horizontalOrigin, Cesium.HorizontalOrigin.CENTER);
        const leftFromOrigin =
            bbH === Cesium.HorizontalOrigin.LEFT ? 0 :
                bbH === Cesium.HorizontalOrigin.RIGHT ? -effWidthPx :
                    -effWidthPx / 2; // CENTER

        const bbPx = v<Cesium.Cartesian2 | undefined>(bb.pixelOffset, undefined);
        const bbOffX = bbPx ? bbPx.x : 0;
        const bbOffY = bbPx ? bbPx.y : 0;

        let baseH = v<number | undefined>(bb.height, undefined);
        if (!(typeof baseH === "number" && baseH > 0)) baseH = intrinsicH;
        if (!(typeof baseH === "number" && baseH > 0)) baseH = baseW; // fallback square
        const effHeightPx = baseH * effScale;
        const iconCenterY = bbOffY - (effHeightPx / 2);


        // 5) Put label’s RIGHT edge at the icon’s LEFT edge minus pad
        const rightEdgeX = leftFromOrigin + bbOffX - padPx;

        // Apply offsets and keep your lift
        const extraY = (u.labelOffsetPxY ?? 0); // optional tweak; 0 means truly centered
        label.pixelOffset = new Cesium.Cartesian2(rightEdgeX, iconCenterY + extraY);

        // Make label distance behavior track billboard (optional, but helps match feel)
        const lblNfs = v<Cesium.NearFarScalar | undefined>(label.pixelOffsetScaleByDistance, undefined);
        if (!lblNfs && bb.scaleByDistance) {
            // Ensures the label offset scales similarly to the icon’s scaleByDistance curve
            label.pixelOffsetScaleByDistance = v(bb.scaleByDistance, undefined) as any;
        }
    };

    viewer.scene.postRender.addEventListener(tick);
    (ent as any).__labelAlignTick = tick;
}



function applyBlockGraphics(ent: Cesium.Entity, u: UnitRenderable) {
    const size = u.blockSize ?? { x: 12, y: 12, z: 4 };
    const color = safeCssColor(u.symbolOptions?.fillColor).withAlpha(0.92);
    const h = Math.max(0.1, scaledHover(u.hoverMeters ?? 8));

    setEntityPosition(ent, u.lon, u.lat, h);

    ent.box = {
        dimensions: new Cartesian3(size.x, size.y, size.z),
        material: color,
        heightReference: HeightReference.RELATIVE_TO_GROUND,
        outline: true,
        outlineColor: Color.BLACK,
    };

    if (u.name) {
        const lift = u.labelOffsetPxY ?? -14;
        ent.label = makeSideLabel(u.name, HeightReference.RELATIVE_TO_GROUND, "left", lift);
        if (ent.label) {
            ent.label.fillColor = Cesium.Color.BLACK;
            ent.label.outlineColor = Cesium.Color.WHITE;
            ent.label.outlineWidth = 3;
            ent.label.style = Cesium.LabelStyle.FILL_AND_OUTLINE;
            ent.label.font = "bold 14px 'Segoe UI', sans-serif";
            ent.label.pixelOffset = new Cesium.Cartesian2(0, lift);
            ent.label.eyeOffset = new Cesium.Cartesian3(
                -GROUND_UNIT_LABEL_LEFT_OFFSET_M,
                GROUND_UNIT_LABEL_UP_OFFSET_M,
                0,
            );
            ent.label.showBackground = false;
        }
    } else {
        ent.label = undefined;
    }

    ent.billboard = undefined;
    ent.cylinder = undefined;
    applyAvailability(ent, u);
}

function applyVehicleBlockGraphics(ent: Cesium.Entity, u: UnitRenderable, viewer?: Cesium.Viewer) {
    const sidcForProfile = mobilitySidcForUnit(u, viewer);
    const useArmoredSplitHull = shouldUseArmoredSplitHullForSidc(sidcForProfile);
    const vehicleProduct = getVehicleProductBlueprint(sidcForProfile);
    const armoredHullPartIds = useArmoredSplitHull ? armoredHullPartIdsForUnit(u.id) : [];
    const mobilityPartIds = vehicleMobilityPartIdsForSidc(u.id, sidcForProfile);
    const hullAddonPartIds = vehicleHullAddonPartIdsForSidc(u.id, sidcForProfile);
    clearGroundOverrideArtifacts(viewer, u, {
        removeSidcCap: true,
        preserveEntityIds: [...armoredHullPartIds, ...mobilityPartIds, ...hullAddonPartIds],
    });
    clearGroundOverrideEntityGraphics(ent);

    const size = resolveVehicleHullSizeForSidc(sidcForProfile);
    const baseBodyHeight = vehicleProduct.baseBodyHeight;
    const fillCss = extractGroupFill(u) ?? u.symbolOptions?.fillColor;
    const color = safeCssColor(fillCss).withAlpha(1.0);
    const hullSplit = useArmoredSplitHull ? computeArmoredHullSplit(size) : undefined;

    const centerOffset = hullSplit ? (hullSplit.lowerHeight / 2) : (baseBodyHeight / 2);
    const pose = makeGroundPrimitivePoseProperties(viewer, u, centerOffset, vehicleProduct.footprint);
    ent.position = pose.position as any;
    ent.orientation = pose.orientation as any;
    applyPathGraphics(ent, u);

    ent.box = {
        dimensions: new Cartesian3(size.x, size.y, hullSplit ? hullSplit.lowerHeight : baseBodyHeight),
        material: color,
        heightReference: HeightReference.NONE,
        outline: true,
        outlineColor: Color.BLACK,
    };
    if (hullSplit) {
        ensureArmoredUpperHullPrismGraphics(ent, u, viewer, color, hullSplit);
    }

    if (u.name) {
        const lift = u.labelOffsetPxY ?? -14;
        ent.label = makeSideLabel(u.name, HeightReference.NONE, "left", lift);
        if (ent.label) {
            ent.label.fillColor = Cesium.Color.BLACK;
            ent.label.outlineColor = Cesium.Color.WHITE;
            ent.label.outlineWidth = 3;
            ent.label.style = Cesium.LabelStyle.FILL_AND_OUTLINE;
            ent.label.font = "bold 14px 'Segoe UI', sans-serif";
            ent.label.pixelOffset = new Cesium.Cartesian2(0, lift);
            applyGroundPrimitiveLabelOffset(ent.label);
            ent.label.showBackground = false;
        }
    } else {
        ent.label = undefined;
    }

    ent.point = undefined as any;
    ent.billboard = undefined as any;
    safelyDisableEntityCylinder(ent);
    ent.polygon = undefined as any;
    applyVehicleHullAddons(ent, u, viewer, color, sidcForProfile);
    applyVehicleMobilityAddons(ent, u, viewer, color, sidcForProfile);
    applyAvailability(ent, u);
}

function applyVehicleTankTurretGraphics(ent: Cesium.Entity, u: UnitRenderable, viewer?: Cesium.Viewer) {
    const tankPartIds = tankPartIdsForUnit(u.id);
    const sidcForProfile = mobilitySidcForUnit(u, viewer);
    const useArmoredSplitHull = shouldUseArmoredSplitHullForSidc(sidcForProfile);
    const armoredHullPartIds = useArmoredSplitHull ? armoredHullPartIdsForUnit(u.id) : [];
    const tankProfile = tankVisualProfileForSidc(sidcForProfile);
    const mobilityPartIds = vehicleMobilityPartIdsForSidc(u.id, sidcForProfile);
    clearGroundOverrideArtifacts(viewer, u, {
        removeSidcCap: true,
        preserveEntityIds: [...tankPartIds, ...armoredHullPartIds, ...mobilityPartIds],
    });
    clearGroundOverrideEntityGraphics(ent);

    const hullSize = tankProfile.hullSize;
    const fillCss = extractGroupFill(u) ?? u.symbolOptions?.fillColor;
    const color = safeCssColor(fillCss).withAlpha(1.0);
    const hullSplit = useArmoredSplitHull ? computeArmoredHullSplit(hullSize) : undefined;
    const turretNorthOffset = hullSplit
        ? ((tankProfile.turretSize.y / 2) - (hullSplit.upperSize.y / 2))
        : 0;
    const turretUpOffset = hullSplit
        ? (hullSplit.upperCenterUpFromLowerCenter + (hullSplit.upperSize.z / 2) + (tankProfile.turretSize.z / 2) + 0.06)
        : tankProfile.turretUpOffset;
    const centerOffset = hullSplit ? (hullSplit.lowerHeight / 2) : (hullSize.z / 2);

    const pose = makeGroundPrimitivePoseProperties(viewer, u, centerOffset, {
        halfWidthMeters: hullSize.x / 2,
        halfLengthMeters: hullSize.y / 2,
    });
    ent.position = pose.position as any;
    ent.orientation = pose.orientation as any;
    applyPathGraphics(ent, u);

    ent.box = {
        dimensions: new Cartesian3(hullSize.x, hullSize.y, hullSplit ? hullSplit.lowerHeight : hullSize.z),
        material: color,
        heightReference: HeightReference.NONE,
        outline: true,
        outlineColor: Color.BLACK,
    };
    if (hullSplit) {
        ensureArmoredUpperHullPrismGraphics(ent, u, viewer, color, hullSplit);
    }

    if (u.name) {
        const lift = u.labelOffsetPxY ?? -14;
        ent.label = makeSideLabel(u.name, HeightReference.NONE, "left", lift);
        if (ent.label) {
            ent.label.fillColor = Cesium.Color.BLACK;
            ent.label.outlineColor = Cesium.Color.WHITE;
            ent.label.outlineWidth = 3;
            ent.label.style = Cesium.LabelStyle.FILL_AND_OUTLINE;
            ent.label.font = "bold 14px 'Segoe UI', sans-serif";
            ent.label.pixelOffset = new Cesium.Cartesian2(0, lift);
            applyGroundPrimitiveLabelOffset(ent.label);
            ent.label.showBackground = false;
        }
    } else {
        ent.label = undefined;
    }

    ent.point = undefined as any;
    ent.billboard = undefined as any;
    safelyDisableEntityCylinder(ent);
    ent.polygon = undefined as any;

    if (viewer) {
        const turretId = tankTurretEntityId(u.id);
        const barrelId = tankBarrelEntityId(u.id);
        const turret = viewer.entities.getById(turretId) ?? viewer.entities.add({ id: turretId });
        const barrel = viewer.entities.getById(barrelId) ?? viewer.entities.add({ id: barrelId });

        turret.position = new Cesium.CallbackProperty((time) => {
            try {
                return offsetFromEntityLocal(ent, time, 0, turretNorthOffset, turretUpOffset);
            } catch {
                return undefined;
            }
        }, false) as any;
        turret.orientation = ent.orientation;
        turret.box = new Cesium.BoxGraphics({
            dimensions: new Cartesian3(
                tankProfile.turretSize.x,
                tankProfile.turretSize.y,
                tankProfile.turretSize.z,
            ),
            material: color,
            heightReference: HeightReference.NONE,
            outline: true,
            outlineColor: Color.BLACK.withAlpha(0.85),
        });
        turret.billboard = undefined as any;
        turret.point = undefined as any;
        safelyDisableEntityCylinder(turret);
        safelyDisableEntityPolyline(turret);
        turret.polygon = undefined as any;
        turret.label = undefined as any;
        tagEntityWithUnitId(turret as any, u.id);
        turret.show = ent.show !== false;

        barrel.position = new Cesium.CallbackProperty((time) => {
            try {
                return offsetFromEntityLocal(
                    turret,
                    time,
                    0,
                    tankProfile.barrelForwardFromTurret,
                    tankProfile.barrelUpFromTurret,
                );
            } catch {
                return undefined;
            }
        }, false) as any;
        barrel.orientation = new Cesium.CallbackProperty((time) => {
            try {
                return orientationFromEntityLocalHpr(
                    turret,
                    time,
                    Cesium.Math.toRadians(90),
                    Cesium.Math.toRadians(90),
                    0,
                );
            } catch {
                return undefined;
            }
        }, false) as any;
        safelyDisableEntityBox(barrel);
        barrel.cylinder = new Cesium.CylinderGraphics({
            length: tankProfile.barrelLength,
            topRadius: tankProfile.barrelRadius,
            bottomRadius: tankProfile.barrelRadius,
            fill: true,
            material: color,
            outline: true,
            outlineColor: Color.BLACK.withAlpha(0.8),
            heightReference: HeightReference.NONE,
        });
        barrel.billboard = undefined as any;
        barrel.point = undefined as any;
        safelyDisableEntityPolyline(barrel);
        barrel.polygon = undefined as any;
        barrel.label = undefined as any;
        tagEntityWithUnitId(barrel as any, u.id);
        barrel.show = ent.show !== false;
    }

    applyVehicleMobilityAddons(ent, u, viewer, color, sidcForProfile);
    applyAvailability(ent, u);
}

type ArmoredHullSplit = {
    lowerHeight: number;
    upperSize: { x: number; y: number; z: number };
    upperCenterUpFromLowerCenter: number;
};

function computeArmoredHullSplit(baseSize: { x: number; y: number; z: number }): ArmoredHullSplit {
    const lowerHeight = baseSize.z * ARMORED_LOWER_HULL_VOLUME_SHARE;
    const upperX = baseSize.x * ARMORED_UPPER_HULL_WIDTH_SCALE;
    const upperY = baseSize.y * ARMORED_UPPER_HULL_LENGTH_SCALE;
    const baseUpperHeight =
        (baseSize.x * baseSize.y * baseSize.z * ARMORED_UPPER_HULL_VOLUME_SHARE) / (upperX * upperY);
    const upperHeight = baseUpperHeight * ARMORED_UPPER_HULL_HEIGHT_SCALE;
    const upperCenterUpFromLowerCenter = (lowerHeight / 2) + (upperHeight / 2);
    return {
        lowerHeight,
        upperSize: { x: upperX, y: upperY, z: upperHeight },
        upperCenterUpFromLowerCenter,
    };
}

type ArmoredUpperHullFace = "top" | "front" | "rear" | "left" | "right";

function armoredUpperHullFaceEntityId(unitId: string, face: ArmoredUpperHullFace): string {
    return `${unitId}__armored_upper_${face}`;
}

function armoredUpperHullPartIdsForUnit(unitId: string): string[] {
    return [
        armoredUpperHullFaceEntityId(unitId, "top"),
        armoredUpperHullFaceEntityId(unitId, "front"),
        armoredUpperHullFaceEntityId(unitId, "rear"),
        armoredUpperHullFaceEntityId(unitId, "left"),
        armoredUpperHullFaceEntityId(unitId, "right"),
    ];
}

function ensureArmoredUpperHullPrismGraphics(
    ent: Cesium.Entity,
    u: UnitRenderable,
    viewer: Cesium.Viewer | undefined,
    color: Cesium.Color,
    split: ArmoredHullSplit,
) {
    if (!viewer) return;
    try { viewer.entities.removeById(`${u.id}__armored_upper_hull`); } catch { /* ignore legacy id */ }

    const ids = armoredUpperHullPartIdsForUnit(u.id);
    const topEnt = viewer.entities.getById(ids[0]) ?? viewer.entities.add({ id: ids[0] });
    const frontEnt = viewer.entities.getById(ids[1]) ?? viewer.entities.add({ id: ids[1] });
    const rearEnt = viewer.entities.getById(ids[2]) ?? viewer.entities.add({ id: ids[2] });
    const leftEnt = viewer.entities.getById(ids[3]) ?? viewer.entities.add({ id: ids[3] });
    const rightEnt = viewer.entities.getById(ids[4]) ?? viewer.entities.add({ id: ids[4] });
    const all = [topEnt, frontEnt, rearEnt, leftEnt, rightEnt];

    const halfBottomX = (split.upperSize.x / ARMORED_UPPER_HULL_WIDTH_SCALE) / 2;
    const halfBottomY = (split.upperSize.y / ARMORED_UPPER_HULL_LENGTH_SCALE) / 2;
    const halfTopX = split.upperSize.x / 2;
    const halfTopY = split.upperSize.y / 2;
    const zBottom = split.upperCenterUpFromLowerCenter - (split.upperSize.z / 2);
    const zTop = split.upperCenterUpFromLowerCenter + (split.upperSize.z / 2);

    const makeCorner = (
        base: Cartesian3,
        time: Cesium.JulianDate,
        east: number,
        north: number,
        up: number,
    ) => offsetFromCenterOriented(
        base,
        ent.orientation?.getValue?.(time) as Cesium.Quaternion | undefined,
        east,
        north,
        up,
    );

    const makeFaces = (time: Cesium.JulianDate) => {
        const base = ent.position?.getValue?.(time);
        if (!base) return undefined;
        const bFL = makeCorner(base, time, -halfBottomX, halfBottomY, zBottom);
        const bFR = makeCorner(base, time, halfBottomX, halfBottomY, zBottom);
        const bRR = makeCorner(base, time, halfBottomX, -halfBottomY, zBottom);
        const bRL = makeCorner(base, time, -halfBottomX, -halfBottomY, zBottom);
        const tFL = makeCorner(base, time, -halfTopX, halfTopY, zTop);
        const tFR = makeCorner(base, time, halfTopX, halfTopY, zTop);
        const tRR = makeCorner(base, time, halfTopX, -halfTopY, zTop);
        const tRL = makeCorner(base, time, -halfTopX, -halfTopY, zTop);
        return {
            top: [tFL, tFR, tRR, tRL],
            front: [bFL, bFR, tFR, tFL],
            rear: [bRL, bRR, tRR, tRL],
            left: [bRL, bFL, tFL, tRL],
            right: [bFR, bRR, tRR, tFR],
        };
    };

    const makeHierarchy = (face: ArmoredUpperHullFace) => new Cesium.CallbackProperty((time) => {
        try {
            const faces = makeFaces(time);
            const points = faces?.[face];
            if (!points || points.length < 3) return undefined;
            return new Cesium.PolygonHierarchy(points);
        } catch {
            return undefined;
        }
    }, false) as any;

    const makePoly = (face: ArmoredUpperHullFace) => new Cesium.PolygonGraphics({
        hierarchy: makeHierarchy(face),
        perPositionHeight: true,
        material: color,
        outline: true,
        outlineColor: Color.BLACK.withAlpha(0.82),
        arcType: Cesium.ArcType.NONE,
    });

    topEnt.polygon = makePoly("top");
    frontEnt.polygon = makePoly("front");
    rearEnt.polygon = makePoly("rear");
    leftEnt.polygon = makePoly("left");
    rightEnt.polygon = makePoly("right");

    for (const faceEnt of all) {
        faceEnt.orientation = undefined;
        faceEnt.billboard = undefined as any;
        faceEnt.point = undefined as any;
        safelyDisableEntityBox(faceEnt);
        safelyDisableEntityCylinder(faceEnt);
        safelyDisableEntityPolyline(faceEnt);
        faceEnt.label = undefined as any;
        tagEntityWithUnitId(faceEnt as any, u.id);
        faceEnt.show = ent.show !== false;
    }
}

function applyVehicleArmoredTurretGraphics(ent: Cesium.Entity, u: UnitRenderable, viewer?: Cesium.Viewer) {
    const armoredPartIds = armoredPartIdsForUnit(u.id);
    const armoredHullPartIds = armoredHullPartIdsForUnit(u.id);
    const mobilityPartIds = vehicleMobilityPartIdsForSidc(u.id, mobilitySidcForUnit(u, viewer));
    clearGroundOverrideArtifacts(viewer, u, {
        removeSidcCap: true,
        preserveEntityIds: [...armoredPartIds, ...armoredHullPartIds, ...mobilityPartIds],
    });
    clearGroundOverrideEntityGraphics(ent);

    const hullSize = resolveVehicleHullSizeForSidc(mobilitySidcForUnit(u, viewer));
    const fillCss = extractGroupFill(u) ?? u.symbolOptions?.fillColor;
    const color = safeCssColor(fillCss).withAlpha(1.0);
    const hullSplit = computeArmoredHullSplit(hullSize);
    const turretUpOffset =
        hullSplit.upperCenterUpFromLowerCenter + (hullSplit.upperSize.z / 2) + (ARMORED_TURRET_SIZE_METERS.z / 2) + 0.06;
    const centerOffset = hullSplit.lowerHeight / 2;
    const pose = makeGroundPrimitivePoseProperties(viewer, u, centerOffset, {
        halfWidthMeters: hullSize.x / 2,
        halfLengthMeters: hullSize.y / 2,
    });
    ent.position = pose.position as any;
    ent.orientation = pose.orientation as any;
    applyPathGraphics(ent, u);

    ent.box = {
        dimensions: new Cartesian3(hullSize.x, hullSize.y, hullSplit.lowerHeight),
        material: color,
        heightReference: HeightReference.NONE,
        outline: true,
        outlineColor: Color.BLACK,
    };

    ent.label = u.name ? makeSideLabel(u.name, HeightReference.NONE, "left", u.labelOffsetPxY ?? -12) : undefined;
    applyGroundPrimitiveLabelOffset(ent.label);
    ent.point = undefined as any;
    ent.billboard = undefined as any;
    safelyDisableEntityCylinder(ent);
    ent.polygon = undefined as any;
    ensureArmoredUpperHullPrismGraphics(ent, u, viewer, color, hullSplit);

    if (viewer) {
        const turretId = armoredTurretEntityId(u.id);
        const barrelId = armoredBarrelEntityId(u.id);
        const turret = viewer.entities.getById(turretId) ?? viewer.entities.add({ id: turretId });
        const barrel = viewer.entities.getById(barrelId) ?? viewer.entities.add({ id: barrelId });

        turret.position = new Cesium.CallbackProperty((time) => {
            try {
                return offsetFromEntityLocal(ent, time, 0, 0, turretUpOffset);
            } catch {
                return undefined;
            }
        }, false) as any;
        turret.orientation = ent.orientation;
        turret.box = new Cesium.BoxGraphics({
            dimensions: new Cartesian3(
                ARMORED_TURRET_SIZE_METERS.x,
                ARMORED_TURRET_SIZE_METERS.y,
                ARMORED_TURRET_SIZE_METERS.z,
            ),
            material: color,
            heightReference: HeightReference.NONE,
            outline: true,
            outlineColor: Color.BLACK.withAlpha(0.85),
        });
        turret.billboard = undefined as any;
        turret.point = undefined as any;
        safelyDisableEntityCylinder(turret);
        safelyDisableEntityPolyline(turret);
        turret.polygon = undefined as any;
        turret.label = undefined as any;
        tagEntityWithUnitId(turret as any, u.id);
        turret.show = ent.show !== false;

        barrel.position = new Cesium.CallbackProperty((time) => {
            try {
                return offsetFromEntityLocal(
                    turret,
                    time,
                    0,
                    ARMORED_BARREL_FORWARD_FROM_TURRET_M,
                    ARMORED_BARREL_UP_FROM_TURRET_M,
                );
            } catch {
                return undefined;
            }
        }, false) as any;
        barrel.orientation = new Cesium.CallbackProperty((time) => {
            try {
                return orientationFromEntityLocalHpr(
                    turret,
                    time,
                    Cesium.Math.toRadians(90),
                    Cesium.Math.toRadians(90),
                    0,
                );
            } catch {
                return undefined;
            }
        }, false) as any;
        safelyDisableEntityBox(barrel);
        barrel.cylinder = new Cesium.CylinderGraphics({
            length: ARMORED_BARREL_LENGTH_M,
            topRadius: ARMORED_BARREL_RADIUS_M,
            bottomRadius: ARMORED_BARREL_RADIUS_M,
            fill: true,
            material: color,
            outline: true,
            outlineColor: Color.BLACK.withAlpha(0.8),
            heightReference: HeightReference.NONE,
        });
        barrel.billboard = undefined as any;
        barrel.point = undefined as any;
        safelyDisableEntityPolyline(barrel);
        barrel.polygon = undefined as any;
        barrel.label = undefined as any;
        tagEntityWithUnitId(barrel as any, u.id);
        barrel.show = ent.show !== false;
    }

    applyVehicleMobilityAddons(ent, u, viewer, color);
    applyAvailability(ent, u);
}

function applyVehicleIfvTurretGraphics(ent: Cesium.Entity, u: UnitRenderable, viewer?: Cesium.Viewer) {
    const ifvPartIds = ifvPartIdsForUnit(u.id);
    const armoredHullPartIds = armoredHullPartIdsForUnit(u.id);
    const mobilityPartIds = vehicleMobilityPartIdsForSidc(u.id, mobilitySidcForUnit(u, viewer));
    clearGroundOverrideArtifacts(viewer, u, {
        removeSidcCap: true,
        preserveEntityIds: [...ifvPartIds, ...armoredHullPartIds, ...mobilityPartIds],
    });
    clearGroundOverrideEntityGraphics(ent);

    const hullSize = resolveVehicleHullSizeForSidc(mobilitySidcForUnit(u, viewer));
    const fillCss = extractGroupFill(u) ?? u.symbolOptions?.fillColor;
    const color = safeCssColor(fillCss).withAlpha(1.0);
    const hullSplit = computeArmoredHullSplit(hullSize);
    const turretUpOffset =
        hullSplit.upperCenterUpFromLowerCenter + (hullSplit.upperSize.z / 2) + (IFV_TURRET_SIZE_METERS.z / 2) + 0.05;
    const centerOffset = hullSplit.lowerHeight / 2;
    const pose = makeGroundPrimitivePoseProperties(viewer, u, centerOffset, {
        halfWidthMeters: hullSize.x / 2,
        halfLengthMeters: hullSize.y / 2,
    });
    ent.position = pose.position as any;
    ent.orientation = pose.orientation as any;
    applyPathGraphics(ent, u);

    ent.box = {
        dimensions: new Cartesian3(hullSize.x, hullSize.y, hullSplit.lowerHeight),
        material: color,
        heightReference: HeightReference.NONE,
        outline: true,
        outlineColor: Color.BLACK,
    };

    ent.label = u.name ? makeSideLabel(u.name, HeightReference.NONE, "left", u.labelOffsetPxY ?? -12) : undefined;
    applyGroundPrimitiveLabelOffset(ent.label);
    ent.point = undefined as any;
    ent.billboard = undefined as any;
    safelyDisableEntityCylinder(ent);
    ent.polygon = undefined as any;
    ensureArmoredUpperHullPrismGraphics(ent, u, viewer, color, hullSplit);

    if (viewer) {
        const turretId = ifvTurretEntityId(u.id);
        const barrelId = ifvBarrelEntityId(u.id);
        const turret = viewer.entities.getById(turretId) ?? viewer.entities.add({ id: turretId });
        const barrel = viewer.entities.getById(barrelId) ?? viewer.entities.add({ id: barrelId });

        turret.position = new Cesium.CallbackProperty((time) => {
            try {
                return offsetFromEntityLocal(ent, time, 0, 0, turretUpOffset);
            } catch {
                return undefined;
            }
        }, false) as any;
        turret.orientation = ent.orientation;
        turret.box = new Cesium.BoxGraphics({
            dimensions: new Cartesian3(
                IFV_TURRET_SIZE_METERS.x,
                IFV_TURRET_SIZE_METERS.y,
                IFV_TURRET_SIZE_METERS.z,
            ),
            material: color,
            heightReference: HeightReference.NONE,
            outline: true,
            outlineColor: Color.BLACK.withAlpha(0.85),
        });
        turret.billboard = undefined as any;
        turret.point = undefined as any;
        safelyDisableEntityCylinder(turret);
        safelyDisableEntityPolyline(turret);
        turret.polygon = undefined as any;
        turret.label = undefined as any;
        tagEntityWithUnitId(turret as any, u.id);
        turret.show = ent.show !== false;

        barrel.position = new Cesium.CallbackProperty((time) => {
            try {
                return offsetFromEntityLocal(
                    turret,
                    time,
                    0,
                    IFV_BARREL_FORWARD_FROM_TURRET_M,
                    IFV_BARREL_UP_FROM_TURRET_M,
                );
            } catch {
                return undefined;
            }
        }, false) as any;
        barrel.orientation = new Cesium.CallbackProperty((time) => {
            try {
                return orientationFromEntityLocalHpr(
                    turret,
                    time,
                    Cesium.Math.toRadians(90),
                    Cesium.Math.toRadians(90),
                    0,
                );
            } catch {
                return undefined;
            }
        }, false) as any;
        safelyDisableEntityBox(barrel);
        barrel.cylinder = new Cesium.CylinderGraphics({
            length: IFV_BARREL_LENGTH_M,
            topRadius: IFV_BARREL_RADIUS_M,
            bottomRadius: IFV_BARREL_RADIUS_M,
            fill: true,
            material: color,
            outline: true,
            outlineColor: Color.BLACK.withAlpha(0.8),
            heightReference: HeightReference.NONE,
        });
        barrel.billboard = undefined as any;
        barrel.point = undefined as any;
        safelyDisableEntityPolyline(barrel);
        barrel.polygon = undefined as any;
        barrel.label = undefined as any;
        tagEntityWithUnitId(barrel as any, u.id);
        barrel.show = ent.show !== false;
    }

    applyVehicleMobilityAddons(ent, u, viewer, color);
    applyAvailability(ent, u);
}

function applyVehicleRecoveryBoomGraphics(ent: Cesium.Entity, u: UnitRenderable, viewer?: Cesium.Viewer) {
    const recoveryPartIds = recoveryPartIdsForUnit(u.id);
    const sidcForProfile = mobilitySidcForUnit(u, viewer);
    const useArmoredSplitHull = shouldUseArmoredSplitHullForSidc(sidcForProfile);
    const armoredHullPartIds = useArmoredSplitHull ? armoredHullPartIdsForUnit(u.id) : [];
    const mobilityPartIds = vehicleMobilityPartIdsForSidc(u.id, sidcForProfile);
    clearGroundOverrideArtifacts(viewer, u, {
        removeSidcCap: true,
        preserveEntityIds: [...recoveryPartIds, ...armoredHullPartIds, ...mobilityPartIds],
    });
    clearGroundOverrideEntityGraphics(ent);

    const hullSize = resolveVehicleHullSizeForSidc(sidcForProfile);
    const fillCss = extractGroupFill(u) ?? u.symbolOptions?.fillColor;
    const color = safeCssColor(fillCss).withAlpha(1.0);
    const hullSplit = useArmoredSplitHull ? computeArmoredHullSplit(hullSize) : undefined;
    const hullTopUp = hullTopUpOffsetFromCenter(hullSize, hullSplit);
    const recoveryBoomUpOffset = RECOVERY_BOOM_UP_OFFSET_M + (hullTopUp - (VEHICLE_BLOCK_SIZE_METERS.z / 2));
    const centerOffset = hullSplit ? (hullSplit.lowerHeight / 2) : (hullSize.z / 2);
    const pose = makeGroundPrimitivePoseProperties(viewer, u, centerOffset, {
        halfWidthMeters: hullSize.x / 2,
        halfLengthMeters: hullSize.y / 2,
    });
    ent.position = pose.position as any;
    ent.orientation = pose.orientation as any;
    applyPathGraphics(ent, u);

    ent.box = {
        dimensions: new Cartesian3(hullSize.x, hullSize.y, hullSplit ? hullSplit.lowerHeight : hullSize.z),
        material: color,
        heightReference: HeightReference.NONE,
        outline: true,
        outlineColor: Color.BLACK,
    };
    if (hullSplit) {
        ensureArmoredUpperHullPrismGraphics(ent, u, viewer, color, hullSplit);
    }
    ent.label = u.name ? makeSideLabel(u.name, HeightReference.NONE, "left", u.labelOffsetPxY ?? -12) : undefined;
    applyGroundPrimitiveLabelOffset(ent.label);

    ent.point = undefined as any;
    ent.billboard = undefined as any;
    safelyDisableEntityCylinder(ent);
    ent.polygon = undefined as any;

    if (viewer) {
        const boomId = recoveryBoomEntityId(u.id);
        const boom = viewer.entities.getById(boomId) ?? viewer.entities.add({ id: boomId });
        boom.position = new Cesium.CallbackProperty((time) => {
            try {
                return offsetFromEntityLocal(ent, time, 0, RECOVERY_BOOM_NORTH_OFFSET_M, recoveryBoomUpOffset);
            } catch {
                return undefined;
            }
        }, false) as any;
        boom.orientation = new Cesium.CallbackProperty((time) => {
            try {
                const p = boom.position?.getValue?.(time);
                if (!p) return undefined;
                // Forward and upward angled recovery boom.
                return Cesium.Transforms.headingPitchRollQuaternion(
                    p,
                    new Cesium.HeadingPitchRoll(
                        Cesium.Math.toRadians(90),
                        Cesium.Math.toRadians(55),
                        0,
                    ),
                );
            } catch {
                return undefined;
            }
        }, false) as any;
        safelyDisableEntityBox(boom);
        boom.cylinder = new Cesium.CylinderGraphics({
            length: RECOVERY_BOOM_LENGTH_M,
            topRadius: RECOVERY_BOOM_RADIUS_M,
            bottomRadius: RECOVERY_BOOM_RADIUS_M,
            fill: true,
            material: color,
            outline: true,
            outlineColor: Color.BLACK.withAlpha(0.8),
            heightReference: HeightReference.NONE,
        });
        boom.billboard = undefined as any;
        boom.point = undefined as any;
        safelyDisableEntityPolyline(boom);
        boom.polygon = undefined as any;
        boom.label = undefined as any;
        tagEntityWithUnitId(boom as any, u.id);
        boom.show = ent.show !== false;
    }

    applyVehicleMobilityAddons(ent, u, viewer, color, sidcForProfile);
    applyAvailability(ent, u);
}

function applyVehicleApcModuleGraphics(ent: Cesium.Entity, u: UnitRenderable, viewer?: Cesium.Viewer) {
    const apcPartIds = apcPartIdsForUnit(u.id);
    const armoredHullPartIds = armoredHullPartIdsForUnit(u.id);
    const mobilityPartIds = vehicleMobilityPartIdsForSidc(u.id, mobilitySidcForUnit(u, viewer));
    clearGroundOverrideArtifacts(viewer, u, {
        removeSidcCap: true,
        preserveEntityIds: [...apcPartIds, ...armoredHullPartIds, ...mobilityPartIds],
    });
    clearGroundOverrideEntityGraphics(ent);

    const hullSize = resolveVehicleHullSizeForSidc(mobilitySidcForUnit(u, viewer));
    const fillCss = extractGroupFill(u) ?? u.symbolOptions?.fillColor;
    const color = safeCssColor(fillCss).withAlpha(1.0);
    const hullSplit = computeArmoredHullSplit(hullSize);
    const hullTopUp = hullTopUpOffsetFromCenter(hullSize, hullSplit);
    const apcModuleUpOffset = APC_MODULE_UP_OFFSET_M + (hullTopUp - (VEHICLE_BLOCK_SIZE_METERS.z / 2));
    const centerOffset = hullSplit.lowerHeight / 2;
    const pose = makeGroundPrimitivePoseProperties(viewer, u, centerOffset, {
        halfWidthMeters: hullSize.x / 2,
        halfLengthMeters: hullSize.y / 2,
    });
    ent.position = pose.position as any;
    ent.orientation = pose.orientation as any;
    applyPathGraphics(ent, u);

    ent.box = {
        dimensions: new Cartesian3(hullSize.x, hullSize.y, hullSplit.lowerHeight),
        material: color,
        heightReference: HeightReference.NONE,
        outline: true,
        outlineColor: Color.BLACK,
    };
    ent.label = u.name ? makeSideLabel(u.name, HeightReference.NONE, "left", u.labelOffsetPxY ?? -12) : undefined;
    applyGroundPrimitiveLabelOffset(ent.label);

    ent.point = undefined as any;
    ent.billboard = undefined as any;
    safelyDisableEntityCylinder(ent);
    ent.polygon = undefined as any;
    ensureArmoredUpperHullPrismGraphics(ent, u, viewer, color, hullSplit);

    if (viewer) {
        const moduleId = apcModuleEntityId(u.id);
        const moduleEnt = viewer.entities.getById(moduleId) ?? viewer.entities.add({ id: moduleId });

        moduleEnt.position = new Cesium.CallbackProperty((time) => {
            try {
                return offsetFromEntityLocal(ent, time, 0, APC_MODULE_NORTH_OFFSET_M, apcModuleUpOffset);
            } catch {
                return undefined;
            }
        }, false) as any;
        moduleEnt.orientation = ent.orientation;
        moduleEnt.box = new Cesium.BoxGraphics({
            dimensions: new Cartesian3(
                APC_MODULE_SIZE_METERS.x,
                APC_MODULE_SIZE_METERS.y,
                APC_MODULE_SIZE_METERS.z,
            ),
            material: color,
            heightReference: HeightReference.NONE,
            outline: true,
            outlineColor: Color.BLACK.withAlpha(0.85),
        });
        moduleEnt.billboard = undefined as any;
        moduleEnt.point = undefined as any;
        safelyDisableEntityCylinder(moduleEnt);
        safelyDisableEntityPolyline(moduleEnt);
        moduleEnt.polygon = undefined as any;
        moduleEnt.label = undefined as any;
        tagEntityWithUnitId(moduleEnt as any, u.id);
        moduleEnt.show = ent.show !== false;
    }

    applyVehicleMobilityAddons(ent, u, viewer, color);
    applyAvailability(ent, u);
}

function applyVehicleApcAmbulanceGraphics(ent: Cesium.Entity, u: UnitRenderable, viewer?: Cesium.Viewer) {
    const parts = apcAmbulancePartIdsForUnit(u.id);
    const armoredHullPartIds = armoredHullPartIdsForUnit(u.id);
    const mobilityPartIds = vehicleMobilityPartIdsForSidc(u.id, mobilitySidcForUnit(u, viewer));
    clearGroundOverrideArtifacts(viewer, u, {
        removeSidcCap: true,
        preserveEntityIds: [...parts, ...armoredHullPartIds, ...mobilityPartIds],
    });
    clearGroundOverrideEntityGraphics(ent);

    const hullSize = resolveVehicleHullSizeForSidc(mobilitySidcForUnit(u, viewer));
    const fillCss = extractGroupFill(u) ?? u.symbolOptions?.fillColor;
    const color = safeCssColor(fillCss).withAlpha(1.0);
    const hullSplit = computeArmoredHullSplit(hullSize);
    const hullTopUp = hullTopUpOffsetFromCenter(hullSize, hullSplit);
    const apcMedModuleUpOffset = APC_MED_MODULE_UP_OFFSET_M + (hullTopUp - (VEHICLE_BLOCK_SIZE_METERS.z / 2));
    const centerOffset = hullSplit.lowerHeight / 2;
    const pose = makeGroundPrimitivePoseProperties(viewer, u, centerOffset, {
        halfWidthMeters: hullSize.x / 2,
        halfLengthMeters: hullSize.y / 2,
    });
    ent.position = pose.position as any;
    ent.orientation = pose.orientation as any;
    applyPathGraphics(ent, u);
    ent.box = {
        dimensions: new Cartesian3(hullSize.x, hullSize.y, hullSplit.lowerHeight),
        material: color,
        heightReference: HeightReference.NONE,
        outline: true,
        outlineColor: Color.BLACK,
    };
    ent.label = u.name ? makeSideLabel(u.name, HeightReference.NONE, "left", u.labelOffsetPxY ?? -12) : undefined;
    applyGroundPrimitiveLabelOffset(ent.label);
    ent.point = undefined as any;
    ent.billboard = undefined as any;
    safelyDisableEntityCylinder(ent);
    ent.polygon = undefined as any;
    ensureArmoredUpperHullPrismGraphics(ent, u, viewer, color, hullSplit);

    if (viewer) {
        const moduleId = apcAmbulanceModuleEntityId(u.id);
        const podId = apcAmbulancePodEntityId(u.id);
        const moduleEnt = viewer.entities.getById(moduleId) ?? viewer.entities.add({ id: moduleId });
        const podEnt = viewer.entities.getById(podId) ?? viewer.entities.add({ id: podId });

        moduleEnt.position = new Cesium.CallbackProperty((time) => {
            try {
                return offsetFromEntityLocal(ent, time, 0, APC_MODULE_NORTH_OFFSET_M, apcMedModuleUpOffset);
            } catch {
                return undefined;
            }
        }, false) as any;
        moduleEnt.orientation = ent.orientation;
        moduleEnt.box = new Cesium.BoxGraphics({
            dimensions: new Cartesian3(
                APC_MODULE_SIZE_METERS.x,
                APC_MODULE_SIZE_METERS.y,
                APC_MODULE_SIZE_METERS.z,
            ),
            material: color,
            heightReference: HeightReference.NONE,
            outline: true,
            outlineColor: Color.BLACK.withAlpha(0.85),
        });
        moduleEnt.billboard = undefined as any;
        moduleEnt.point = undefined as any;
        safelyDisableEntityCylinder(moduleEnt);
        safelyDisableEntityPolyline(moduleEnt);
        moduleEnt.polygon = undefined as any;
        moduleEnt.label = undefined as any;
        tagEntityWithUnitId(moduleEnt as any, u.id);
        moduleEnt.show = ent.show !== false;

        podEnt.position = new Cesium.CallbackProperty((time) => {
            try {
                return offsetFromEntityLocal(moduleEnt, time, 0, 0, APC_MED_POD_UP_FROM_MODULE_M);
            } catch {
                return undefined;
            }
        }, false) as any;
        podEnt.orientation = moduleEnt.orientation;
        podEnt.box = new Cesium.BoxGraphics({
            dimensions: new Cartesian3(
                APC_MED_POD_SIZE_METERS.x,
                APC_MED_POD_SIZE_METERS.y,
                APC_MED_POD_SIZE_METERS.z,
            ),
            material: color.withAlpha(0.94),
            heightReference: HeightReference.NONE,
            outline: true,
            outlineColor: Color.BLACK.withAlpha(0.8),
        });
        podEnt.billboard = undefined as any;
        podEnt.point = undefined as any;
        safelyDisableEntityCylinder(podEnt);
        safelyDisableEntityPolyline(podEnt);
        podEnt.polygon = undefined as any;
        podEnt.label = undefined as any;
        tagEntityWithUnitId(podEnt as any, u.id);
        podEnt.show = ent.show !== false;
    }

    applyVehicleMobilityAddons(ent, u, viewer, color);
    applyAvailability(ent, u);
}

function applyVehicleReconMastGraphics(ent: Cesium.Entity, u: UnitRenderable, viewer?: Cesium.Viewer) {
    const parts = reconPartIdsForUnit(u.id);
    const armoredHullPartIds = armoredHullPartIdsForUnit(u.id);
    const mobilityPartIds = vehicleMobilityPartIdsForSidc(u.id, mobilitySidcForUnit(u, viewer));
    clearGroundOverrideArtifacts(viewer, u, {
        removeSidcCap: true,
        preserveEntityIds: [...parts, ...armoredHullPartIds, ...mobilityPartIds],
    });
    clearGroundOverrideEntityGraphics(ent);

    const hullSize = resolveVehicleHullSizeForSidc(mobilitySidcForUnit(u, viewer));
    const fillCss = extractGroupFill(u) ?? u.symbolOptions?.fillColor;
    const color = safeCssColor(fillCss).withAlpha(1.0);
    const hullSplit = computeArmoredHullSplit(hullSize);
    const hullTopUp = hullTopUpOffsetFromCenter(hullSize, hullSplit);
    const reconMastBaseUpOffset = RECON_MAST_BASE_UP_OFFSET_M + (hullTopUp - (VEHICLE_BLOCK_SIZE_METERS.z / 2));
    const centerOffset = hullSplit.lowerHeight / 2;
    const pose = makeGroundPrimitivePoseProperties(viewer, u, centerOffset, {
        halfWidthMeters: hullSize.x / 2,
        halfLengthMeters: hullSize.y / 2,
    });
    ent.position = pose.position as any;
    ent.orientation = pose.orientation as any;
    applyPathGraphics(ent, u);
    ent.box = {
        dimensions: new Cartesian3(hullSize.x, hullSize.y, hullSplit.lowerHeight),
        material: color,
        heightReference: HeightReference.NONE,
        outline: true,
        outlineColor: Color.BLACK,
    };
    ent.label = u.name ? makeSideLabel(u.name, HeightReference.NONE, "left", u.labelOffsetPxY ?? -12) : undefined;
    applyGroundPrimitiveLabelOffset(ent.label);
    ent.point = undefined as any;
    ent.billboard = undefined as any;
    safelyDisableEntityCylinder(ent);
    ent.polygon = undefined as any;
    ensureArmoredUpperHullPrismGraphics(ent, u, viewer, color, hullSplit);

    if (viewer) {
        const mastId = reconMastEntityId(u.id);
        const mast = viewer.entities.getById(mastId) ?? viewer.entities.add({ id: mastId });
        mast.position = new Cesium.CallbackProperty((time) => {
            try {
                return offsetFromEntityLocal(ent, time, 0, RECON_MAST_NORTH_OFFSET_M, reconMastBaseUpOffset);
            } catch {
                return undefined;
            }
        }, false) as any;
        mast.orientation = ent.orientation;
        safelyDisableEntityBox(mast);
        mast.cylinder = new Cesium.CylinderGraphics({
            length: RECON_MAST_LENGTH_M,
            topRadius: RECON_MAST_RADIUS_M,
            bottomRadius: RECON_MAST_RADIUS_M,
            fill: true,
            material: color,
            outline: true,
            outlineColor: Color.BLACK.withAlpha(0.82),
            heightReference: HeightReference.NONE,
        });
        mast.billboard = undefined as any;
        mast.point = undefined as any;
        safelyDisableEntityPolyline(mast);
        mast.polygon = undefined as any;
        mast.label = undefined as any;
        tagEntityWithUnitId(mast as any, u.id);
        mast.show = ent.show !== false;
    }

    applyVehicleMobilityAddons(ent, u, viewer, color);
    applyAvailability(ent, u);
}

function applyVehicleCargoModuleGraphics(ent: Cesium.Entity, u: UnitRenderable, viewer?: Cesium.Viewer) {
    const parts = cargoPartIdsForUnit(u.id);
    const armoredHullPartIds = armoredHullPartIdsForUnit(u.id);
    const mobilityPartIds = vehicleMobilityPartIdsForSidc(u.id, mobilitySidcForUnit(u, viewer));
    clearGroundOverrideArtifacts(viewer, u, {
        removeSidcCap: true,
        preserveEntityIds: [...parts, ...armoredHullPartIds, ...mobilityPartIds],
    });
    clearGroundOverrideEntityGraphics(ent);

    const hullSize = resolveVehicleHullSizeForSidc(mobilitySidcForUnit(u, viewer));
    const fillCss = extractGroupFill(u) ?? u.symbolOptions?.fillColor;
    const color = safeCssColor(fillCss).withAlpha(1.0);
    const hullSplit = computeArmoredHullSplit(hullSize);
    const hullTopUp = hullTopUpOffsetFromCenter(hullSize, hullSplit);
    const cargoModuleUpOffset = CARGO_MODULE_UP_OFFSET_M + (hullTopUp - (VEHICLE_BLOCK_SIZE_METERS.z / 2));
    const centerOffset = hullSplit.lowerHeight / 2;
    const pose = makeGroundPrimitivePoseProperties(viewer, u, centerOffset, {
        halfWidthMeters: hullSize.x / 2,
        halfLengthMeters: hullSize.y / 2,
    });
    ent.position = pose.position as any;
    ent.orientation = pose.orientation as any;
    applyPathGraphics(ent, u);
    ent.box = {
        dimensions: new Cartesian3(hullSize.x, hullSize.y, hullSplit.lowerHeight),
        material: color,
        heightReference: HeightReference.NONE,
        outline: true,
        outlineColor: Color.BLACK,
    };
    ent.label = u.name ? makeSideLabel(u.name, HeightReference.NONE, "left", u.labelOffsetPxY ?? -12) : undefined;
    applyGroundPrimitiveLabelOffset(ent.label);
    ent.point = undefined as any;
    ent.billboard = undefined as any;
    safelyDisableEntityCylinder(ent);
    ent.polygon = undefined as any;
    ensureArmoredUpperHullPrismGraphics(ent, u, viewer, color, hullSplit);

    if (viewer) {
        const moduleId = cargoModuleEntityId(u.id);
        const moduleEnt = viewer.entities.getById(moduleId) ?? viewer.entities.add({ id: moduleId });
        moduleEnt.position = new Cesium.CallbackProperty((time) => {
            try {
                return offsetFromEntityLocal(ent, time, 0, CARGO_MODULE_NORTH_OFFSET_M, cargoModuleUpOffset);
            } catch {
                return undefined;
            }
        }, false) as any;
        moduleEnt.orientation = ent.orientation;
        moduleEnt.box = new Cesium.BoxGraphics({
            dimensions: new Cartesian3(
                CARGO_MODULE_SIZE_METERS.x,
                CARGO_MODULE_SIZE_METERS.y,
                CARGO_MODULE_SIZE_METERS.z,
            ),
            material: color.withAlpha(0.96),
            heightReference: HeightReference.NONE,
            outline: true,
            outlineColor: Color.BLACK.withAlpha(0.84),
        });
        moduleEnt.billboard = undefined as any;
        moduleEnt.point = undefined as any;
        safelyDisableEntityCylinder(moduleEnt);
        safelyDisableEntityPolyline(moduleEnt);
        moduleEnt.polygon = undefined as any;
        moduleEnt.label = undefined as any;
        tagEntityWithUnitId(moduleEnt as any, u.id);
        moduleEnt.show = ent.show !== false;
    }

    applyVehicleMobilityAddons(ent, u, viewer, color);
    applyAvailability(ent, u);
}

function applyVehicleCommandMastGraphics(ent: Cesium.Entity, u: UnitRenderable, viewer?: Cesium.Viewer) {
    const parts = commandPartIdsForUnit(u.id);
    const armoredHullPartIds = armoredHullPartIdsForUnit(u.id);
    const mobilityPartIds = vehicleMobilityPartIdsForSidc(u.id, mobilitySidcForUnit(u, viewer));
    clearGroundOverrideArtifacts(viewer, u, {
        removeSidcCap: true,
        preserveEntityIds: [...parts, ...armoredHullPartIds, ...mobilityPartIds],
    });
    clearGroundOverrideEntityGraphics(ent);

    const hullSize = resolveVehicleHullSizeForSidc(mobilitySidcForUnit(u, viewer));
    const fillCss = extractGroupFill(u) ?? u.symbolOptions?.fillColor;
    const color = safeCssColor(fillCss).withAlpha(1.0);
    const hullSplit = computeArmoredHullSplit(hullSize);
    const hullTopUp = hullTopUpOffsetFromCenter(hullSize, hullSplit);
    const commandModuleUpOffset = COMMAND_MODULE_UP_OFFSET_M + (hullTopUp - (VEHICLE_BLOCK_SIZE_METERS.z / 2));
    const centerOffset = hullSplit.lowerHeight / 2;
    const pose = makeGroundPrimitivePoseProperties(viewer, u, centerOffset, {
        halfWidthMeters: hullSize.x / 2,
        halfLengthMeters: hullSize.y / 2,
    });
    ent.position = pose.position as any;
    ent.orientation = pose.orientation as any;
    applyPathGraphics(ent, u);
    ent.box = {
        dimensions: new Cartesian3(hullSize.x, hullSize.y, hullSplit.lowerHeight),
        material: color,
        heightReference: HeightReference.NONE,
        outline: true,
        outlineColor: Color.BLACK,
    };
    ent.label = u.name ? makeSideLabel(u.name, HeightReference.NONE, "left", u.labelOffsetPxY ?? -12) : undefined;
    applyGroundPrimitiveLabelOffset(ent.label);
    ent.point = undefined as any;
    ent.billboard = undefined as any;
    safelyDisableEntityCylinder(ent);
    ent.polygon = undefined as any;
    ensureArmoredUpperHullPrismGraphics(ent, u, viewer, color, hullSplit);

    if (viewer) {
        const moduleId = commandModuleEntityId(u.id);
        const mastId = commandMastEntityId(u.id);
        const headId = commandHeadEntityId(u.id);
        const moduleEnt = viewer.entities.getById(moduleId) ?? viewer.entities.add({ id: moduleId });
        const mastEnt = viewer.entities.getById(mastId) ?? viewer.entities.add({ id: mastId });
        const headEnt = viewer.entities.getById(headId) ?? viewer.entities.add({ id: headId });

        moduleEnt.position = new Cesium.CallbackProperty((time) => {
            try {
                return offsetFromEntityLocal(ent, time, 0, COMMAND_MODULE_NORTH_OFFSET_M, commandModuleUpOffset);
            } catch {
                return undefined;
            }
        }, false) as any;
        moduleEnt.orientation = ent.orientation;
        moduleEnt.box = new Cesium.BoxGraphics({
            dimensions: new Cartesian3(
                COMMAND_MODULE_SIZE_METERS.x,
                COMMAND_MODULE_SIZE_METERS.y,
                COMMAND_MODULE_SIZE_METERS.z,
            ),
            material: color,
            heightReference: HeightReference.NONE,
            outline: true,
            outlineColor: Color.BLACK.withAlpha(0.85),
        });
        moduleEnt.billboard = undefined as any;
        moduleEnt.point = undefined as any;
        safelyDisableEntityCylinder(moduleEnt);
        safelyDisableEntityPolyline(moduleEnt);
        moduleEnt.polygon = undefined as any;
        moduleEnt.label = undefined as any;
        tagEntityWithUnitId(moduleEnt as any, u.id);
        moduleEnt.show = ent.show !== false;

        mastEnt.position = new Cesium.CallbackProperty((time) => {
            try {
                return offsetFromEntityLocal(moduleEnt, time, 0, 0, COMMAND_MAST_UP_FROM_MODULE_M);
            } catch {
                return undefined;
            }
        }, false) as any;
        mastEnt.orientation = moduleEnt.orientation;
        safelyDisableEntityBox(mastEnt);
        mastEnt.cylinder = new Cesium.CylinderGraphics({
            length: COMMAND_MAST_LENGTH_M,
            topRadius: COMMAND_MAST_RADIUS_M,
            bottomRadius: COMMAND_MAST_RADIUS_M,
            fill: true,
            material: color,
            outline: true,
            outlineColor: Color.BLACK.withAlpha(0.82),
            heightReference: HeightReference.NONE,
        });
        mastEnt.billboard = undefined as any;
        mastEnt.point = undefined as any;
        safelyDisableEntityPolyline(mastEnt);
        mastEnt.polygon = undefined as any;
        mastEnt.label = undefined as any;
        tagEntityWithUnitId(mastEnt as any, u.id);
        mastEnt.show = ent.show !== false;

        headEnt.position = new Cesium.CallbackProperty((time) => {
            try {
                return offsetFromEntityLocal(mastEnt, time, 0, 0, COMMAND_HEAD_UP_FROM_MAST_M);
            } catch {
                return undefined;
            }
        }, false) as any;
        headEnt.orientation = mastEnt.orientation;
        headEnt.box = new Cesium.BoxGraphics({
            dimensions: new Cartesian3(
                COMMAND_HEAD_SIZE_METERS.x,
                COMMAND_HEAD_SIZE_METERS.y,
                COMMAND_HEAD_SIZE_METERS.z,
            ),
            material: color.withAlpha(0.95),
            heightReference: HeightReference.NONE,
            outline: true,
            outlineColor: Color.BLACK.withAlpha(0.82),
        });
        headEnt.billboard = undefined as any;
        headEnt.point = undefined as any;
        safelyDisableEntityCylinder(headEnt);
        safelyDisableEntityPolyline(headEnt);
        headEnt.polygon = undefined as any;
        headEnt.label = undefined as any;
        tagEntityWithUnitId(headEnt as any, u.id);
        headEnt.show = ent.show !== false;
    }

    applyVehicleMobilityAddons(ent, u, viewer, color);
    applyAvailability(ent, u);
}

function applyVehicleRecoveryRigGraphics(ent: Cesium.Entity, u: UnitRenderable, viewer?: Cesium.Viewer) {
    const parts = recoveryRigPartIdsForUnit(u.id);
    const armoredHullPartIds = armoredHullPartIdsForUnit(u.id);
    const mobilityPartIds = vehicleMobilityPartIdsForSidc(u.id, mobilitySidcForUnit(u, viewer));
    clearGroundOverrideArtifacts(viewer, u, {
        removeSidcCap: true,
        preserveEntityIds: [...parts, ...armoredHullPartIds, ...mobilityPartIds],
    });
    clearGroundOverrideEntityGraphics(ent);

    const hullSize = resolveVehicleHullSizeForSidc(mobilitySidcForUnit(u, viewer));
    const fillCss = extractGroupFill(u) ?? u.symbolOptions?.fillColor;
    const color = safeCssColor(fillCss).withAlpha(1.0);
    const hullSplit = computeArmoredHullSplit(hullSize);
    const hullTopUp = hullTopUpOffsetFromCenter(hullSize, hullSplit);
    const recoveryRigBoomUpOffset = RECOVERY_RIG_BOOM_UP_OFFSET_M + (hullTopUp - (VEHICLE_BLOCK_SIZE_METERS.z / 2));
    const centerOffset = hullSplit.lowerHeight / 2;
    const pose = makeGroundPrimitivePoseProperties(viewer, u, centerOffset, {
        halfWidthMeters: hullSize.x / 2,
        halfLengthMeters: hullSize.y / 2,
    });
    ent.position = pose.position as any;
    ent.orientation = pose.orientation as any;
    applyPathGraphics(ent, u);
    ent.box = {
        dimensions: new Cartesian3(hullSize.x, hullSize.y, hullSplit.lowerHeight),
        material: color,
        heightReference: HeightReference.NONE,
        outline: true,
        outlineColor: Color.BLACK,
    };
    ent.label = u.name ? makeSideLabel(u.name, HeightReference.NONE, "left", u.labelOffsetPxY ?? -12) : undefined;
    applyGroundPrimitiveLabelOffset(ent.label);
    ent.point = undefined as any;
    ent.billboard = undefined as any;
    safelyDisableEntityCylinder(ent);
    ent.polygon = undefined as any;
    ensureArmoredUpperHullPrismGraphics(ent, u, viewer, color, hullSplit);

    if (viewer) {
        const boomId = recoveryRigBoomEntityId(u.id);
        const hookId = recoveryRigHookEntityId(u.id);
        const boomEnt = viewer.entities.getById(boomId) ?? viewer.entities.add({ id: boomId });
        const hookEnt = viewer.entities.getById(hookId) ?? viewer.entities.add({ id: hookId });

        boomEnt.position = new Cesium.CallbackProperty((time) => {
            try {
                return offsetFromEntityLocal(ent, time, 0, RECOVERY_RIG_BOOM_NORTH_OFFSET_M, recoveryRigBoomUpOffset);
            } catch {
                return undefined;
            }
        }, false) as any;
        boomEnt.orientation = new Cesium.CallbackProperty((time) => {
            const p = boomEnt.position?.getValue?.(time);
            if (!p) return undefined;
            const pitch = Cesium.Math.toRadians(-18);
            return Transforms.headingPitchRollQuaternion(p, new HeadingPitchRoll(0, pitch, 0));
        }, false) as any;
        safelyDisableEntityBox(boomEnt);
        boomEnt.cylinder = new Cesium.CylinderGraphics({
            length: RECOVERY_RIG_BOOM_LENGTH_M,
            topRadius: RECOVERY_RIG_BOOM_RADIUS_M,
            bottomRadius: RECOVERY_RIG_BOOM_RADIUS_M,
            fill: true,
            material: color,
            outline: true,
            outlineColor: Color.BLACK.withAlpha(0.82),
            heightReference: HeightReference.NONE,
        });
        boomEnt.billboard = undefined as any;
        boomEnt.point = undefined as any;
        safelyDisableEntityPolyline(boomEnt);
        boomEnt.polygon = undefined as any;
        boomEnt.label = undefined as any;
        tagEntityWithUnitId(boomEnt as any, u.id);
        boomEnt.show = ent.show !== false;

        hookEnt.position = new Cesium.CallbackProperty((time) => {
            try {
                return offsetFromEntityLocal(
                    boomEnt,
                    time,
                    0,
                    RECOVERY_RIG_HOOK_FORWARD_FROM_BOOM_M,
                    RECOVERY_RIG_HOOK_UP_FROM_BOOM_M,
                );
            } catch {
                return undefined;
            }
        }, false) as any;
        hookEnt.orientation = boomEnt.orientation;
        hookEnt.box = new Cesium.BoxGraphics({
            dimensions: new Cartesian3(
                RECOVERY_RIG_HOOK_SIZE_METERS.x,
                RECOVERY_RIG_HOOK_SIZE_METERS.y,
                RECOVERY_RIG_HOOK_SIZE_METERS.z,
            ),
            material: color.withAlpha(0.95),
            heightReference: HeightReference.NONE,
            outline: true,
            outlineColor: Color.BLACK.withAlpha(0.82),
        });
        hookEnt.billboard = undefined as any;
        hookEnt.point = undefined as any;
        safelyDisableEntityCylinder(hookEnt);
        safelyDisableEntityPolyline(hookEnt);
        hookEnt.polygon = undefined as any;
        hookEnt.label = undefined as any;
        tagEntityWithUnitId(hookEnt as any, u.id);
        hookEnt.show = ent.show !== false;
    }

    applyVehicleMobilityAddons(ent, u, viewer, color);
    applyAvailability(ent, u);
}

/** Height reference selector matching your existing semantics. */
function unitHeightRef(u: any): HeightReference {
    const wantsClamp = u?.clampToGround !== false && u?.alt == null;
    if (wantsClamp) return HeightReference.CLAMP_TO_GROUND;
    if (u?.altIsAgl === false) return HeightReference.NONE;
    return HeightReference.RELATIVE_TO_GROUND;
}

/** Resolve the effective SIDC at the viewer’s current time (or now), with extra fallbacks. */
function effectiveSidc(u: UnitRenderable, viewer?: Cesium.Viewer): string | undefined {
    const src = (u as any).__sourceUnit ?? u;
    const tMs = currentViewerMs(viewer);

    // 1) From explicit SIDC events at/= t
    const fromEvents = lastExplicitSidcEventAtOrBefore(src, tMs);
    if (typeof fromEvents === "string" && fromEvents.trim()) return fromEvents;

    // 2) Prefer unit SIDC when there is no explicit SIDC event.
    const fromUnit = preferredUnitSidc(u);
    if (typeof fromUnit === "string" && fromUnit.trim()) return fromUnit;

    // 3) From computeSnapshot (some pipelines keep current sidc only in events logic)
    try {
        const snap = computeSnapshot(u, tMs);
        // Default: no lift unless underbar/pedestal logic sets it this tick
        if ((u as any).__iconLiftPx == null) (u as any).__iconLiftPx = 0;
        if (typeof snap?.sidc === "string" && snap.sidc.trim()) return snap.sidc;
    } catch { /* ignore */ }

    // 4) From various base locations (both source and renderable)
    const candidates = [
        (src as any)?.sidc,
        (src as any)?._state?.sidc,
        (u as any)?.sidc,
        (u as any)?._state?.sidc,
    ];

    for (const c of candidates) {
        if (typeof c === "string" && c.trim()) return c;
    }

    // 5) Nothing resolvable
    return undefined;
}

function preferredUnitSidc(u: UnitRenderable): string | undefined {
    const src = (u as any).__sourceUnit ?? u;
    const candidates = [
        (u as any)?.sidc,
        (src as any)?.sidc,
        (u as any)?._state?.sidc,
        (src as any)?._state?.sidc,
        (u as any)?.__baseSidc,
        (src as any)?.__baseSidc,
    ];

    for (const c of candidates) {
        if (typeof c === "string" && c.trim()) return c;
    }
    return undefined;
}

function shouldDebugSidc(unitId?: string): boolean {
    try {
        const w: any = window as any;
        if (!w.__3dSidcDebug) return false;
        const filter = typeof w.__3dSidcDebugUnitId === "string" ? w.__3dSidcDebugUnitId.trim() : "";
        if (!filter) return true;
        return typeof unitId === "string" && unitId === filter;
    } catch {
        return false;
    }
}

function shouldDebugMobility(unitId?: string): boolean {
    try {
        const w: any = window as any;
        if (!w.__3dMobilityDebug) return false;
        const filter = typeof w.__3dMobilityDebugUnitId === "string" ? w.__3dMobilityDebugUnitId.trim() : "";
        if (!filter) return true;
        return typeof unitId === "string" && unitId === filter;
    } catch {
        return false;
    }
}

function logSidcDebug(stage: string, payload: Record<string, unknown>) {
    try {
        // eslint-disable-next-line no-console
        console.log(`[3D SIDC] ${stage}`, payload);
    } catch { /* ignore */ }
}

function applyBillboardGraphics(ent: Cesium.Entity, u: UnitRenderable, viewer?: Cesium.Viewer) {
    // Height ref + motion
    const hRef = unitHeightRef(u);
    const motion = buildPositionPropertyForUnit(u);

    if (motion) {
        ent.position = motion;
        ent.orientation = new VelocityOrientationProperty(motion);
    } else {
        const height = hRef === HeightReference.RELATIVE_TO_GROUND ? scaledAlt(u.alt ?? 0) : (u.alt ?? 0);
        setEntityPosition(ent, u.lon, u.lat, height);
        ent.orientation = undefined;
    }

    applyPathGraphics(ent, u);

    // Build icon synchronously; do not create a billboard if nothing is available
    const url = buildIconUrlSync(u, viewer);
    ent.point = undefined as any;
    safelyDisableEntityCylinder(ent);

    if (typeof url === "string" && url.length > 0) {
        ent.billboard = new Cesium.BillboardGraphics({
            image: url,
            // IMPORTANT: no color tint here; let the image carry its own colors
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            heightReference: hRef,
            disableDepthTestDistance: 0,
            scaleByDistance: new Cesium.NearFarScalar(800.0, 1.0, 2_000_000.0, 0.5),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 10_000_000.0),
        });
    } else {
        // IMPORTANT: do NOT clear an existing billboard on a transient icon-build failure.
        // (buildIconUrlSync returns undefined specifically to allow keeping the existing image.)
    }

    // Label
    ent.label = u.name ? makeSideLabel(u.name, hRef, "left", u.labelOffsetPxY ?? -12) : undefined;
    if (u.name && ent.label && viewer) {
        alignLabelToIconLeftEdge(viewer, ent, u, /*padPx=*/ 10);
    }
    installIconLiftTick(viewer, ent, u);
    applyAvailability(ent, u);
    applyIconLift(ent, u);
}

const MAN_PORTABLE_BASE_HEIGHT_M = 2;
const MAN_PORTABLE_BASE_DIAMETER_M = 1;
const MAN_PORTABLE_ICON_CAP_DIAMETER_M = 1;
const MAN_PORTABLE_ICON_PX = 28;
const MAN_PORTABLE_ICON_TOP_OFFSET_PX = -16;
const MAN_PORTABLE_ICON_CAP_SUFFIX = "__mpw_icon_cap";
const MAN_PORTABLE_ICON_DECAL_SUFFIX = "__mpw_icon_decal";
const MAN_PORTABLE_ICON_CAP_RAISE_M = 0.08;
const MAN_PORTABLE_ICON_DECAL_RAISE_M = 0.12;
const GROUND_UNIT_LABEL_LEFT_OFFSET_M = 3;
const GROUND_UNIT_LABEL_UP_OFFSET_M = 3;
const LAUNCHER_BASE_SIZE_M = { x: 3.5, y: 6.5, z: 3.0 } as const;
const LAUNCHER_TUBE_RADIUS_M = 0.35;
const LAUNCHER_TUBE_LENGTH_M = 5.0;
const LAUNCHER_TUBE_GRID_SPACING_M = 1.2;
const LAUNCHER_TUBE_GRID_HALF_SPACING_M = LAUNCHER_TUBE_GRID_SPACING_M / 2;
// North is treated as "front"; grid center is biased toward rear.
const LAUNCHER_TUBE_GRID_CENTER_NORTH_M = -2.25;
const LAUNCHER_TUBE_UP_OFFSET_M = 2.0;
const LAUNCHER_SIX_TUBE_GRID_SPACING_M = 1.4;
const LAUNCHER_SIX_TUBE_GRID_HALF_SPACING_M = LAUNCHER_SIX_TUBE_GRID_SPACING_M / 2;
const LAUNCHER_SIX_TUBE_GRID_CENTER_NORTH_M = -2.2;
const LAUNCHER_SIX_TUBE_HEADING_DEG = 90;
const LAUNCHER_SIX_TUBE_PITCH_DEG = 45;
const LAUNCHER_SINGLE_TUBE_RADIUS_M = 0.6;
const LAUNCHER_SINGLE_TUBE_LENGTH_M = 5.0;
const LAUNCHER_SINGLE_TUBE_NORTH_M = -2.25;
const LAUNCHER_SINGLE_TUBE_UP_M = 2.0;
const WEAPON_TRIANGLE_SIDE_M = 2;
const WEAPON_TRIANGLE_HEIGHT_M = 2;
const LAND_EQUIP_PART_SUFFIX = "__le_part_";
const VEHICLE_MOBILITY_PART_SUFFIX = "__mob_part_";
const VEHICLE_HULL_ADDON_PART_SUFFIX = "__hull_addon_";
const WEAPON_TRIANGLE_SUBCATEGORY_IDS = new Set<string>([
    "weapon-air-defense-gun",
    "weapon-antitank-gun",
    "weapon-direct-fire-gun",
    "weapon-recoilless-gun",
    "weapon-howitzer",
    "weapon-mortar",
]);

function applyGroundPrimitiveLabelOffset(label: Cesium.LabelGraphics | undefined) {
    if (!label) return;
    label.eyeOffset = new Cesium.Cartesian3(
        -GROUND_UNIT_LABEL_LEFT_OFFSET_M,
        GROUND_UNIT_LABEL_UP_OFFSET_M,
        0,
    );
    // Keep labels visible when terrain/geometry depth test would otherwise hide them.
    (label as any).disableDepthTestDistance = Number.POSITIVE_INFINITY;
}
// Temporary visibility aid while validating in-scene rendering.
const MAN_PORTABLE_DEBUG_VISUALS = false;
const MAN_PORTABLE_DEBUG_HEIGHT_M = 4;
const MAN_PORTABLE_DEBUG_DIAMETER_M = 3;

function getManPortableDimensions() {
    const height = MAN_PORTABLE_DEBUG_VISUALS ? MAN_PORTABLE_DEBUG_HEIGHT_M : MAN_PORTABLE_BASE_HEIGHT_M;
    const diameter = MAN_PORTABLE_DEBUG_VISUALS ? MAN_PORTABLE_DEBUG_DIAMETER_M : MAN_PORTABLE_BASE_DIAMETER_M;
    return { height, radius: diameter / 2 };
}

function terrainHeightMetersAtLonLatDeg(viewer: Cesium.Viewer | undefined, lonDeg: number, latDeg: number): number {
    const key = terrainCacheKey(lonDeg, latDeg);
    try {
        if (!viewer) return 0;
        const carto = Cartographic.fromDegrees(lonDeg, latDeg, 0);
        const h = viewer.scene?.globe?.getHeight?.(carto);
        if (typeof h === "number" && Number.isFinite(h)) {
            terrainHeightCacheMeters.set(key, h);
            return h;
        }
    } catch { /* ignore */ }
    const cached = terrainHeightCacheMeters.get(key);
    if (typeof cached === "number" && Number.isFinite(cached)) return cached;
    requestTerrainHeightSample(viewer, lonDeg, latDeg);
    return 0;
}

function terrainAwareProductCenterFromDegrees(
    viewer: Cesium.Viewer | undefined,
    lonDeg: number,
    latDeg: number,
    centerOffsetMeters: number,
    footprint?: ProductFootprint,
): Cartesian3 {
    const pose = computeGroundConformPose(
        (lon, lat) => terrainHeightMetersAtLonLatDeg(viewer, lon, lat),
        {
            lonDeg,
            latDeg,
            footprint,
            clearanceMeters: GROUND_PRIMITIVE_CLEARANCE_M,
            includeCenterSample: true,
        },
    );
    return Cartesian3.fromDegrees(lonDeg, latDeg, pose.anchorHeightMeters + centerOffsetMeters);
}

function makeCirclePolygonHierarchy(
    center: Cesium.Cartesian3,
    radiusMeters: number,
    segments = 40,
): Cesium.PolygonHierarchy {
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(center);
    const pts: Cesium.Cartesian3[] = [];
    for (let i = 0; i < segments; i += 1) {
        const a = (i / segments) * Math.PI * 2;
        const local = new Cesium.Cartesian3(Math.cos(a) * radiusMeters, Math.sin(a) * radiusMeters, 0);
        pts.push(Cesium.Matrix4.multiplyByPoint(enu, local, new Cesium.Cartesian3()));
    }
    return new Cesium.PolygonHierarchy(pts);
}

function makeOrientedCirclePolygonHierarchy(
    center: Cesium.Cartesian3,
    orientation: Cesium.Quaternion | undefined,
    radiusMeters: number,
    segments = 40,
): Cesium.PolygonHierarchy {
    if (!orientation) return makeCirclePolygonHierarchy(center, radiusMeters, segments);
    const rot = Cesium.Matrix3.fromQuaternion(orientation, new Cesium.Matrix3());
    const pts: Cesium.Cartesian3[] = [];
    for (let i = 0; i < segments; i += 1) {
        const a = (i / segments) * Math.PI * 2;
        const local = new Cesium.Cartesian3(Math.cos(a) * radiusMeters, Math.sin(a) * radiusMeters, 0);
        const world = Cesium.Matrix3.multiplyByVector(rot, local, new Cesium.Cartesian3());
        pts.push(Cesium.Cartesian3.add(center, world, new Cesium.Cartesian3()));
    }
    return new Cesium.PolygonHierarchy(pts);
}

function makeEquilateralTrianglePolygonHierarchy(
    center: Cesium.Cartesian3,
    sideMeters: number,
): Cesium.PolygonHierarchy {
    const triHeight = (Math.sqrt(3) / 2) * sideMeters;
    const yBase = -(triHeight / 3);
    const yApex = (2 * triHeight) / 3;
    const halfSide = sideMeters / 2;

    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(center);
    const p1 = Cesium.Matrix4.multiplyByPoint(
        enu,
        new Cesium.Cartesian3(-halfSide, yBase, 0),
        new Cesium.Cartesian3(),
    );
    const p2 = Cesium.Matrix4.multiplyByPoint(
        enu,
        new Cesium.Cartesian3(halfSide, yBase, 0),
        new Cesium.Cartesian3(),
    );
    const p3 = Cesium.Matrix4.multiplyByPoint(
        enu,
        new Cesium.Cartesian3(0, yApex, 0),
        new Cesium.Cartesian3(),
    );

    return new Cesium.PolygonHierarchy([p1, p2, p3]);
}

function offsetFromCenterENU(
    center: Cesium.Cartesian3,
    eastMeters: number,
    northMeters: number,
    upMeters = 0,
): Cesium.Cartesian3 {
    const enu = Cesium.Transforms.eastNorthUpToFixedFrame(center);
    return Cesium.Matrix4.multiplyByPoint(
        enu,
        new Cesium.Cartesian3(eastMeters, northMeters, upMeters),
        new Cesium.Cartesian3(),
    );
}

function offsetFromCenterOriented(
    center: Cesium.Cartesian3,
    orientation: Cesium.Quaternion | undefined,
    eastMeters: number,
    northMeters: number,
    upMeters = 0,
): Cesium.Cartesian3 {
    if (!orientation) {
        return offsetFromCenterENU(center, eastMeters, northMeters, upMeters);
    }
    const rot = Cesium.Matrix3.fromQuaternion(orientation, new Cesium.Matrix3());
    const local = new Cesium.Cartesian3(eastMeters, northMeters, upMeters);
    const world = Cesium.Matrix3.multiplyByVector(rot, local, new Cesium.Cartesian3());
    return Cesium.Cartesian3.add(center, world, new Cesium.Cartesian3());
}

function offsetFromEntityLocal(
    ent: Cesium.Entity,
    time: Cesium.JulianDate,
    eastMeters: number,
    northMeters: number,
    upMeters = 0,
): Cesium.Cartesian3 | undefined {
    const base = ent.position?.getValue?.(time);
    if (!base) return undefined;
    const q = ent.orientation?.getValue?.(time) as Cesium.Quaternion | undefined;
    return offsetFromCenterOriented(base, q, eastMeters, northMeters, upMeters);
}

function orientationFromEntityLocalHpr(
    ent: Cesium.Entity,
    time: Cesium.JulianDate,
    headingRad: number,
    pitchRad: number,
    rollRad: number,
): Cesium.Quaternion | undefined {
    const base = ent.position?.getValue?.(time);
    if (!base) return undefined;
    const parent = ent.orientation?.getValue?.(time) as Cesium.Quaternion | undefined;
    const local = Cesium.Quaternion.fromHeadingPitchRoll(
        new Cesium.HeadingPitchRoll(headingRad, pitchRad, rollRad),
        new Cesium.Quaternion(),
    );
    if (parent) {
        return Cesium.Quaternion.multiply(parent, local, new Cesium.Quaternion());
    }
    return Cesium.Transforms.headingPitchRollQuaternion(
        base,
        new Cesium.HeadingPitchRoll(headingRad, pitchRad, rollRad),
    );
}

function orientationFromGroundPose(
    pos: Cesium.Cartesian3,
    pose: {
        headingRad: number;
        upEast: number;
        upNorth: number;
        upUp: number;
    },
): Cesium.Quaternion {
    const upEnu = Cesium.Cartesian3.normalize(
        new Cesium.Cartesian3(pose.upEast, pose.upNorth, pose.upUp),
        new Cesium.Cartesian3(),
    );
    const f0 = new Cesium.Cartesian3(Math.sin(pose.headingRad), Math.cos(pose.headingRad), 0);
    const upDotF0 = Cesium.Cartesian3.dot(upEnu, f0);
    const fProj = Cesium.Cartesian3.subtract(
        f0,
        Cesium.Cartesian3.multiplyByScalar(upEnu, upDotF0, new Cesium.Cartesian3()),
        new Cesium.Cartesian3(),
    );
    let forwardEnu = Cesium.Cartesian3.normalize(fProj, new Cesium.Cartesian3());
    if (!Number.isFinite(forwardEnu.x) || Cesium.Cartesian3.magnitude(forwardEnu) < 1e-6) {
        forwardEnu = new Cesium.Cartesian3(0, 1, 0);
    }
    let rightEnu = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.cross(forwardEnu, upEnu, new Cesium.Cartesian3()),
        new Cesium.Cartesian3(),
    );
    if (!Number.isFinite(rightEnu.x) || Cesium.Cartesian3.magnitude(rightEnu) < 1e-6) {
        rightEnu = new Cesium.Cartesian3(1, 0, 0);
    }
    forwardEnu = Cesium.Cartesian3.normalize(
        Cesium.Cartesian3.cross(upEnu, rightEnu, new Cesium.Cartesian3()),
        new Cesium.Cartesian3(),
    );

    const enuFrame = Cesium.Transforms.eastNorthUpToFixedFrame(pos);
    const enuToFixed = Cesium.Matrix4.getMatrix3(enuFrame, new Cesium.Matrix3());
    const rightFixed = Cesium.Matrix3.multiplyByVector(enuToFixed, rightEnu, new Cesium.Cartesian3());
    const forwardFixed = Cesium.Matrix3.multiplyByVector(enuToFixed, forwardEnu, new Cesium.Cartesian3());
    const upFixed = Cesium.Matrix3.multiplyByVector(enuToFixed, upEnu, new Cesium.Cartesian3());

    const rot = new Cesium.Matrix3();
    Cesium.Matrix3.setColumn(rot, 0, rightFixed, rot);
    Cesium.Matrix3.setColumn(rot, 1, forwardFixed, rot);
    Cesium.Matrix3.setColumn(rot, 2, upFixed, rot);
    return Cesium.Quaternion.fromRotationMatrix(rot, new Cesium.Quaternion());
}

function makeGroundPrimitivePoseProperties(
    viewer: Cesium.Viewer | undefined,
    u: UnitRenderable,
    centerOffsetMeters: number,
    footprint?: ProductFootprint,
): { position: Cesium.CallbackProperty; orientation: Cesium.CallbackProperty } {
    const poseForLonLat = (lonDeg: number, latDeg: number) =>
        computeGroundConformPose(
            (lon, lat) => terrainHeightMetersAtLonLatDeg(viewer, lon, lat),
            {
                lonDeg,
                latDeg,
                footprint,
                clearanceMeters: GROUND_PRIMITIVE_CLEARANCE_M,
                includeCenterSample: true,
            },
        );

    const motion = buildPositionPropertyForUnit(u);
    if (motion) {
        const position = new CallbackProperty((time) => {
            const p = motion.getValue(time);
            if (!p) return undefined;
            const carto = Cartographic.fromCartesian(p);
            const lonDeg = Cesium.Math.toDegrees(carto.longitude);
            const latDeg = Cesium.Math.toDegrees(carto.latitude);
            const pose = poseForLonLat(lonDeg, latDeg);
            return Cartesian3.fromDegrees(lonDeg, latDeg, pose.anchorHeightMeters + centerOffsetMeters);
        }, false) as any;
        const orientation = new CallbackProperty((time) => {
            const p = motion.getValue(time);
            if (!p) return undefined;
            const carto = Cartographic.fromCartesian(p);
            const lonDeg = Cesium.Math.toDegrees(carto.longitude);
            const latDeg = Cesium.Math.toDegrees(carto.latitude);
            const pose = poseForLonLat(lonDeg, latDeg);
            const pos = Cartesian3.fromDegrees(lonDeg, latDeg, pose.anchorHeightMeters + centerOffsetMeters);
            return orientationFromGroundPose(pos, pose);
        }, false) as any;
        return { position, orientation };
    }
    const position = new CallbackProperty(() => {
        const pose = poseForLonLat(u.lon, u.lat);
        return Cartesian3.fromDegrees(u.lon, u.lat, pose.anchorHeightMeters + centerOffsetMeters);
    }, false) as any;
    const orientation = new CallbackProperty(() => {
        const pose = poseForLonLat(u.lon, u.lat);
        const pos = Cartesian3.fromDegrees(u.lon, u.lat, pose.anchorHeightMeters + centerOffsetMeters);
        return orientationFromGroundPose(pos, pose);
    }, false) as any;
    return { position, orientation };
}

function launcherTubeEntityId(unitId: string, index: 0 | 1 | 2 | 3 | 4 | 5 | 6): string {
    return `${unitId}__launcher_tube_${index}`;
}

function tankTurretEntityId(unitId: string): string {
    return `${unitId}__tank_turret`;
}

function tankBarrelEntityId(unitId: string): string {
    return `${unitId}__tank_barrel`;
}

function tankPartIdsForUnit(unitId: string): string[] {
    return [tankTurretEntityId(unitId), tankBarrelEntityId(unitId)];
}

function ifvTurretEntityId(unitId: string): string {
    return `${unitId}__ifv_turret`;
}

function ifvBarrelEntityId(unitId: string): string {
    return `${unitId}__ifv_barrel`;
}

function ifvPartIdsForUnit(unitId: string): string[] {
    return [ifvTurretEntityId(unitId), ifvBarrelEntityId(unitId)];
}

function armoredHullPartIdsForUnit(unitId: string): string[] {
    return armoredUpperHullPartIdsForUnit(unitId);
}

function armoredTurretEntityId(unitId: string): string {
    return `${unitId}__armored_turret`;
}

function armoredBarrelEntityId(unitId: string): string {
    return `${unitId}__armored_barrel`;
}

function armoredPartIdsForUnit(unitId: string): string[] {
    return [armoredTurretEntityId(unitId), armoredBarrelEntityId(unitId)];
}

function recoveryBoomEntityId(unitId: string): string {
    return `${unitId}__recovery_boom`;
}

function recoveryPartIdsForUnit(unitId: string): string[] {
    return [recoveryBoomEntityId(unitId)];
}

function apcModuleEntityId(unitId: string): string {
    return `${unitId}__apc_module`;
}

function apcPartIdsForUnit(unitId: string): string[] {
    return [apcModuleEntityId(unitId)];
}

function apcAmbulanceModuleEntityId(unitId: string): string {
    return `${unitId}__apc_ambulance_module`;
}

function apcAmbulancePodEntityId(unitId: string): string {
    return `${unitId}__apc_ambulance_pod`;
}

function apcAmbulancePartIdsForUnit(unitId: string): string[] {
    return [apcAmbulanceModuleEntityId(unitId), apcAmbulancePodEntityId(unitId)];
}

function reconMastEntityId(unitId: string): string {
    return `${unitId}__recon_mast`;
}

function reconPartIdsForUnit(unitId: string): string[] {
    return [reconMastEntityId(unitId)];
}

function cargoModuleEntityId(unitId: string): string {
    return `${unitId}__cargo_module`;
}

function cargoPartIdsForUnit(unitId: string): string[] {
    return [cargoModuleEntityId(unitId)];
}

function commandModuleEntityId(unitId: string): string {
    return `${unitId}__command_module`;
}

function commandMastEntityId(unitId: string): string {
    return `${unitId}__command_mast`;
}

function commandHeadEntityId(unitId: string): string {
    return `${unitId}__command_head`;
}

function commandPartIdsForUnit(unitId: string): string[] {
    return [commandModuleEntityId(unitId), commandMastEntityId(unitId), commandHeadEntityId(unitId)];
}

function recoveryRigBoomEntityId(unitId: string): string {
    return `${unitId}__recovery_rig_boom`;
}

function recoveryRigHookEntityId(unitId: string): string {
    return `${unitId}__recovery_rig_hook`;
}

function recoveryRigPartIdsForUnit(unitId: string): string[] {
    return [recoveryRigBoomEntityId(unitId), recoveryRigHookEntityId(unitId)];
}

function landEquipPartId(unitId: string, index: number): string {
    return `${unitId}${LAND_EQUIP_PART_SUFFIX}${index}`;
}

function vehicleMobilityPartId(unitId: string, index: number): string {
    return `${unitId}${VEHICLE_MOBILITY_PART_SUFFIX}${index}`;
}

function vehicleHullAddonPartId(unitId: string, index: number): string {
    return `${unitId}${VEHICLE_HULL_ADDON_PART_SUFFIX}${index}`;
}

function vehicleMobilityPartIdsForSidc(unitId: string, sidc?: string): string[] {
    const profile = resolveLandEquipmentMobilityProfileFromSidc(sidc);
    const count = expectedVehicleMobilityPartCount(profile);
    if (!count) return [];
    return Array.from({ length: count }, (_, i) => vehicleMobilityPartId(unitId, i));
}

function vehicleProductCacheKey(sidc: string | undefined, useArmoredSplitHull: boolean): string {
    return `${sidc ?? "unknown"}::armored=${useArmoredSplitHull ? 1 : 0}`;
}

function getVehicleProductBlueprint(sidc?: string): VehicleProductBlueprint {
    const useArmoredSplitHull = shouldUseArmoredSplitHullForSidc(sidc);
    const key = vehicleProductCacheKey(sidc, useArmoredSplitHull);
    return vehicleProductCache.getOrCreate(key, () => {
        const hullSize = resolveVehicleHullSizeForSidc(sidc);
        const hullSplit = useArmoredSplitHull ? computeArmoredHullSplit(hullSize) : undefined;
        const baseBodyHeight = hullSplit ? hullSplit.lowerHeight : resolveVehicleBaseBodyHeightForSidc(sidc, hullSize);
        const addonSpecs = buildVehicleHullAddonSpecs(sidc, hullSize, baseBodyHeight);
        const footprint: ProductFootprint = {
            halfWidthMeters: hullSize.x / 2,
            halfLengthMeters: hullSize.y / 2,
        };
        return {
            cacheKey: key,
            baseSize: { x: hullSize.x, y: hullSize.y, z: baseBodyHeight },
            baseBodyHeight,
            useArmoredSplitHull,
            parts: addonSpecs.map((s, i) => ({
                kind: "box" as const,
                id: `addon:${i}`,
                size: { x: s.size.x, y: s.size.y, z: s.size.z },
                offset: { east: s.east, north: s.north, up: s.up },
                alpha: s.alpha,
            })),
            footprint,
        };
    });
}

function vehicleHullAddonPartIdsForSidc(unitId: string, sidc?: string): string[] {
    const count = getVehicleProductBlueprint(sidc).parts.length;
    if (!count) return [];
    return Array.from({ length: count }, (_, i) => vehicleHullAddonPartId(unitId, i));
}

function isLauncherTubeId(id: string): boolean {
    return /__launcher_tube_\d+$/.test(id);
}

function isLandEquipPartId(id: string): boolean {
    return /__le_part_\d+$/.test(id);
}

function isVehicleMobilityPartId(id: string): boolean {
    return /__mob_part_\d+$/.test(id);
}

function isVehicleHullAddonPartId(id: string): boolean {
    return /__hull_addon_\d+$/.test(id);
}

function isTankPartId(id: string): boolean {
    return /__tank_(turret|barrel)$/.test(id);
}

function isIfvPartId(id: string): boolean {
    return /__ifv_(turret|barrel)$/.test(id);
}

function isArmoredHullPartId(id: string): boolean {
    return /__armored_upper_(top|front|rear|left|right)$/.test(id);
}

function isArmoredPartId(id: string): boolean {
    return /__armored_(turret|barrel)$/.test(id);
}

function isRecoveryPartId(id: string): boolean {
    return /__recovery_boom$/.test(id);
}

function isApcPartId(id: string): boolean {
    return /__apc_module$/.test(id);
}

function isApcAmbulancePartId(id: string): boolean {
    return /__apc_ambulance_(module|pod)$/.test(id);
}

function isReconPartId(id: string): boolean {
    return /__recon_mast$/.test(id);
}

function isCargoPartId(id: string): boolean {
    return /__cargo_module$/.test(id);
}

function isCommandPartId(id: string): boolean {
    return /__command_(module|mast|head)$/.test(id);
}

function isRecoveryRigPartId(id: string): boolean {
    return /__recovery_rig_(boom|hook)$/.test(id);
}

function baseIdFromLauncherTubeId(id: string): string {
    return id.replace(/__launcher_tube_\d+$/, "");
}

function baseIdFromTankPartId(id: string): string {
    return id.replace(/__tank_(turret|barrel)$/, "");
}

function baseIdFromIfvPartId(id: string): string {
    return id.replace(/__ifv_(turret|barrel)$/, "");
}

function baseIdFromArmoredHullPartId(id: string): string {
    return id.replace(/__armored_upper_(top|front|rear|left|right)$/, "");
}

function baseIdFromArmoredPartId(id: string): string {
    return id.replace(/__armored_(turret|barrel)$/, "");
}

function baseIdFromRecoveryPartId(id: string): string {
    return id.replace(/__recovery_boom$/, "");
}

function baseIdFromApcPartId(id: string): string {
    return id.replace(/__apc_module$/, "");
}

function baseIdFromApcAmbulancePartId(id: string): string {
    return id.replace(/__apc_ambulance_(module|pod)$/, "");
}

function baseIdFromReconPartId(id: string): string {
    return id.replace(/__recon_mast$/, "");
}

function baseIdFromCargoPartId(id: string): string {
    return id.replace(/__cargo_module$/, "");
}

function baseIdFromCommandPartId(id: string): string {
    return id.replace(/__command_(module|mast|head)$/, "");
}

function baseIdFromRecoveryRigPartId(id: string): string {
    return id.replace(/__recovery_rig_(boom|hook)$/, "");
}

function baseIdFromLandEquipPartId(id: string): string {
    return id.replace(/__le_part_\d+$/, "");
}

function baseIdFromVehicleMobilityPartId(id: string): string {
    return id.replace(/__mob_part_\d+$/, "");
}

function baseIdFromVehicleHullAddonPartId(id: string): string {
    return id.replace(/__hull_addon_\d+$/, "");
}

function launcherTubeIdsForShape(
    unitId: string,
    shape: "weaponDualTubeLauncher" | "weaponSixTubeLauncher" | "weaponSingleLargeTubeLauncher",
): string[] {
    if (shape === "weaponSingleLargeTubeLauncher") {
        return [launcherTubeEntityId(unitId, 6)];
    }
    if (shape === "weaponSixTubeLauncher") {
        return [
            launcherTubeEntityId(unitId, 0),
            launcherTubeEntityId(unitId, 1),
            launcherTubeEntityId(unitId, 2),
            launcherTubeEntityId(unitId, 3),
            launcherTubeEntityId(unitId, 4),
            launcherTubeEntityId(unitId, 5),
        ];
    }
    return [
        launcherTubeEntityId(unitId, 0),
        launcherTubeEntityId(unitId, 1),
        launcherTubeEntityId(unitId, 2),
        launcherTubeEntityId(unitId, 3),
    ];
}

type MobilityPartSpec = {
    east: number;
    north: number;
    up: number;
    kind: "wheel" | "track" | "runner" | "pontoon" | "rail" | "towArm" | "towArray";
    box?: { x: number; y: number; z: number };
    cylinder?: { length: number; radius: number };
};

type MobilityVisualTuning = {
    halfW: number;
    halfL: number;
    halfH: number;
    wheelRadius: number;
    wheelThickness: number;
    wheelInsetOutboard: number;
    trackThickness: number;
    trackHeight: number;
};

type TankVisualProfile = {
    hullSize: { x: number; y: number; z: number };
    turretSize: { x: number; y: number; z: number };
    turretUpOffset: number;
    barrelLength: number;
    barrelRadius: number;
    barrelUpFromTurret: number;
    barrelForwardFromTurret: number;
};

function vehicleCenterOffsetForSidc(sidc?: string): number {
    return getVehicleProductBlueprint(sidc).baseBodyHeight / 2;
}

function hullTopUpOffsetFromCenter(hullSize: VehicleHullSize, hullSplit?: ArmoredHullSplit): number {
    if (hullSplit) {
        return hullSplit.upperCenterUpFromLowerCenter + (hullSplit.upperSize.z / 2);
    }
    return hullSize.z / 2;
}

function shouldUseArmoredSplitHullForSidc(sidc?: string): boolean {
    const p = parseSidcCoreParts(sidc);
    return p.entityCode === "12";
}

function tankVisualProfileForSidc(sidc?: string): TankVisualProfile {
    const p = parseSidcCoreParts(sidc);
    let hull = resolveVehicleHullSizeForSidc(sidc);
    let turret = {
        x: hull.x * 0.62,
        y: hull.y * 0.27,
        z: hull.z * 0.42,
    };
    let barrelLength = Math.max(TANK_BARREL_LENGTH_M, hull.y * 0.47);
    let barrelRadius = Math.max(TANK_BARREL_RADIUS_M, turret.x * 0.095);
    let barrelUpFromTurret = TANK_BARREL_UP_FROM_TURRET_M;

    if (p.entityCode === "12" && p.entityTypeCode === "02") {
        if (p.entitySubtypeCode === "01") {
            turret = { x: hull.x * 0.6, y: hull.y * 0.25, z: hull.z * 0.4 };
            barrelLength = Math.max(3.0, hull.y * 0.45);
            barrelRadius = Math.max(0.17, turret.x * 0.09);
        } else if (p.entitySubtypeCode === "03") {
            turret = { x: hull.x * 0.65, y: hull.y * 0.29, z: hull.z * 0.44 };
            barrelLength = Math.max(4.1, hull.y * 0.49);
            barrelRadius = Math.max(0.23, turret.x * 0.1);
            barrelUpFromTurret = 0.06;
        }
    }

    const turretUpOffset = (hull.z / 2) + (turret.z / 2) + 0.12;
    const barrelForwardFromTurret = (turret.y / 2) + (barrelLength / 2) - 0.1;
    return {
        hullSize: hull,
        turretSize: turret,
        turretUpOffset,
        barrelLength,
        barrelRadius,
        barrelUpFromTurret,
        barrelForwardFromTurret,
    };
}

function mobilitySidcForUnit(u: UnitRenderable, viewer?: Cesium.Viewer): string | undefined {
    return resolvedSidcForRendering(u, viewer) ?? effectiveSidc(u, viewer) ?? preferredUnitSidc(u);
}

function mobilityVisualTuningForSidc(sidc?: string): MobilityVisualTuning {
    const hullSize = resolveVehicleHullSizeForSidc(sidc);
    const armoredLowerHalfH = (hullSize.z * ARMORED_LOWER_HULL_VOLUME_SHARE) / 2;
    const base: MobilityVisualTuning = {
        halfW: hullSize.x / 2,
        halfL: hullSize.y / 2,
        halfH: hullSize.z / 2,
        wheelRadius: Math.max(0.34, hullSize.z * 0.16),
        wheelThickness: Math.max(0.24, hullSize.x * 0.09),
        wheelInsetOutboard: Math.max(0.2, hullSize.x * 0.07),
        trackThickness: Math.max(0.28, hullSize.x * 0.1),
        trackHeight: Math.max(0.56, hullSize.z * 0.24),
    };
    const p = parseSidcCoreParts(sidc);
    if (!p.entityCode) return base;

    if (p.entityCode === "12") {
        if (p.entityTypeCode === "02") {
            if (p.entitySubtypeCode === "01") {
                return { ...base, halfH: 1.4, wheelRadius: 0.43, trackThickness: 0.33, trackHeight: 0.72 };
            }
            if (p.entitySubtypeCode === "03") {
                return { ...base, halfH: 1.6, wheelRadius: 0.52, trackThickness: 0.39, trackHeight: 0.84 };
            }
            return { ...base, halfH: 1.5, wheelRadius: 0.48, trackThickness: 0.36, trackHeight: 0.78 };
        }
        if (p.entityTypeCode === "01" && p.entitySubtypeCode === "01") {
            return { ...base, halfL: 3.1, halfH: armoredLowerHalfH, wheelRadius: 0.38, trackHeight: 0.62 };
        }
        if (p.entityTypeCode === "01") {
            return { ...base, halfH: armoredLowerHalfH };
        }
        return base;
    }
    if (p.entityCode === "14" || p.entityCode === "23") {
        return { ...base, halfW: 1.65, halfL: 3.8, wheelRadius: 0.4 };
    }
    if (p.entityCode === "16") {
        return base;
    }
    if (p.entityCode === "19") {
        return { ...base, halfW: 1.75, halfL: 4.4, wheelRadius: 0.44 };
    }
    if (p.entityCode === "13") {
        return { ...base, halfW: 1.7, halfL: 3.9, wheelRadius: 0.42 };
    }
    if (p.entityCode === "17") {
        return { ...base, halfW: 1.45, halfL: 2.9, wheelRadius: 0.34, trackHeight: 0.56 };
    }
    if (p.entityCode === "15") {
        return { ...base, halfW: 1.6, halfL: 6.7, wheelRadius: 0.46 };
    }
    return base;
}

function shouldApplyMobilityToCategory(categoryId?: string): boolean {
    return categoryId === "vehicles"
        || categoryId === "engineer-vehicles-and-equipment"
        || categoryId === "utility-vehicles"
        || categoryId === "law-enforcement"
        || categoryId === "missile-support"
        || categoryId === "emergency-operation"
        || categoryId === "trains";
}

function vehicleMobilityPartIdsForUnit(viewer: Cesium.Viewer | undefined, unitId: string): string[] {
    if (!viewer) return [];
    const prefix = `${unitId}${VEHICLE_MOBILITY_PART_SUFFIX}`;
    return (viewer.entities.values ?? [])
        .map((e: any) => e?.id)
        .filter((id: any) => typeof id === "string" && id.startsWith(prefix)) as string[];
}

function buildVehicleMobilitySpecs(sidc?: string): MobilityPartSpec[] {
    const profile = resolveLandEquipmentMobilityProfileFromSidc(sidc);
    if (!profile) return [];
    const specs: MobilityPartSpec[] = [];
    const t = mobilityVisualTuningForSidc(sidc);
    const halfW = t.halfW;
    const halfL = t.halfL;
    const halfH = t.halfH;
    const wheelSide = halfW + t.wheelInsetOutboard;
    const wheelUp = -halfH + (t.wheelRadius + 0.03);

    const pushWheels = (norths: number[]) => {
        for (const n of norths) {
            specs.push({
                kind: "wheel",
                east: -wheelSide,
                north: n,
                up: wheelUp,
                cylinder: { length: t.wheelThickness, radius: t.wheelRadius },
            });
            specs.push({
                kind: "wheel",
                east: wheelSide,
                north: n,
                up: wheelUp,
                cylinder: { length: t.wheelThickness, radius: t.wheelRadius },
            });
        }
    };

    if (profile.kind === "wheeled") {
        if (profile.wheelCount >= 6) pushWheels([-2.3, 0, 2.3]);
        else pushWheels([-2.0, 2.0]);
    } else if (profile.kind === "tracked") {
        specs.push({
            kind: "track",
            east: -(halfW + (t.trackThickness / 2)),
            north: 0,
            up: -halfH + (t.trackHeight / 2),
            box: { x: t.trackThickness, y: halfL * 2 * 0.88, z: t.trackHeight },
        });
        specs.push({
            kind: "track",
            east: halfW + (t.trackThickness / 2),
            north: 0,
            up: -halfH + (t.trackHeight / 2),
            box: { x: t.trackThickness, y: halfL * 2 * 0.88, z: t.trackHeight },
        });
    } else if (profile.kind === "wheeledTracked") {
        specs.push({
            kind: "track",
            east: -(halfW + (t.trackThickness / 2)),
            north: -0.6,
            up: -halfH + (t.trackHeight / 2) - 0.05,
            box: { x: t.trackThickness, y: halfL * 2 * 0.62, z: t.trackHeight * 0.92 },
        });
        specs.push({
            kind: "track",
            east: halfW + (t.trackThickness / 2),
            north: -0.6,
            up: -halfH + (t.trackHeight / 2) - 0.05,
            box: { x: t.trackThickness, y: halfL * 2 * 0.62, z: t.trackHeight * 0.92 },
        });
        pushWheels([1.7]);
    } else if (profile.kind === "towed") {
        pushWheels([-1.4]);
        specs.push({
            kind: "towArm",
            east: 0,
            north: halfL + 0.95,
            up: -halfH + 0.5,
            box: { x: 0.22, y: 1.9, z: 0.22 },
        });
    } else if (profile.kind === "rail") {
        specs.push({
            kind: "rail",
            east: -(halfW + 0.38),
            north: 0,
            up: -halfH + 0.24,
            box: { x: 0.24, y: halfL * 2 * 1.02, z: 0.2 },
        });
        specs.push({
            kind: "rail",
            east: halfW + 0.38,
            north: 0,
            up: -halfH + 0.24,
            box: { x: 0.24, y: halfL * 2 * 1.02, z: 0.2 },
        });
        pushWheels([-2.1, 2.1]);
    } else if (profile.kind === "snow" || profile.kind === "sled") {
        specs.push({
            kind: "runner",
            east: -(halfW - 0.35),
            north: 0,
            up: -halfH + 0.16,
            box: { x: 0.16, y: halfL * 2 * 0.9, z: 0.14 },
        });
        specs.push({
            kind: "runner",
            east: halfW - 0.35,
            north: 0,
            up: -halfH + 0.16,
            box: { x: 0.16, y: halfL * 2 * 0.9, z: 0.14 },
        });
    } else if (profile.kind === "amphibious") {
        specs.push({
            kind: "pontoon",
            east: -(halfW + 0.5),
            north: 0,
            up: -0.15,
            box: { x: 0.44, y: halfL * 2 * 0.88, z: 0.5 },
        });
        specs.push({
            kind: "pontoon",
            east: halfW + 0.5,
            north: 0,
            up: -0.15,
            box: { x: 0.44, y: halfL * 2 * 0.88, z: 0.5 },
        });
    }

    if (profile.towedArray !== "none") {
        const len = profile.towedArray === "long" ? 2.6 : 1.4;
        specs.push({
            kind: "towArray",
            east: 0,
            north: -(halfL + (len / 2) + 0.15),
            up: -halfH + 0.34,
            box: { x: 0.12, y: len, z: 0.12 },
        });
    }

    return specs;
}

function applyVehicleHullAddons(
    ent: Cesium.Entity,
    u: UnitRenderable,
    viewer: Cesium.Viewer | undefined,
    color: Cesium.Color,
    sidcHint?: string,
) {
    if (!viewer) return;
    const sidc = sidcHint ?? mobilitySidcForUnit(u, viewer);
    if (shouldUseArmoredSplitHullForSidc(sidc)) return;
    const product = getVehicleProductBlueprint(sidc);
    const specs = product.parts.map((p) => ({
        east: p.offset.east,
        north: p.offset.north,
        up: p.offset.up,
        size: p.size,
        alpha: p.alpha,
    }));
    const expectedIds = specs.map((_, i) => vehicleHullAddonPartId(u.id, i));
    const expectedSet = new Set(expectedIds);
    const prefix = `${u.id}${VEHICLE_HULL_ADDON_PART_SUFFIX}`;

    for (const existingId of (viewer.entities.values ?? [])
        .map((e: any) => e?.id)
        .filter((id: any) => typeof id === "string" && id.startsWith(prefix)) as string[]) {
        if (!expectedSet.has(existingId)) {
            try { viewer.entities.removeById(existingId); } catch { /* ignore */ }
        }
    }

    for (let i = 0; i < specs.length; i += 1) {
        const spec = specs[i];
        const id = expectedIds[i];
        const partEnt = viewer.entities.getById(id) ?? viewer.entities.add({ id });
        partEnt.position = new Cesium.CallbackProperty((time) => {
            try {
                return offsetFromEntityLocal(ent, time, spec.east, spec.north, spec.up);
            } catch {
                return undefined;
            }
        }, false) as any;
        partEnt.orientation = ent.orientation;
        partEnt.box = new Cesium.BoxGraphics({
            dimensions: new Cartesian3(spec.size.x, spec.size.y, spec.size.z),
            material: color.withAlpha(spec.alpha ?? 0.97),
            outline: true,
            outlineColor: Color.BLACK.withAlpha(0.82),
            heightReference: HeightReference.NONE,
        });
        partEnt.billboard = undefined as any;
        partEnt.point = undefined as any;
        safelyDisableEntityCylinder(partEnt);
        safelyDisableEntityPolyline(partEnt);
        partEnt.polygon = undefined as any;
        partEnt.label = undefined as any;
        tagEntityWithUnitId(partEnt as any, u.id);
        partEnt.show = ent.show !== false;
    }
}

function applyVehicleMobilityAddons(
    ent: Cesium.Entity,
    u: UnitRenderable,
    viewer: Cesium.Viewer | undefined,
    color: Cesium.Color,
    sidcHint?: string,
) {
    if (!viewer) return;
    const sidc = sidcHint ?? mobilitySidcForUnit(u, viewer);
    const sidcCore = parseSidcCoreParts(sidc);
    if (sidcCore.entityCode === "16") {
        // Civilian vehicle hulls intentionally omit mobility geometry
        // (wheels/tracks/etc are not rendered for this family).
        for (const id of vehicleMobilityPartIdsForUnit(viewer, u.id)) {
            try { viewer.entities.removeById(id); } catch { /* ignore */ }
        }
        return;
    }
    const profile = resolveLandEquipmentMobilityProfileFromSidc(sidc);
    const specs = buildVehicleMobilitySpecs(sidc);
    try {
        const w: any = window as any;
        if (!w.__3dMobilityLastProfileByUnit) w.__3dMobilityLastProfileByUnit = {};
        w.__3dMobilityLastProfileByUnit[u.id] = { sidc, profile, specCount: specs.length };
    } catch { /* ignore */ }
    if (shouldDebugMobility(u.id)) {
        // eslint-disable-next-line no-console
        console.log("[3D MOBILITY] addons", {
            unitId: u.id,
            sidc,
            profile,
            specCount: specs.length,
        });
    }
    const expectedIds = specs.map((_, i) => vehicleMobilityPartId(u.id, i));
    const expectedSet = new Set(expectedIds);

    for (const existingId of vehicleMobilityPartIdsForUnit(viewer, u.id)) {
        if (!expectedSet.has(existingId)) {
            try { viewer.entities.removeById(existingId); } catch { /* ignore */ }
        }
    }

    for (let i = 0; i < specs.length; i += 1) {
        const spec = specs[i];
        const id = expectedIds[i];
        const partEnt = viewer.entities.getById(id) ?? viewer.entities.add({ id });
        partEnt.position = new Cesium.CallbackProperty((time) => {
            try {
                return offsetFromEntityLocal(ent, time, spec.east, spec.north, spec.up);
            } catch {
                return undefined;
            }
        }, false) as any;
        partEnt.orientation = ent.orientation;
        partEnt.billboard = undefined as any;
        partEnt.point = undefined as any;
        safelyDisableEntityPolyline(partEnt);
        partEnt.polygon = undefined as any;
        partEnt.label = undefined as any;

        if (spec.box) {
            partEnt.box = new Cesium.BoxGraphics({
                dimensions: new Cartesian3(spec.box.x, spec.box.y, spec.box.z),
                material: color.withAlpha(0.94),
                outline: true,
                outlineColor: Color.BLACK.withAlpha(0.8),
                heightReference: HeightReference.NONE,
            });
            safelyDisableEntityCylinder(partEnt);
        } else if (spec.cylinder) {
            safelyDisableEntityBox(partEnt);
            partEnt.cylinder = new Cesium.CylinderGraphics({
                length: spec.cylinder.length,
                topRadius: spec.cylinder.radius,
                bottomRadius: spec.cylinder.radius,
                material: color.withAlpha(0.94),
                outline: true,
                outlineColor: Color.BLACK.withAlpha(0.8),
                heightReference: HeightReference.NONE,
            });
        }
        tagEntityWithUnitId(partEnt as any, u.id);
        partEnt.show = ent.show !== false;
    }
}

const landEquipRecipeCache = new Map<string, {
    instances: CompiledInstance[];
    bodyHalfH: number;
    footprint: ProductFootprint;
}>();

function getCompiledLandEquipRecipe(recipe: string) {
    const cached = landEquipRecipeCache.get(recipe);
    if (cached) return cached;
    const { instances, bodyBounds } = compileRecipeToInstances(recipe, SHAPE_GRAMMAR_TOKENS);
    const compiled = {
        instances,
        bodyHalfH: bodyBounds.halfH,
        footprint: {
            halfWidthMeters: bodyBounds.halfW,
            halfLengthMeters: bodyBounds.halfL,
        },
    };
    landEquipRecipeCache.set(recipe, compiled);
    return compiled;
}

function landEquipPartIdsForUnit(viewer: Cesium.Viewer | undefined, unitId: string): string[] {
    if (!viewer) return [];
    const prefix = `${unitId}${LAND_EQUIP_PART_SUFFIX}`;
    return (viewer.entities.values ?? [])
        .map((e: any) => e?.id)
        .filter((id: any) => typeof id === "string" && id.startsWith(prefix)) as string[];
}

function applyLandEquipPrimitiveGraphics(
    ent: Cesium.Entity,
    inst: CompiledInstance,
    color: Cesium.Color,
    outlineColor: Cesium.Color,
) {
    safelyDisableEntityBox(ent);
    safelyDisableEntityCylinder(ent);
    ent.ellipsoid = undefined as any;
    ent.polygon = undefined as any;

    if (inst.kind === "box" || inst.kind === "triangularPrism") {
        const L = inst.L ?? 4;
        const W = inst.W ?? 2;
        const H = inst.H ?? 2;
        ent.box = new Cesium.BoxGraphics({
            dimensions: new Cesium.Cartesian3(W, L, H),
            material: color,
            outline: true,
            outlineColor,
            heightReference: HeightReference.NONE,
        });
        return;
    }

    if (inst.kind === "sphere") {
        const rr = inst.radius ?? inst.r ?? 0.6;
        ent.ellipsoid = new Cesium.EllipsoidGraphics({
            radii: new Cesium.Cartesian3(rr, rr, rr),
            material: color,
            outline: true,
            outlineColor,
        } as any);
        return;
    }

    const r = inst.r ?? 0.4;
    const h = inst.h ?? 1.0;
    const isCone = inst.kind === "cone";
    ent.cylinder = new Cesium.CylinderGraphics({
        length: h,
        topRadius: isCone ? 0.0 : r,
        bottomRadius: r,
        material: color,
        outline: true,
        outlineColor,
        heightReference: HeightReference.NONE,
    });
}

function landEquipOrientationForInstance(
    inst: CompiledInstance,
    position: Cesium.Cartesian3,
): Cesium.Quaternion | undefined {
    const tiltDeg = Number(inst.tiltDeg ?? 0) || 0;
    if (inst.axis === "longitudinal") {
        const pitch = Cesium.Math.toRadians(90 - tiltDeg);
        return Cesium.Transforms.headingPitchRollQuaternion(
            position,
            new Cesium.HeadingPitchRoll(0, pitch, 0),
        );
    }
    if (tiltDeg !== 0) {
        return Cesium.Transforms.headingPitchRollQuaternion(
            position,
            new Cesium.HeadingPitchRoll(0, Cesium.Math.toRadians(-tiltDeg), 0),
        );
    }
    return undefined;
}

function applyLandEquipmentRecipeOverride(
    ent: Cesium.Entity,
    u: UnitRenderable,
    viewer: Cesium.Viewer,
    category: any,
    subcategory: any,
): boolean {
    const entityCode = subcategory?.entityCode ?? category?.entityCode;
    const entityTypeCode = subcategory?.entityTypeCode;
    const entitySubtypeCode = subcategory?.entitySubtypeCode;

    if (!entityCode || !entityTypeCode) return false;

    const row = findBestOverrideRow(
        LAND_EQUIP_SHAPE_OVERRIDES,
        String(entityCode),
        String(entityTypeCode),
        entitySubtypeCode != null ? String(entitySubtypeCode) : "*",
    );
    if (!row || !row.primitiveRecipe) return false;

    const { instances, bodyHalfH, footprint } = getCompiledLandEquipRecipe(row.primitiveRecipe);
    const insts = instances.slice(0, 24);
    if (insts.length === 0) return false;
    const sidcForMobility = mobilitySidcForUnit(u, viewer);
    const shouldApplyVehicleFamilyAddons = shouldApplyMobilityToCategory(category?.id);
    const mobilityIds = shouldApplyVehicleFamilyAddons
        ? vehicleMobilityPartIdsForSidc(u.id, sidcForMobility)
        : [];
    const hullAddonIds = shouldApplyVehicleFamilyAddons
        ? vehicleHullAddonPartIdsForSidc(u.id, sidcForMobility)
        : [];

    const existingHelperIds = landEquipPartIdsForUnit(viewer, u.id);
    clearGroundOverrideArtifacts(viewer, u, {
        removeSidcCap: true,
        preserveEntityIds: [u.id, ...existingHelperIds, ...mobilityIds, ...hullAddonIds],
    });
    clearGroundOverrideEntityGraphics(ent);
    removeManPortableIconCap(viewer, u.id);

    const pose = makeGroundPrimitivePoseProperties(viewer, u, bodyHalfH, footprint);
    ent.position = pose.position as any;
    ent.orientation = pose.orientation as any;
    applyPathGraphics(ent, u);

    const fillCss = extractGroupFill(u);
    const baseColor = safeCssColor(fillCss).withAlpha(1.0);
    const outlineColor = Cesium.Color.BLACK.withAlpha(0.75);

    applyLandEquipPrimitiveGraphics(ent, insts[0], baseColor, outlineColor);
    ent.billboard = undefined as any;
    ent.point = undefined as any;
    ent.label = u.name ? makeSideLabel(u.name, HeightReference.NONE, "left", u.labelOffsetPxY ?? -12) : undefined;
    applyGroundPrimitiveLabelOffset(ent.label);
    if (ent.label && Array.isArray((row as any).labelOffset) && (row as any).labelOffset.length === 3) {
        const [x = -GROUND_UNIT_LABEL_LEFT_OFFSET_M, y = 0, z = GROUND_UNIT_LABEL_UP_OFFSET_M] = (row as any).labelOffset;
        // Recipe labelOffset is treated as local [x,y,z]; for label eyeOffset we use [x,z,y].
        ent.label.eyeOffset = new Cesium.Cartesian3(
            Number.isFinite(x) ? x : -GROUND_UNIT_LABEL_LEFT_OFFSET_M,
            Number.isFinite(z) ? z : GROUND_UNIT_LABEL_UP_OFFSET_M,
            Number.isFinite(y) ? y : 0,
        );
    }

    const preserveIds: string[] = [u.id];
    for (let i = 1; i < insts.length; i += 1) {
        const inst = insts[i];
        const id = landEquipPartId(u.id, i);
        preserveIds.push(id);

        const partEnt = viewer.entities.getById(id) ?? viewer.entities.add({ id });
        (partEnt as any).__landEquipHelper = true;
        tagEntityWithUnitId(partEnt as any, u.id);

        partEnt.label = undefined as any;
        partEnt.billboard = undefined as any;
        partEnt.point = undefined as any;
        safelyDisableEntityPolyline(partEnt);

        partEnt.position = new CallbackProperty((time) => {
            return offsetFromEntityLocal(ent, time, inst.east, inst.north, inst.up);
        }, false) as any;

        partEnt.orientation = new CallbackProperty((time) => {
            const p = (partEnt.position as any)?.getValue?.(time);
            if (!p) return undefined;
            return landEquipOrientationForInstance(inst, p);
        }, false) as any;

        applyLandEquipPrimitiveGraphics(partEnt, inst, baseColor, outlineColor);
        partEnt.show = true;
    }

    clearGroundOverrideArtifacts(viewer, u, {
        removeSidcCap: false,
        preserveEntityIds: [...preserveIds, ...mobilityIds, ...hullAddonIds],
    });

    if (shouldApplyVehicleFamilyAddons) {
        applyVehicleHullAddons(ent, u, viewer, baseColor, sidcForMobility);
        applyVehicleMobilityAddons(ent, u, viewer, baseColor, sidcForMobility);
    }

    applyAvailability(ent, u);
    return true;
}

function applyWeaponDualTubeLauncherGraphics(
    ent: Cesium.Entity,
    u: UnitRenderable,
    viewer?: Cesium.Viewer,
) {
    const tubeIds = [
        launcherTubeEntityId(u.id, 0),
        launcherTubeEntityId(u.id, 1),
        launcherTubeEntityId(u.id, 2),
        launcherTubeEntityId(u.id, 3),
    ] as const;
    clearGroundOverrideArtifacts(viewer, u, {
        removeSidcCap: true,
        preserveEntityIds: [...tubeIds],
    });
    clearGroundOverrideEntityGraphics(ent);

    const size = LAUNCHER_BASE_SIZE_M;
    const centerOffset = size.z / 2;
    const pose = makeGroundPrimitivePoseProperties(viewer, u, centerOffset, {
        halfWidthMeters: size.x / 2,
        halfLengthMeters: size.y / 2,
    });
    ent.position = pose.position as any;
    ent.orientation = pose.orientation as any;
    applyPathGraphics(ent, u);

    const fillCss = extractGroupFill(u);
    const color = safeCssColor(fillCss).withAlpha(1.0);

    ent.box = new Cesium.BoxGraphics({
        dimensions: new Cartesian3(size.x, size.y, size.z),
        material: color,
        heightReference: HeightReference.NONE,
        outline: true,
        outlineColor: Color.BLACK,
    });
    safelyDisableEntityCylinder(ent);
    ent.polygon = undefined as any;
    ent.billboard = undefined as any;
    ent.point = undefined as any;
    safelyDisableEntityPolyline(ent);

    ent.label = u.name ? makeSideLabel(u.name, HeightReference.NONE, "left", u.labelOffsetPxY ?? -12) : undefined;
    applyGroundPrimitiveLabelOffset(ent.label);

    if (viewer) {
        const tubes = tubeIds.map((id) => viewer.entities.getById(id) ?? viewer.entities.add({ id }));

        const makeTubePosition = (east: number, north: number) =>
            new Cesium.CallbackProperty((time) => {
                try {
                    const base = ent.position?.getValue?.(time);
                    if (!base) return undefined;
                    return offsetFromEntityLocal(
                        ent,
                        time,
                        east,
                        north,
                        LAUNCHER_TUBE_UP_OFFSET_M,
                    );
                } catch {
                    return undefined;
                }
            }, false) as any;

        const tubeGraphics = () => new Cesium.CylinderGraphics({
            length: LAUNCHER_TUBE_LENGTH_M,
            topRadius: LAUNCHER_TUBE_RADIUS_M,
            bottomRadius: LAUNCHER_TUBE_RADIUS_M,
            fill: true,
            material: color,
            outline: true,
            outlineColor: Color.BLACK.withAlpha(0.75),
            heightReference: HeightReference.NONE,
        });

        const offsets: Array<{ east: number; north: number }> = [
            { east: -LAUNCHER_TUBE_GRID_HALF_SPACING_M, north: LAUNCHER_TUBE_GRID_CENTER_NORTH_M + LAUNCHER_TUBE_GRID_HALF_SPACING_M },
            { east: LAUNCHER_TUBE_GRID_HALF_SPACING_M, north: LAUNCHER_TUBE_GRID_CENTER_NORTH_M + LAUNCHER_TUBE_GRID_HALF_SPACING_M },
            { east: -LAUNCHER_TUBE_GRID_HALF_SPACING_M, north: LAUNCHER_TUBE_GRID_CENTER_NORTH_M - LAUNCHER_TUBE_GRID_HALF_SPACING_M },
            { east: LAUNCHER_TUBE_GRID_HALF_SPACING_M, north: LAUNCHER_TUBE_GRID_CENTER_NORTH_M - LAUNCHER_TUBE_GRID_HALF_SPACING_M },
        ];

        tubes.forEach((tube, i) => {
            const o = offsets[i];
            tube.position = makeTubePosition(o.east, o.north);
            tube.orientation = ent.orientation;
            tube.cylinder = tubeGraphics();
            tube.billboard = undefined as any;
            safelyDisableEntityBox(tube);
            tube.polygon = undefined as any;
            tube.point = undefined as any;
            safelyDisableEntityPolyline(tube);
            tube.label = undefined as any;
            tube.show = ent.show !== false;
        });
    }

    applyAvailability(ent, u);
}

function applyWeaponSixTubeLauncherGraphics(
    ent: Cesium.Entity,
    u: UnitRenderable,
    viewer?: Cesium.Viewer,
) {
    const tubeIds = launcherTubeIdsForShape(u.id, "weaponSixTubeLauncher");
    clearGroundOverrideArtifacts(viewer, u, {
        removeSidcCap: true,
        preserveEntityIds: [...tubeIds],
    });
    clearGroundOverrideEntityGraphics(ent);

    const size = LAUNCHER_BASE_SIZE_M;
    const centerOffset = size.z / 2;
    const pose = makeGroundPrimitivePoseProperties(viewer, u, centerOffset, {
        halfWidthMeters: size.x / 2,
        halfLengthMeters: size.y / 2,
    });
    ent.position = pose.position as any;
    ent.orientation = pose.orientation as any;
    applyPathGraphics(ent, u);

    const fillCss = extractGroupFill(u);
    const color = safeCssColor(fillCss).withAlpha(1.0);

    ent.box = new Cesium.BoxGraphics({
        dimensions: new Cartesian3(size.x, size.y, size.z),
        material: color,
        heightReference: HeightReference.NONE,
        outline: true,
        outlineColor: Color.BLACK,
    });
    safelyDisableEntityCylinder(ent);
    ent.polygon = undefined as any;
    ent.billboard = undefined as any;
    ent.point = undefined as any;
    safelyDisableEntityPolyline(ent);

    ent.label = u.name ? makeSideLabel(u.name, HeightReference.NONE, "left", u.labelOffsetPxY ?? -12) : undefined;
    applyGroundPrimitiveLabelOffset(ent.label);

    if (viewer) {
        const tubes = tubeIds.map((id) => viewer.entities.getById(id) ?? viewer.entities.add({ id }));

        const makeTubePosition = (east: number, north: number) =>
            new Cesium.CallbackProperty((time) => {
                try {
                    const base = ent.position?.getValue?.(time);
                    if (!base) return undefined;
                    return offsetFromEntityLocal(
                        ent,
                        time,
                        east,
                        north,
                        LAUNCHER_TUBE_UP_OFFSET_M,
                    );
                } catch {
                    return undefined;
                }
            }, false) as any;

        const makeTubeOrientation = (tube: Cesium.Entity) =>
            new Cesium.CallbackProperty((time) => {
                try {
                    const p = tube.position?.getValue?.(time);
                    if (!p) return undefined;
                    const hpr = new Cesium.HeadingPitchRoll(
                        Cesium.Math.toRadians(LAUNCHER_SIX_TUBE_HEADING_DEG),
                        Cesium.Math.toRadians(LAUNCHER_SIX_TUBE_PITCH_DEG),
                        0,
                    );
                    return Cesium.Transforms.headingPitchRollQuaternion(p, hpr);
                } catch {
                    return undefined;
                }
            }, false) as any;

        const tubeGraphics = () => new Cesium.CylinderGraphics({
            length: LAUNCHER_TUBE_LENGTH_M,
            topRadius: LAUNCHER_TUBE_RADIUS_M,
            bottomRadius: LAUNCHER_TUBE_RADIUS_M,
            fill: true,
            material: color,
            outline: true,
            outlineColor: Color.BLACK.withAlpha(0.75),
            heightReference: HeightReference.NONE,
        });

        const eastOffsets = [
            -LAUNCHER_SIX_TUBE_GRID_SPACING_M,
            0,
            LAUNCHER_SIX_TUBE_GRID_SPACING_M,
        ];
        const northOffsets = [
            LAUNCHER_SIX_TUBE_GRID_CENTER_NORTH_M + LAUNCHER_SIX_TUBE_GRID_HALF_SPACING_M,
            LAUNCHER_SIX_TUBE_GRID_CENTER_NORTH_M - LAUNCHER_SIX_TUBE_GRID_HALF_SPACING_M,
        ];
        const offsets: Array<{ east: number; north: number }> = [
            { east: eastOffsets[0], north: northOffsets[0] },
            { east: eastOffsets[1], north: northOffsets[0] },
            { east: eastOffsets[2], north: northOffsets[0] },
            { east: eastOffsets[0], north: northOffsets[1] },
            { east: eastOffsets[1], north: northOffsets[1] },
            { east: eastOffsets[2], north: northOffsets[1] },
        ];

        tubes.forEach((tube, i) => {
            const o = offsets[i];
            tube.position = makeTubePosition(o.east, o.north);
            tube.orientation = makeTubeOrientation(tube);
            tube.cylinder = tubeGraphics();
            tube.billboard = undefined as any;
            safelyDisableEntityBox(tube);
            tube.polygon = undefined as any;
            tube.point = undefined as any;
            safelyDisableEntityPolyline(tube);
            tube.label = undefined as any;
            tagEntityWithUnitId(tube as any, u.id);
            tube.show = ent.show !== false;
        });
    }

    applyAvailability(ent, u);
}

function applyWeaponSingleLargeTubeLauncherGraphics(
    ent: Cesium.Entity,
    u: UnitRenderable,
    viewer?: Cesium.Viewer,
) {
    const tubeIds = launcherTubeIdsForShape(u.id, "weaponSingleLargeTubeLauncher");
    clearGroundOverrideArtifacts(viewer, u, {
        removeSidcCap: true,
        preserveEntityIds: [...tubeIds],
    });
    clearGroundOverrideEntityGraphics(ent);

    const size = LAUNCHER_BASE_SIZE_M;
    const centerOffset = size.z / 2;
    const pose = makeGroundPrimitivePoseProperties(viewer, u, centerOffset, {
        halfWidthMeters: size.x / 2,
        halfLengthMeters: size.y / 2,
    });
    ent.position = pose.position as any;
    ent.orientation = pose.orientation as any;
    applyPathGraphics(ent, u);

    const fillCss = extractGroupFill(u);
    const color = safeCssColor(fillCss).withAlpha(1.0);

    ent.box = new Cesium.BoxGraphics({
        dimensions: new Cartesian3(size.x, size.y, size.z),
        material: color,
        heightReference: HeightReference.NONE,
        outline: true,
        outlineColor: Color.BLACK,
    });
    safelyDisableEntityCylinder(ent);
    ent.polygon = undefined as any;
    ent.billboard = undefined as any;
    ent.point = undefined as any;
    safelyDisableEntityPolyline(ent);

    ent.label = u.name ? makeSideLabel(u.name, HeightReference.NONE, "left", u.labelOffsetPxY ?? -12) : undefined;
    applyGroundPrimitiveLabelOffset(ent.label);

    if (viewer) {
        const tube = viewer.entities.getById(tubeIds[0]) ?? viewer.entities.add({ id: tubeIds[0] });
        tube.position = new Cesium.CallbackProperty((time) => {
            try {
                return offsetFromEntityLocal(ent, time, 0, LAUNCHER_SINGLE_TUBE_NORTH_M, LAUNCHER_SINGLE_TUBE_UP_M);
            } catch {
                return undefined;
            }
        }, false) as any;
        tube.orientation = ent.orientation;
        tube.cylinder = new Cesium.CylinderGraphics({
            length: LAUNCHER_SINGLE_TUBE_LENGTH_M,
            topRadius: LAUNCHER_SINGLE_TUBE_RADIUS_M,
            bottomRadius: LAUNCHER_SINGLE_TUBE_RADIUS_M,
            fill: true,
            material: color,
            outline: true,
            outlineColor: Color.BLACK.withAlpha(0.75),
            heightReference: HeightReference.NONE,
        });
        tube.billboard = undefined as any;
        safelyDisableEntityBox(tube);
        tube.polygon = undefined as any;
        tube.point = undefined as any;
        safelyDisableEntityPolyline(tube);
        tube.label = undefined as any;
        tagEntityWithUnitId(tube as any, u.id);
        tube.show = ent.show !== false;
    }

    applyAvailability(ent, u);
}

function isTriangleWeaponSidc(sidc?: string): boolean {
    return resolveSidcShapeOverride(sidc) === "weaponTriangle";
}

function isDualTubeLauncherSidc(sidc?: string): boolean {
    return resolveSidcShapeOverride(sidc) === "weaponDualTubeLauncher";
}

function isSixTubeLauncherSidc(sidc?: string): boolean {
    return resolveSidcShapeOverride(sidc) === "weaponSixTubeLauncher";
}

function isSingleLargeTubeLauncherSidc(sidc?: string): boolean {
    return resolveSidcShapeOverride(sidc) === "weaponSingleLargeTubeLauncher";
}

function manPortableIconCapIdForUnit(id: string) {
    return `${id}${MAN_PORTABLE_ICON_CAP_SUFFIX}`;
}

function manPortableIconDecalIdForUnit(id: string) {
    return `${id}${MAN_PORTABLE_ICON_DECAL_SUFFIX}`;
}

function isManPortableIconCapId(id: string) {
    return id.endsWith(MAN_PORTABLE_ICON_CAP_SUFFIX);
}

function isManPortableIconDecalId(id: string) {
    return id.endsWith(MAN_PORTABLE_ICON_DECAL_SUFFIX);
}

function baseIdFromManPortableIconCapId(id: string) {
    return id.slice(0, -MAN_PORTABLE_ICON_CAP_SUFFIX.length);
}

function baseIdFromManPortableIconDecalId(id: string) {
    return id.slice(0, -MAN_PORTABLE_ICON_DECAL_SUFFIX.length);
}

function removeManPortableIconCap(viewer: Cesium.Viewer | undefined, unitId: string) {
    if (!viewer) return;
    viewer.entities.removeById(manPortableIconCapIdForUnit(unitId));
    viewer.entities.removeById(manPortableIconDecalIdForUnit(unitId));
}

function clearGroundOverrideArtifacts(
    viewer: Cesium.Viewer | undefined,
    u: UnitRenderable,
    opts?: { removeSidcCap?: boolean; preserveEntityIds?: string[] },
) {
    setToeWinsUnderbarPolicy(u, false);
    if (!viewer) return;
    hideToeUnderbar(viewer, u.id);

    const unitEnt = viewer.entities.getById(u.id);
    if (unitEnt) {
        // Stop any billboard-era label aligner from mutating ground-primitive labels.
        try {
            const old = (unitEnt as any).__labelAlignTick as (() => void) | undefined;
            if (old) viewer.scene.postRender.removeEventListener(old);
            (unitEnt as any).__labelAlignTick = undefined;
        } catch { /* ignore */ }

        // Reset/clear pedestal polyline attached to the unit entity.
        try { (unitEnt as any).__hasPedestalPolyline = false; } catch { /* ignore */ }
        try { safelyDisableEntityPolyline(unitEnt); } catch { /* ignore */ }
    }

    // Clear all known helper entities that can linger across style switches.
    try { viewer.entities.removeById(toeUnderbarIdForUnit(u.id)); } catch { /* ignore */ }
    try { viewer.entities.removeById(pedestalIdForUnit(u.id)); } catch { /* ignore */ }
    try { viewer.entities.removeById(pedestalLinesIdForUnit(u.id)); } catch { /* ignore */ }
    if (opts?.removeSidcCap) {
        removeManPortableIconCap(viewer, u.id);
    }

    // Safety net: remove any helper entities following "<unitId>__*" naming.
    // This catches stale icon/pedestal artifacts created by older render paths.
    try {
        const prefix = `${u.id}__`;
        const preserve = new Set<string>(opts?.preserveEntityIds ?? []);
        const extraIds = (viewer.entities.values ?? [])
            .map((e: any) => e?.id)
            .filter((id: any) => typeof id === "string" && id.startsWith(prefix) && id !== u.id && !preserve.has(id)) as string[];
        for (const id of extraIds) {
            try { viewer.entities.removeById(id); } catch { /* ignore */ }
        }
    } catch { /* ignore */ }
}

function clearGroundOverrideEntityGraphics(ent: Cesium.Entity) {
    try { ent.billboard = undefined as any; } catch { /* ignore */ }
}

function safelyDisableEntityPolyline(ent: Cesium.Entity) {
    try {
        const polyline: any = ent.polyline;
        if (!polyline) return;

        // Cesium dynamic polyline updater dereferences entity.polyline.positions
        // without guarding entity.polyline; keep an inert polyline object alive.
        polyline.show = false;
        if (!polyline.positions) {
            polyline.positions = new Cesium.ConstantProperty([]);
        }
    } catch { /* ignore */ }
}
function safelyDisableEntityBox(ent: Cesium.Entity) {
    try {
        const box: any = ent.box;
        if (!box) return;

        box.show = false;
        if (!box.heightReference) {
            box.heightReference = new Cesium.ConstantProperty(Cesium.HeightReference.NONE);
        }
        if (!box.dimensions) {
            box.dimensions = new Cesium.ConstantProperty(new Cesium.Cartesian3(1, 1, 1));
        }
    } catch { /* ignore */ }
}

function safelyDisableEntityCylinder(ent: Cesium.Entity) {
    try {
        const cylinder: any = ent.cylinder;
        if (!cylinder) return;

        cylinder.show = false;
        if (!cylinder.heightReference) {
            cylinder.heightReference = new Cesium.ConstantProperty(Cesium.HeightReference.NONE);
        }
        if (!cylinder.length) {
            cylinder.length = new Cesium.ConstantProperty(1);
        }
        if (!cylinder.topRadius) {
            cylinder.topRadius = new Cesium.ConstantProperty(0.5);
        }
        if (!cylinder.bottomRadius) {
            cylinder.bottomRadius = new Cesium.ConstantProperty(0.5);
        }
    } catch { /* ignore */ }
}

function resolvedSidcForRendering(
    u: UnitRenderable,
    viewer?: Cesium.Viewer,
    sidcOverride?: string,
): string | undefined {
    const sidcEventPreferred =
        (typeof sidcOverride === "string" && sidcOverride.trim())
            ? sidcOverride
            : effectiveSidc(u, viewer);
    const sidcUnit = preferredUnitSidc(u);

    const eventShape = resolveSidcShapeOverride(sidcEventPreferred);
    const unitShape = resolveSidcShapeOverride(sidcUnit);

    // If unit SIDC has a custom ground-shape override but the event SIDC does not,
    // prefer the unit SIDC so artifact cleanup and render branching stay consistent.
    if (unitShape && !eventShape) return sidcUnit;

    return sidcEventPreferred ?? sidcUnit;
}

function isManPortableWeaponException(
    u: UnitRenderable,
    viewer?: Cesium.Viewer,
    sidcOverride?: string,
): boolean {
    const sidc = resolvedSidcForRendering(u, viewer, sidcOverride);
    return isGroundPrimitiveSidc(sidc);
}

function applyLandEquipmentWeaponsGraphics(
    ent: Cesium.Entity,
    u: UnitRenderable,
    viewer?: Cesium.Viewer,
    subcategoryId?: string,
) {
    (u as any).__landEquipmentSubcategoryId = subcategoryId;
    const sidcForRendering = resolvedSidcForRendering(u, viewer);
    if (isSingleLargeTubeLauncherSidc(sidcForRendering)) {
        applyWeaponSingleLargeTubeLauncherGraphics(ent, u, viewer);
        return;
    }
    if (isSixTubeLauncherSidc(sidcForRendering)) {
        applyWeaponSixTubeLauncherGraphics(ent, u, viewer);
        return;
    }
    if (isDualTubeLauncherSidc(sidcForRendering)) {
        applyWeaponDualTubeLauncherGraphics(ent, u, viewer);
        return;
    }
    const useTriangleOverride =
        (subcategoryId && WEAPON_TRIANGLE_SUBCATEGORY_IDS.has(subcategoryId))
        || isTriangleWeaponSidc(sidcForRendering);

    if (useTriangleOverride) {
        clearGroundOverrideArtifacts(viewer, u, { removeSidcCap: true });
        clearGroundOverrideEntityGraphics(ent);

        const centerOffset = WEAPON_TRIANGLE_HEIGHT_M / 2;
        const triHeight = (Math.sqrt(3) / 2) * WEAPON_TRIANGLE_SIDE_M;
        const pose = makeGroundPrimitivePoseProperties(viewer, u, centerOffset, {
            halfWidthMeters: WEAPON_TRIANGLE_SIDE_M / 2,
            halfLengthMeters: (2 * triHeight) / 3,
        });
    ent.position = pose.position as any;
    ent.orientation = pose.orientation as any;
        applyPathGraphics(ent, u);

        const fillCss = extractGroupFill(u);
        const color = safeCssColor(fillCss).withAlpha(1.0);

        ent.billboard = undefined as any;
        ent.point = undefined as any;
        safelyDisableEntityBox(ent);
        safelyDisableEntityCylinder(ent);

        ent.polygon = new Cesium.PolygonGraphics({
            hierarchy: new Cesium.CallbackProperty((time) => {
                try {
                    const p = ent.position?.getValue?.(time);
                    if (!p) return undefined;
                    return makeEquilateralTrianglePolygonHierarchy(p, WEAPON_TRIANGLE_SIDE_M);
                } catch {
                    return undefined;
                }
            }, false) as any,
            perPositionHeight: true,
            extrudedHeight: new Cesium.CallbackProperty((time) => {
                try {
                    const p = ent.position?.getValue?.(time);
                    if (!p) return undefined;
                    const c = Cartographic.fromCartesian(p);
                    return (c.height ?? 0) + WEAPON_TRIANGLE_HEIGHT_M;
                } catch {
                    return undefined;
                }
            }, false) as any,
            material: color,
            outline: true,
            outlineColor: Color.BLACK.withAlpha(0.75),
        });

        ent.label = u.name ? makeSideLabel(u.name, HeightReference.NONE, "left", u.labelOffsetPxY ?? -12) : undefined;
        applyGroundPrimitiveLabelOffset(ent.label);

        applyAvailability(ent, u);
        return;
    }

    const dims = getManPortableDimensions();
    const capRadius = (MAN_PORTABLE_DEBUG_VISUALS ? dims.radius * 2 : MAN_PORTABLE_ICON_CAP_DIAMETER_M) / 2;
    const decalRadius = capRadius;
    const pose = makeGroundPrimitivePoseProperties(viewer, u, dims.height / 2, {
        halfWidthMeters: dims.radius,
        halfLengthMeters: dims.radius,
    });
    ent.position = pose.position as any;
    ent.orientation = pose.orientation as any;
    applyPathGraphics(ent, u);

    const fillCss = extractGroupFill(u);
    const sideColor = safeCssColor(fillCss).withAlpha(1.0);
    const color = MAN_PORTABLE_DEBUG_VISUALS ? sideColor.brighten(0.35, new Color()) : sideColor;
    (u as any).__iconLiftPx = 0;
    if (viewer) uninstallIconLiftTick(viewer, ent);
    try {
        if (viewer) {
            const old = (ent as any).__labelAlignTick as (() => void) | undefined;
            if (old) viewer.scene.postRender.removeEventListener(old);
            (ent as any).__labelAlignTick = undefined;
        }
    } catch { /* ignore */ }

    ent.billboard = undefined as any;
    ent.point = undefined as any;
    safelyDisableEntityBox(ent);
    ent.polygon = undefined as any;

    ent.cylinder = new Cesium.CylinderGraphics({
        length: dims.height,
        topRadius: dims.radius,
        bottomRadius: dims.radius,
        fill: true,
        material: color,
        outline: false,
        heightReference: HeightReference.NONE,
    });

    // Category-specific label rule for man-portable weapons only.
    ent.label = u.name ? makeSideLabel(u.name, HeightReference.NONE, "left", u.labelOffsetPxY ?? -12) : undefined;
    applyGroundPrimitiveLabelOffset(ent.label);

    const sidcForCap = resolvedSidcForRendering(u, viewer);
    // Use side-tinted SIDC art so logo color matches cylinder side color.
    const fillHex = normalizeHex(fillCss);
    const cachedCapIcon =
        sidcForCap ? getSidcIconSync(sidcForCap, { fillColor: fillHex }, 96) : undefined;
    const rawIconUrl = cachedCapIcon ?? buildIconUrlSync(u, viewer);
    const iconUrl =
        (typeof rawIconUrl === "string" && rawIconUrl.length > 0)
            ? sanitizeIconUrlForImageLoad(rawIconUrl)
            : undefined;
    if (viewer) {
        const capId = manPortableIconCapIdForUnit(u.id);
        const decalId = manPortableIconDecalIdForUnit(u.id);
        const capEnt = viewer.entities.getById(capId) ?? viewer.entities.add({ id: capId });
        const decalEnt = viewer.entities.getById(decalId) ?? viewer.entities.add({ id: decalId });

        capEnt.position = new CallbackProperty((time) => {
            try {
                // Anchor cap in the unit's local oriented frame so it remains attached
                // even when terrain-conform tilt is active.
                return offsetFromEntityLocal(
                    ent,
                    time,
                    0,
                    0,
                    (dims.height / 2) + MAN_PORTABLE_ICON_CAP_RAISE_M,
                );
            } catch {
                return undefined;
            }
        }, false) as any;

        capEnt.billboard = undefined as any;
        capEnt.label = undefined as any;
        capEnt.point = undefined as any;
        safelyDisableEntityBox(capEnt);
        safelyDisableEntityCylinder(capEnt);
        capEnt.ellipse = undefined as any;
        safelyDisableEntityPolyline(capEnt);
        // Base cap is always solid side-colored so top circle remains visible.
        capEnt.polygon = new Cesium.PolygonGraphics({
            hierarchy: new Cesium.CallbackProperty((time) => {
                try {
                    const p = capEnt.position?.getValue?.(time);
                    if (!p) return undefined;
                    const q = ent.orientation?.getValue?.(time) as Cesium.Quaternion | undefined;
                    return makeOrientedCirclePolygonHierarchy(p, q, capRadius, 48);
                } catch {
                    return undefined;
                }
            }, false) as any,
            perPositionHeight: true,
            material: color,
            outline: true,
            outlineColor: Color.BLACK.withAlpha(0.75),
        });
        capEnt.show = ent.show !== false;

        decalEnt.position = new CallbackProperty((time) => {
            try {
                return offsetFromEntityLocal(
                    ent,
                    time,
                    0,
                    0,
                    (dims.height / 2) + MAN_PORTABLE_ICON_CAP_RAISE_M + MAN_PORTABLE_ICON_DECAL_RAISE_M,
                );
            } catch {
                return undefined;
            }
        }, false) as any;

        decalEnt.billboard = undefined as any;
        decalEnt.label = undefined as any;
        decalEnt.point = undefined as any;
        safelyDisableEntityBox(decalEnt);
        safelyDisableEntityCylinder(decalEnt);
        safelyDisableEntityPolyline(decalEnt);
        decalEnt.ellipse = undefined as any;

        if (typeof iconUrl === "string" && iconUrl.length > 0) {
            decalEnt.billboard = undefined as any;
            // Horizontal world-space circular decal using polygon geometry (meter units).
            decalEnt.polygon = new Cesium.PolygonGraphics({
                hierarchy: new Cesium.CallbackProperty((time) => {
                    try {
                        const p = decalEnt.position?.getValue?.(time);
                        if (!p) return undefined;
                        const q = ent.orientation?.getValue?.(time) as Cesium.Quaternion | undefined;
                        return makeOrientedCirclePolygonHierarchy(p, q, decalRadius, 48);
                    } catch {
                        return undefined;
                    }
                }, false) as any,
                perPositionHeight: true,
                material: new Cesium.ImageMaterialProperty({
                    image: iconUrl,
                    color: Color.WHITE,
                    transparent: true,
                }),
                outline: false,
            });
            decalEnt.show = ent.show !== false;
        } else {
            decalEnt.billboard = undefined as any;
            decalEnt.ellipse = undefined as any;
            decalEnt.polygon = undefined as any;
            decalEnt.show = false;
        }

    }

    applyAvailability(ent, u);
}

function applyLandEquipmentGraphics(
    ent: Cesium.Entity,
    u: UnitRenderable,
    viewer?: Cesium.Viewer,
    sidcHint?: string,
) {
    const sidc = sidcHint ?? effectiveSidc(u, viewer) ?? preferredUnitSidc(u);
    const category = resolveLandEquipmentCategoryFromSidc(sidc);
    const subcategory = resolveLandEquipmentSubcategoryFromSidc(sidc);

    (u as any).__landEquipmentCategoryId = category?.id;
    (u as any).__landEquipmentSubcategoryId = subcategory?.id;

    if (!category) {
        removeManPortableIconCap(viewer, u.id);
        applyBillboardGraphics(ent, u, viewer);
        return;
    }

    // Default behavior stays billboard. Carve out explicit exceptions only.
    if (category.id === "weapons-weapon-system") {
        applyLandEquipmentWeaponsGraphics(ent, u, viewer, subcategory?.id);
        return;
    }

    if (category.id === "vehicles") {
        if (isVehicleTankTurretSidc(sidc)) {
            applyVehicleTankTurretGraphics(ent, u, viewer);
            return;
        }
        if (isVehicleIfvTurretSidc(sidc)) {
            applyVehicleIfvTurretGraphics(ent, u, viewer);
            return;
        }
        if (isVehicleApcAmbulanceSidc(sidc)) {
            applyVehicleApcAmbulanceGraphics(ent, u, viewer);
            return;
        }
        if (isVehicleApcModuleSidc(sidc)) {
            applyVehicleApcModuleGraphics(ent, u, viewer);
            return;
        }
        if (isVehicleReconMastSidc(sidc)) {
            applyVehicleReconMastGraphics(ent, u, viewer);
            return;
        }
        if (isVehicleCargoModuleSidc(sidc)) {
            applyVehicleCargoModuleGraphics(ent, u, viewer);
            return;
        }
        if (isVehicleCommandMastSidc(sidc)) {
            applyVehicleCommandMastGraphics(ent, u, viewer);
            return;
        }
        if (isVehicleRecoveryRigSidc(sidc)) {
            applyVehicleRecoveryRigGraphics(ent, u, viewer);
            return;
        }
        if (isVehicleArmoredTurretSidc(sidc)) {
            applyVehicleArmoredTurretGraphics(ent, u, viewer);
            return;
        }
        if (isVehicleRecoveryBoomSidc(sidc)) {
            applyVehicleRecoveryBoomGraphics(ent, u, viewer);
            return;
        }
        clearGroundOverrideArtifacts(viewer, u, { removeSidcCap: true });
        applyVehicleBlockGraphics(ent, u, viewer);
        return;
    }

    const categoryUsesVehicleHullPipeline =
        category.id === "civilian-vehicles"
        || category.id === "utility-vehicles"
        || category.id === "law-enforcement"
        || category.id === "emergency-operation";
    if (categoryUsesVehicleHullPipeline) {
        clearGroundOverrideArtifacts(viewer, u, { removeSidcCap: true });
        applyVehicleBlockGraphics(ent, u, viewer);
        return;
    }

    if (viewer) {
        const applied = applyLandEquipmentRecipeOverride(ent, u, viewer, category, subcategory);
        if (applied) return;
    }

    removeManPortableIconCap(viewer, u.id);
    applyBillboardGraphics(ent, u, viewer);
}

function applySymbolAwareBillboardGraphics(
    ent: Cesium.Entity,
    u: UnitRenderable,
    viewer?: Cesium.Viewer,
    sidcHint?: string,
) {
    const sidcEvent =
        (typeof sidcHint === "string" && sidcHint.trim())
            ? sidcHint
            : effectiveSidc(u, viewer);
    const sidcUnit = preferredUnitSidc(u);
    const sidc = sidcEvent ?? sidcUnit;
    if (shouldDebugSidc(u.id)) {
        logSidcDebug("applySymbolAwareBillboardGraphics", {
            unitId: u.id,
            sidcHint,
            sidcEvent,
            sidcUnit,
            sidcChosen: sidc,
            shapeEvent: resolveSidcShapeOverride(sidcEvent),
            shapeUnit: resolveSidcShapeOverride(sidcUnit),
            isLandEquipmentEvent: isLandEquipmentSidc(sidcEvent),
            isLandEquipmentUnit: isLandEquipmentSidc(sidcUnit),
        });
    }

    // Prefer event SIDC for timeline correctness, but allow unit SIDC fallback so
    // freshly added/edited ORBAT units render overrides immediately.
    const shapeOverride =
        resolveSidcShapeOverride(sidcEvent)
        ?? resolveSidcShapeOverride(sidcUnit);

    if (shapeOverride === "vehicleTankTurret" || isVehicleTankTurretSidc(sidc)) {
        applyVehicleTankTurretGraphics(ent, u, viewer);
        return;
    }

    if (shapeOverride === "vehicleIfvTurret" || isVehicleIfvTurretSidc(sidc)) {
        applyVehicleIfvTurretGraphics(ent, u, viewer);
        return;
    }

    if (shapeOverride === "vehicleApcAmbulance" || isVehicleApcAmbulanceSidc(sidc)) {
        applyVehicleApcAmbulanceGraphics(ent, u, viewer);
        return;
    }

    if (shapeOverride === "vehicleApcModule" || isVehicleApcModuleSidc(sidc)) {
        applyVehicleApcModuleGraphics(ent, u, viewer);
        return;
    }

    if (shapeOverride === "vehicleReconMast" || isVehicleReconMastSidc(sidc)) {
        applyVehicleReconMastGraphics(ent, u, viewer);
        return;
    }

    if (shapeOverride === "vehicleCargoModule" || isVehicleCargoModuleSidc(sidc)) {
        applyVehicleCargoModuleGraphics(ent, u, viewer);
        return;
    }

    if (shapeOverride === "vehicleCommandMast" || isVehicleCommandMastSidc(sidc)) {
        applyVehicleCommandMastGraphics(ent, u, viewer);
        return;
    }

    if (shapeOverride === "vehicleRecoveryRig" || isVehicleRecoveryRigSidc(sidc)) {
        applyVehicleRecoveryRigGraphics(ent, u, viewer);
        return;
    }

    if (shapeOverride === "vehicleArmoredTurret" || isVehicleArmoredTurretSidc(sidc)) {
        applyVehicleArmoredTurretGraphics(ent, u, viewer);
        return;
    }

    if (shapeOverride === "vehicleRecoveryBoom" || isVehicleRecoveryBoomSidc(sidc)) {
        applyVehicleRecoveryBoomGraphics(ent, u, viewer);
        return;
    }

    if (shapeOverride === "vehicleBox" || isFixedVehicleBlockSidc(sidc)) {
        clearGroundOverrideArtifacts(viewer, u, { removeSidcCap: true });
        applyVehicleBlockGraphics(ent, u, viewer);
        return;
    }

    if (isLandEquipmentSidc(sidcEvent) || isLandEquipmentSidc(sidcUnit)) {
        const sidcForLandEquipment =
            shapeOverride != null
                ? (resolveSidcShapeOverride(sidcEvent) ? sidcEvent : sidcUnit)
                : sidc;
        applyLandEquipmentGraphics(ent, u, viewer, sidcForLandEquipment);
        return;
    }
    applyBillboardGraphics(ent, u, viewer);
}


/* ------------------------ Event-time helpers (NEW) ------------------------ */

/** Inspect the source unit's event list at time t. */
function getSnapshotFromEvents(uSrc: any, tMs: number): { onMap: boolean; loc?: [number, number]; sidc?: string } {
    const events: any[] = Array.isArray(uSrc?.state) ? uSrc.state : [];
    if (events.length === 0) {
        // If no events, default to unit-level state
        const baseLoc = uSrc?._state?.location ?? uSrc?.location;
        const onMap = !!(Array.isArray(baseLoc) && baseLoc.length >= 2);
        const sidc = uSrc?.sidc;
        return { onMap, loc: onMap ? [baseLoc[0], baseLoc[1]] : undefined, sidc };
    }

    // Find last event at/ before t
    let lastEvt: any | undefined;
    for (const e of events) {
        if (typeof e?.t !== "number") continue;
        if (e.t <= tMs && (!lastEvt || e.t > lastEvt.t)) lastEvt = e;
    }

    if (!lastEvt) {
        // No prior event; treat as "before first event": on/off map based on initial state
        const initLoc = uSrc?._state?.location ?? uSrc?.location;
        const onMap = !!(Array.isArray(initLoc) && initLoc.length >= 2);
        return { onMap, loc: onMap ? [initLoc[0], initLoc[1]] : undefined, sidc: uSrc?.sidc };
    }

    const hasNull = Object.prototype.hasOwnProperty.call(lastEvt, "location") && lastEvt.location === null;
    const locArr = Array.isArray(lastEvt.location) ? lastEvt.location as [number, number] : undefined;
    const sidc = lastEvt.sidc ?? uSrc?.sidc;

    return { onMap: !hasNull, loc: locArr, sidc };
}

function findLastEventAtOrBefore(uSrc: any, tMs: number): any | undefined {
    const evts: any[] = Array.isArray(uSrc?.state) ? uSrc.state : [];
    let best: any | undefined;
    for (const e of evts) {
        if (typeof e?.t !== "number") continue;
        if (e.t <= tMs && (!best || e.t > best.t)) best = e;
    }
    return best;
}

function hasAnyNonNullLocationEvent(uSrc: any): boolean {
    const evts: any[] = Array.isArray(uSrc?.state) ? uSrc.state : [];
    return evts.some(e => Array.isArray(e?.location) && e.location.length >= 2);
}

function lastSidcAtOrBefore(uSrc: any, tMs: number): string | undefined {
    const evts: any[] = Array.isArray(uSrc?.state) ? uSrc.state : [];
    let bestSidc: string | undefined = (uSrc as any)?.__baseSidc ?? uSrc?.sidc;
    let bestT = -Infinity;
    for (const e of evts) {
        const te = evtTime(e); if (te == null) continue;
        if (te <= tMs && typeof e.sidc === "string" && te >= bestT) {
            bestT = te;
            bestSidc = e.sidc;
        }
    }
    return bestSidc;
}

/** Decide visibility and position like 2-D: visible unless last =t event says location:null. */
type SnapshotAtTime = { onMap: boolean; lon?: number; lat?: number; sidc?: string };

function computeSnapshot(u: UnitRenderable, tMs: number): SnapshotAtTime {
    const src = (u as any).__sourceUnit ?? u;

    // Visibility: OFF only if the most recent <= t event that mentions 'location' sets it to null
    const lastLocEvt = lastLocEventAtOrBefore(src, tMs);
    const explicitlyOff = !!(lastLocEvt && Object.prototype.hasOwnProperty.call(lastLocEvt, "location") && lastLocEvt.location === null);

    // Position: prefer dynamic interpolator; else progressively relax
    let pos: { lon: number; lat: number; alt?: number } | undefined;

    try {
        if (typeof u.getPositionAtTime === "function") {
            pos = u.getPositionAtTime(tMs);
        } else {
            pos = getUnitPositionAtTime(src, tMs);
        }
    } catch { /* ignore */ }

    if (!pos) {
        // (a) last event = t with explicit non-null location
        if (lastLocEvt && Array.isArray(lastLocEvt.location)) {
            pos = { lon: lastLocEvt.location[0], lat: lastLocEvt.location[1] };
        } else {
            // (b) base/initial location
            const baseLoc = src?._state?.location ?? (src as any).location;
            if (Array.isArray(baseLoc)) {
                pos = { lon: baseLoc[0], lat: baseLoc[1] };
            } else {
                // (c) earliest future non-null location (so unit appears before its first event)
                const fut = firstFutureNonNullLocEvent(src, tMs);
                if (fut && Array.isArray(fut.location)) {
                    pos = { lon: fut.location[0], lat: fut.location[1] };
                } else if (typeof u.lon === "number" && typeof u.lat === "number") {
                    // (d) final fallback to renderable's own lon/lat if provided
                    pos = { lon: u.lon, lat: u.lat };
                }
            }
        }
    }

    // ON if not explicitly turned off and we can determine any plausible position
    const onMap = !explicitlyOff && !!pos;

    // SIDC in effect:
    // - explicit SIDC event at/= t wins for timeline correctness
    // - otherwise prefer current unit SIDC so ORBAT edits apply immediately
    const sidc = lastExplicitSidcEventAtOrBefore(src, tMs) ?? preferredUnitSidc(u);

    return { onMap, lon: pos?.lon, lat: pos?.lat, sidc };
}

function sanitizeIconUrlForImageLoad(url: string): string {
    // data:/blob: URIs must NOT contain a query string.
    // Also: callers sometimes pass whitespace-padded strings; normalize early.
    if (!url) return url;
    url = String(url).trim();
    if (!url) return url;

    if (url.startsWith("data:") || url.startsWith("blob:")) {
        const q = url.indexOf("?");
        return q >= 0 ? url.slice(0, q) : url;
    }
    return url;
}

function shouldAppendCacheBuster(url: string): boolean {
    if (!url) return false;
    url = String(url).trim();
    if (!url) return false;

    // Never cache-bust data:/blob: URIs; adding `?cb=...` makes them invalid in Chromium.
    if (url.startsWith("data:") || url.startsWith("blob:")) return false;

    // Avoid cache-busting URLs that are already cache-busted.
    return url.indexOf("cb=") < 0;
}

/** Apply a SIDC change in-place to an existing entity+renderable. */
function buildIconUrlForSidc(u: UnitRenderable, sidc?: string): string | undefined {
    if (!sidc) return u.iconUrl;

    // 1) app-level hook
    const hook = (window as any)?.__symbolUrlFromSidc;
    if (typeof hook === "function") {
        try { return hook(sidc, u); } catch { }
    }

    // 2) patch existing sidc= param
    if (u.iconUrl && /[?&]sidc=/i.test(u.iconUrl)) {
        return u.iconUrl.replace(/([?&]sidc=)[^&]*/i, `$1${encodeURIComponent(sidc)}`);
    }

    // 3) append sidc= param
    if (u.iconUrl) {
        const sep = u.iconUrl.includes("?") ? "&" : "?";
        return `${u.iconUrl}${sep}sidc=${encodeURIComponent(sidc)}`;
    }

    // 4) no known base ? allow hook to supply later; return undefined
    return undefined;
}

function tryGlobalUnitIconBuilder(u: UnitRenderable, sidc?: string): string | undefined {
    const f = (window as any)?.__buildIconUrlForUnit;
    if (typeof f === "function") {
        try { return f(u, sidc); } catch { }
    }
    return undefined;
}

function applySidcChange(
    ent: Cesium.Entity,
    u: UnitRenderable,
    sidc?: string,
    viewer?: Cesium.Viewer,
    tMs?: number
) {
    if (!sidc) return;

    const toeWins = Boolean((u as any).__toeWinsUnderbar);

    // 1) Persist RAW SIDC (truth)
    u.sidc = sidc;
    if (shouldDebugSidc(u.id)) {
        logSidcDebug("applySidcChange.begin", {
            unitId: u.id,
            sidcIncoming: sidc,
            sidcEffective: effectiveSidc(u, viewer),
            sidcPreferredUnit: preferredUnitSidc(u),
            isGroundException: isManPortableWeaponException(u, viewer, sidc),
        });
    }
    try {
        const src: any = (u as any).__sourceUnit;
        if (src && typeof src === "object") {
            // IMPORTANT: do NOT mutate src.sidc during time-scrubs. That field is treated as the
            // "baseline" SIDC before any events, and changing it will break historical playback.
            // We only annotate a non-semantic field for debugging/inspection.
            (src as any).__lastRenderedSidc = sidc;
        }
    } catch { /* ignore */ }

    // Exception path: non-billboard ground primitives own their rendering.
    if (isManPortableWeaponException(u, viewer, sidc)) {
        setToeWinsUnderbarPolicy(u, false);
        if (viewer) hideToeUnderbar(viewer, u.id);
        ent.billboard = undefined as any;
        applySymbolAwareBillboardGraphics(ent, u, viewer as any, sidc);
        if (shouldDebugSidc(u.id)) {
            logSidcDebug("applySidcChange.groundException", {
                unitId: u.id,
                sidcIncoming: sidc,
                shape: resolveSidcShapeOverride(sidc),
            });
        }
        return;
    }

    const hex = normalizeHex(extractGroupFill(u));

    // 2) Presentation SIDC used ONLY for icon generation
    const sidcForIcon = toeWins ? stripSidcMenuUnderbarEncoding(sidc) : sidc;

    // Prefer an app-provided builder when TOE is NOT winning.
    let baseUrl =
        (!toeWins ? (tryGlobalUnitIconBuilder(u, sidcForIcon) ?? undefined) : undefined) ??
        buildIconUrlForSidc(u, sidcForIcon);

    // If we don’t have a usable URL, try to construct a recolorable URL or use sync cache
    if (!baseUrl || baseUrl.startsWith("data:")) {
        const base = getGlobalSymbolBase?.();
        if (hex && base) {
            const rebuilt = urlFromBaseAndSidc(base, sidcForIcon, ICON_PX);
            baseUrl = withSymbolColor(rebuilt, hex) ?? rebuilt;
        } else {
            // NOTE: correct arg order
            const cached = getSidcIconSync(sidcForIcon, { fillColor: hex }, ICON_PX);
            if (typeof cached === "string") baseUrl = cached;
        }
    }

    if (!baseUrl) {
        ent.billboard = undefined as any;
        applySymbolAwareBillboardGraphics(ent, u, viewer as any);
        return;
    }

    (u as any).iconUrl = baseUrl;

    // Cache-buster (network URLs only).
    // Appending query params to data: (and blob:) URLs produces invalid URLs and will spam the console.
    let url = baseUrl;
    if (!url.startsWith("data:") && !url.startsWith("blob:")) {
        const sep = url.includes("?") ? "&" : "?";
        url = `${url}${sep}cb=${(tMs ?? Date.now()) & 0xffff}`;
    }

    // Ensure color is on the URL (no-op for data: URLs).
    url = withSymbolColor(url, hex) ?? url;

    // Billboard update
    if (ent.billboard) {
        (ent.billboard as any).image = url;
    } else {
        ent.point = undefined as any;
        ent.billboard = new Cesium.BillboardGraphics({
            image: url,
            verticalOrigin: VerticalOrigin.BOTTOM,
            horizontalOrigin: HorizontalOrigin.CENTER,
            heightReference:
                (u.clampToGround !== false && (u.alt == null || u.alt === 0))
                    ? HeightReference.CLAMP_TO_GROUND
                    : HeightReference.RELATIVE_TO_GROUND,
            disableDepthTestDistance: 50_000,
            scaleByDistance: new Cesium.NearFarScalar(800, 1.0, 2_000_000, 0.4),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 10_000_000.0),
        });
    }
    try { (ent.billboard as any).color = undefined; } catch { /* ignore */ }

    if (ent.label && viewer) {
        alignLabelToIconLeftEdge(viewer, ent, u, /*padPx=*/ 2);
    }
    if (viewer) installIconLiftTick(viewer, ent, u);
    applyIconLift(ent, u);
    viewer?.scene.requestRender();
}


/* ----------------------------- Adapter (public API) --------------------------- */

function replaceBaseImageryLayer(viewer: Cesium.Viewer, provider: Cesium.ImageryProvider) {
    const layers = viewer.imageryLayers;
    const added = layers.addImageryProvider(provider, 0);

    if (baseImageryLayer && !baseImageryLayer.isDestroyed()) {
        try {
            layers.remove(baseImageryLayer, true);
        } catch { }
    }
    baseImageryLayer = added;
    viewer.scene.requestRender();
}

function refreshGroupIndexFromScenario() {
    try {
        const storeLike = (window as any).__scenario?.store ?? (window as any).__scenario ?? null;
        if (!storeLike) return;
        const idx = buildIndexFromScenarioStore(storeLike);
        if (idx && idx.size > 0) groupColorIdx = idx;
    } catch { }
}

function providerFromTemplate(
    url: string,
    opts?: {
        minLevel?: number;
        maxLevel?: number;
        attribution?: string;
        geographic?: boolean;
        subdomains?: string[] | string;
    }
) {
    const { minLevel = 0, maxLevel = 19, attribution, geographic = false, subdomains } = opts ?? {};

    let u = url;
    if (u.startsWith("//")) u = (location?.protocol ?? "https:") + u;

    const provider = new Cesium.UrlTemplateImageryProvider({
        url: u,
        minimumLevel: minLevel,
        maximumLevel: maxLevel,
        credit: attribution,
        tilingScheme: geographic ? new Cesium.GeographicTilingScheme() : new Cesium.WebMercatorTilingScheme(),
        subdomains: typeof subdomains === "string" ? subdomains.split("") : subdomains,
    });

    // --- Resilience: return a transparent tile instead of rejecting ---
    // This prevents Cesium from spamming “Failed to obtain image tile…”
    // for sparse/partial overlays and transient fetch failures.
    const blankCanvas = (() => {
        const c = document.createElement("canvas");
        c.width = 256;
        c.height = 256;
        return c;
    })();

    const origRequestImage = provider.requestImage?.bind(provider);

    const isCancelledRequest = (request?: any) => {
        try {
            const RS = (Cesium as any).RequestState;
            return (
                request?.cancelled === true ||
                (RS && request?.state === RS.CANCELLED)
            );
        } catch {
            return false;
        }
    };

    const is404Like = (err: any) => {
        const sc =
            err?.statusCode ??
            err?.response?.status ??
            err?.response?.statusCode;

        if (sc === 404 || sc === 410) return true;
        const msg = String(err?.message ?? "");
        return msg.includes("404") || msg.includes("410");
    };

    provider.requestImage = async (x: number, y: number, level: number, request?: any) => {
        // Hard clamp at runtime too (defensive)
        const minL = (provider as any).minimumLevel ?? minLevel;
        const maxL = (provider as any).maximumLevel ?? maxLevel;
        if (typeof minL === "number" && level < minL) return blankCanvas;
        if (typeof maxL === "number" && level > maxL) return blankCanvas;

        // IMPORTANT: preserve Cesium throttling behavior
        const maybe = origRequestImage?.(x, y, level, request);
        if (!maybe) return undefined; // don't convert "throttled" into "blank-loaded"

        try {
            const img = await maybe;
            // If Cesium gives us nothing (rare), treat it as "try again later"
            return (img as any) ?? undefined;
        } catch (err) {
            // Preserve cancellation so Cesium can retry properly
            if (isCancelledRequest(request)) return undefined;

            // For overlays: ANY failure becomes transparent instead of fatal.
            // This suppresses TileProviderError spam and keeps the globe rendering.
            return blankCanvas;
        }
    };


    return provider;
}




export function createGlobeAdapter(): GlobePort {
    let api: GlobeApi | null = null;

    async function sampleSurfaceHeightMeters(lon: number, lat: number): Promise<number | undefined> {
        if (!api) return undefined;

        const viewer = api.viewer;

        // Fast path: height from currently-loaded globe tiles if available
        try {
            const carto = Cartographic.fromDegrees(lon, lat);
            const h0 = (viewer.scene.globe as any)?.getHeight?.(carto);
            if (typeof h0 === "number" && Number.isFinite(h0)) return h0;
        } catch {
            // ignore
        }

        // Reliable path: terrain sampling (your file already exports sampleHeight(viewer, lon, lat))
        try {
            const h = await sampleHeight(viewer, lon, lat);
            if (typeof h === "number" && Number.isFinite(h)) return h;
        } catch {
            // ignore
        }

        return undefined;
    }

    let wx: WeatherSkyController | null = null;
    const { getByKey } = makeImageryProviders();

    // track last visibility+sidc we applied so we only touch Cesium when needed
    const lastOnMap = new Map<string, boolean>();
    const lastSidc = new Map<string, string | undefined>();

    // ---------- Filter-aware setUnits implementation ----------
    const setUnitsInner = (units: UnitRenderable[]) => {
        if (!api) return;
        const viewer = api.viewer;
        if (!groupColorIdx || groupColorIdx.size === 0) refreshGroupIndexFromScenario();

        const raw = Array.isArray(units) ? units.slice() : [...(units as any)];
        _lastUnitsInput = raw;

        const unitsArr = raw.filter(u => (typeof _unitFilter === "function" ? _unitFilter(u) : true) && !isHidden2D(u));

        try {
            const removedByFilter: string[] = [];
            const removedByHidden: string[] = [];
            for (const u of raw) {
                const passFilter = (typeof _unitFilter === "function" ? _unitFilter(u) : true);
                const hidden = isHidden2D(u);
                if (!passFilter) removedByFilter.push(u.id);
                else if (hidden) removedByHidden.push(u.id);
            }
            (window as any).__mentatLastSetUnits = {
                rawCount: raw.length,
                filteredCount: unitsArr.length,
                rawIds: raw.map(u => u.id).slice(0, 200),
                keptIds: unitsArr.map(u => u.id).slice(0, 200),
                removedByFilter,
                removedByHidden,
            };
        } catch { }

        applyGroupFillColors(unitsArr, groupColorIdx, { mirrorToIcon: false });

        const seen = new Set<string>();
        for (const u of unitsArr) {
            seen.add(u.id);
            const ent = viewer.entities.getById(u.id) ?? viewer.entities.add({ id: u.id });
            entities.set(u.id, ent);
            unitMeta.set(u.id, u);

            // Preserve an immutable "baseline" SIDC for time playback.
            // We MUST NOT mutate src.sidc during scrubs; instead, keep the original here.
            try {
                const src: any = (u as any).__sourceUnit ?? u;
                if ((src as any).__baseSidc == null && typeof src?.sidc === "string" && src.sidc.trim()) {
                    (src as any).__baseSidc = src.sidc;
                }
                if ((u as any).__baseSidc == null) {
                    (u as any).__baseSidc = (src as any).__baseSidc ?? src?.sidc ?? u.sidc;
                }
            } catch { /* ignore */ }

            // Make the entity reliably pickable by external click-selection bridges.
            // (Some Cesium pick results hand back primitives, but Entities are always reachable
            // through picked.id; giving them a unitId property makes the bridge more robust.)
            try {
                const props: any = (ent as any).properties;
                if (!props) {
                    (ent as any).properties = new Cesium.PropertyBag({ unitId: new Cesium.ConstantProperty(u.id) });
                } else {
                    (props as any).unitId = new Cesium.ConstantProperty(u.id);
                }
            } catch { /* ignore */ }

            // Resolve the event SIDC using scenario time; if not available yet, fall back to the unit's earliest known state time.
            // DO NOT use Date.now() here (it will force "always after" for historical scenarios).
            const tNow = currentViewerMs(viewer);
            const tFallback = Number((u as any)?._state?.t ?? (u as any)?.state?.[0]?.t ?? 0);
            const tEff = (typeof tNow === "number" && Number.isFinite(tNow)) ? tNow : tFallback;

            const sidcNow =
                (typeof tEff === "number" && Number.isFinite(tEff) && tEff > 0)
                    ? lastSidcAtOrBefore((u as any).__sourceUnit ?? u, tEff)
                    : undefined;

            // Only store if we actually resolved something
            if (sidcNow !== undefined) lastSidc.set(u.id, sidcNow);

            const renderMode = resolveSymbol3DRenderMode(u);
            if (renderMode === "installationFootprint") {
                applyInstallationGraphics(ent as any, u as any, {
                    getParentById: (id) => unitMeta.get(id),
                    defaultSize: { x: 20, y: 20, z: 10 },
                    style: "footprint",
                });
                applyAvailability(ent, u);
                const tNow = currentViewerMs(viewer);
                const tFallback = Number((u as any)?._state?.t ?? (u as any)?.state?.[0]?.t ?? 0);
                const tEff = (typeof tNow === "number" && Number.isFinite(tNow)) ? tNow : tFallback;

                updateToeUnderbarForUnit(viewer, ent as any, u, tEff);

            } else if (renderMode === "block") {
                applyBlockGraphics(ent, u);
                hideToeUnderbar(viewer, u.id);
            } else {
                const sidcForRender = resolvedSidcForRendering(u, api.viewer);
                const isGroundException = isManPortableWeaponException(u, api.viewer, sidcForRender);
                const tNow = currentViewerMs(viewer);
                const tFallback = Number((u as any)?._state?.t ?? (u as any)?.state?.[0]?.t ?? 0);
                const tEff = (typeof tNow === "number" && Number.isFinite(tNow)) ? tNow : tFallback;

                if (isGroundException) {
                    setToeWinsUnderbarPolicy(u, false);
                    hideToeUnderbar(viewer, u.id);
                } else {
                    // Pre-seed TOE-wins policy BEFORE first billboard build so SIDC underbar gets stripped on first render.
                    if (Boolean((effectiveToeUnderbarEnabled as any)?.value ?? toeMapUnderbarEnabled.value)) {
                        try {
                            const baseUnit = getScenarioUnitById(u.id) ?? (u as any).__sourceUnit ?? u;
                            const includeSubs = readPersonnelIncludeSubs();
                            const pct = computeToePctForUnit(baseUnit, tEff, includeSubs, getScenarioUnitById);
                            const toeDataAvailableForUnit = pct != null && Number.isFinite(pct);
                            setToeWinsUnderbarPolicy(u, toeDataAvailableForUnit);
                        } catch {
                            setToeWinsUnderbarPolicy(u, false);
                        }
                    } else {
                        setToeWinsUnderbarPolicy(u, false);
                    }
                }

                applySymbolAwareBillboardGraphics(ent, u, api.viewer);
                if (!isGroundException) {
                    updateToeUnderbarForUnit(viewer, ent as any, u, tNow);
                }
            }

            // default visible; time updates may hide it
            ent.show = true;
        }

        // prune anything not in list
        const toRemove: any[] = [];
        (api.viewer.entities.values as any).forEach((e: any) => {
            const id = e.id as string;

            // Keep underbar entities if their base unit is still present
            if (isToeUnderbarId(id)) {
                const baseId = baseIdFromToeUnderbarId(id);
                if (seen.has(baseId)) return;
            }
            // Keep pedestal entities if their base unit is still present
            if (isPedestalId(id)) {
                const baseId = baseIdFromPedestalId(id);
                if (seen.has(baseId)) return;
            }

            // Keep pedestal LINE entities if their base unit is still present
            if (isPedestalLinesId(id)) {
                const baseId = baseIdFromPedestalLinesId(id);
                if (seen.has(baseId)) return;
            }
            // Keep man-portable top-cap entities if their base unit is still present
            if (isManPortableIconCapId(id)) {
                const baseId = baseIdFromManPortableIconCapId(id);
                if (seen.has(baseId)) return;
            }
            if (isManPortableIconDecalId(id)) {
                const baseId = baseIdFromManPortableIconDecalId(id);
                if (seen.has(baseId)) return;
            }
            // Keep launcher tube child entities if their base unit is still present.
            if (isLauncherTubeId(id)) {
                const baseId = baseIdFromLauncherTubeId(id);
                if (seen.has(baseId)) return;
            }
            if (isLandEquipPartId(id)) {
                const baseId = baseIdFromLandEquipPartId(id);
                if (seen.has(baseId)) return;
            }
            if (isVehicleMobilityPartId(id)) {
                const baseId = baseIdFromVehicleMobilityPartId(id);
                if (seen.has(baseId)) return;
            }
            if (isVehicleHullAddonPartId(id)) {
                const baseId = baseIdFromVehicleHullAddonPartId(id);
                if (seen.has(baseId)) return;
            }
            if (isTankPartId(id)) {
                const baseId = baseIdFromTankPartId(id);
                if (seen.has(baseId)) return;
            }
            if (isIfvPartId(id)) {
                const baseId = baseIdFromIfvPartId(id);
                if (seen.has(baseId)) return;
            }
            if (isArmoredHullPartId(id)) {
                const baseId = baseIdFromArmoredHullPartId(id);
                if (seen.has(baseId)) return;
            }
            if (isArmoredPartId(id)) {
                const baseId = baseIdFromArmoredPartId(id);
                if (seen.has(baseId)) return;
            }
            if (isRecoveryPartId(id)) {
                const baseId = baseIdFromRecoveryPartId(id);
                if (seen.has(baseId)) return;
            }
            if (isApcPartId(id)) {
                const baseId = baseIdFromApcPartId(id);
                if (seen.has(baseId)) return;
            }
            if (isApcAmbulancePartId(id)) {
                const baseId = baseIdFromApcAmbulancePartId(id);
                if (seen.has(baseId)) return;
            }
            if (isReconPartId(id)) {
                const baseId = baseIdFromReconPartId(id);
                if (seen.has(baseId)) return;
            }
            if (isCargoPartId(id)) {
                const baseId = baseIdFromCargoPartId(id);
                if (seen.has(baseId)) return;
            }
            if (isCommandPartId(id)) {
                const baseId = baseIdFromCommandPartId(id);
                if (seen.has(baseId)) return;
            }
            if (isRecoveryRigPartId(id)) {
                const baseId = baseIdFromRecoveryRigPartId(id);
                if (seen.has(baseId)) return;
            }
            if (!seen.has(id)) toRemove.push(id);
        });
        toRemove.forEach((id) => {
            api!.viewer.entities.removeById(id);
            entities.delete(id);
            unitMeta.delete(id);
            lastOnMap.delete(id);
            lastSidc.delete(id);
        });

        viewer.scene.requestRender();
        publishDebug(viewer);
    };
    // ---------------------------------------------------------

    function reapplyVisibility() {
        setUnitsInner(_lastUnitsInput);
    }

/** Resolve final style for a range ring, mirroring 2D logic:
 *  - prefer ring.style
 *  - else group style from store.state.rangeRingGroupMap[ring.group]?.style
 *  - fall back to {}
 */
function resolveRangeRingStyle(ring: any): any {
    if (!ring) return {};
    if (ring.style) return ring.style;

    try {
        const sc = (window as any).__scenario;
        const store = sc?.store ?? sc;
        const groupId = ring.group;
        if (groupId && store?.state?.rangeRingGroupMap) {
            const groupStyle = store.state.rangeRingGroupMap[groupId]?.style;
            if (groupStyle) return groupStyle;
        }
    } catch {
        // ignore
    }

    return {};
}

/**
 * 3D range-ring renderer:
 *  - Rings only exist when the unit is conceptually "on map" by event logic
 *    (i.e. after first non-null location event and not after a location:null).
 *  - Uses baseUnit._state.location like 2D for horizontal center when possible.
 *  - Does NOT rely on cleanupRangeRings for visibility; it manages .show itself
 *    and still adds ring IDs to activeRingIds so cleanup doesn't "kill" rings
 *    just because we're between events in time playback.
 */
function applyRangeRingsForSnapshot(
    unitId: string,
    u: UnitRenderable,
    snap: SnapshotAtTime,
    unitEnt: Cesium.Entity,
    viewer: Cesium.Viewer,
    now: Cesium.JulianDate | undefined,
    unitMap: any,
    activeRingIds: Set<string>,
    tMs: number,
) {
    // Global master switch: when off, we don't draw rings at all.
    if (!rangeRingsVisible) {
        return;
    }

    // Use the same base unit 2D uses
    const baseUnit: any = (u as any).__sourceUnit ?? unitMap?.[unitId] ?? u;
    const rings: any[] = baseUnit?.rangeRings;
    if (!Array.isArray(rings) || !rings.length) return;

    // -----------------------------
    // 0. Event-based "on map" semantics for rings
    //    - before first location event  ? no rings
    //    - last location event = null   ? no rings
    // -----------------------------
    let allowRingsNow = true;
    const events: any[] = Array.isArray(baseUnit?.state) ? baseUnit.state : [];

    if (events.length > 0) {
        const lastEvt = lastLocEventAtOrBefore(baseUnit, tMs);

        if (!lastEvt) {
            // Before the first location-bearing event ? treat as "not yet on map"
            allowRingsNow = false;
        } else if (
            Object.prototype.hasOwnProperty.call(lastEvt, "location") &&
            lastEvt.location === null
        ) {
            // Explicitly taken off map
            allowRingsNow = false;
        }
    }

    // -----------------------------
    // 1. Horizontal center (2D-compatible)
    //    2D uses unit._state.location as center; fall back to snapshot lon/lat
    // -----------------------------
    const stateLoc = baseUnit?._state?.location;
    const locFromSnap =
        (typeof snap.lon === "number" && typeof snap.lat === "number")
            ? [snap.lon, snap.lat]
            : undefined;

    const centerLonLat: [number, number] | undefined =
        Array.isArray(stateLoc) && stateLoc.length >= 2
            ? [stateLoc[0], stateLoc[1]]
            : locFromSnap;

    const haveCenter = !!centerLonLat;
    const canDrawRings = allowRingsNow && haveCenter && rangeRingsVisible;

    const [snapLon, snapLat] = centerLonLat ?? [NaN, NaN];

    // -----------------------------
    // 2. Base alt & height reference
    // -----------------------------
    const snapAlt = (snap as any)?.alt;
    const baseAlt = snapAlt ?? u?.alt ?? 0;

    const wouldClamp =
        u?.clampToGround !== false &&
        u?.alt == null &&
        snapAlt == null;

    const treatAsAgl = u?.altIsAgl !== false;

    const baseHeight =
        wouldClamp ? 0 : (treatAsAgl ? scaledAlt(baseAlt) : baseAlt);

    const hRef = unitHeightRef({
        ...u,
        alt: snapAlt ?? u?.alt,
    } as any);

    // Capture viewer safely for callbacks
    const safeViewer = viewer;

    // -----------------------------
    // 3. Per-ring loop (outer + optional inner)
    // -----------------------------
    for (let idx = 0; idx < rings.length; idx++) {
        const ring = rings[idx];
        if (!ring || ring.hidden) continue;

        const ringId = `rr:${unitId}:${ring.name ?? idx}`;
        activeRingIds.add(ringId); // always mark as "owned" by this unit

        // If we shouldn't draw rings at this time or we don't know the center,
        // just hide any existing ring entity (and its shell primitive) and skip
        if (!canDrawRings) {
            const existing = rangeRingEntities.get(ringId);
            if (existing) {
                existing.show = false;

                const prim = (existing as any).__primitive as Cesium.Primitive | undefined;
                if (prim) {
                    try {
                        viewer.scene.primitives.remove(prim);
                    } catch { /* ignore */ }
                    (existing as any).__primitive = undefined;
                }
            }

            // Hide any inner ring too, if it exists
            const innerId = `${ringId}::inner`;
            const innerExisting = rangeRingEntities.get(innerId);
            if (innerExisting) {
                innerExisting.show = false;
                const primInner = (innerExisting as any).__primitive as Cesium.Primitive | undefined;
                if (primInner) {
                    try {
                        viewer.scene.primitives.remove(primInner);
                    } catch { /* ignore */ }
                    (innerExisting as any).__primitive = undefined;
                }
            }

            continue; // nothing to draw this tick for this ring
        }

        // At this point, we *want* rings and we know where to place them.
        const [lonCenter, latCenter] = centerLonLat as [number, number];

        // Ensure we have an entity
        let ringEnt = rangeRingEntities.get(ringId);
        if (!ringEnt) {
            ringEnt = viewer.entities.add({ id: ringId });
            rangeRingEntities.set(ringId, ringEnt);
        }

        // -----------------------------
        // 4. Horizontal ranges
        // -----------------------------
        let outerMetersRaw = 0;
        try {
            outerMetersRaw = convertToMetric(ring.range, ring.uom || "km");
        } catch {
            outerMetersRaw = 0;
        }
        if (!outerMetersRaw || !Number.isFinite(outerMetersRaw)) {
            ringEnt.show = false;
            continue;
        }

        let innerMetersRaw = 0;
        if (ring.minRange != null) {
            try {
                innerMetersRaw = convertToMetric(ring.minRange, ring.uom || "km");
            } catch {
                innerMetersRaw = 0;
            }
        }

        const innerMeters = Math.max(0, Math.min(innerMetersRaw, outerMetersRaw));
        const outerMeters = Math.max(outerMetersRaw, innerMeters);

        let outerMinorMeters = outerMeters;
        if (ring.secondaryRange != null) {
            try {
                outerMinorMeters = convertToMetric(ring.secondaryRange, ring.uom || "km");
            } catch {
                outerMinorMeters = outerMeters;
            }
        }

        const innerMinorMeters =
            outerMeters > 0
                ? (outerMinorMeters * innerMeters) / outerMeters
                : innerMeters;

        // -----------------------------
        // 5. Vertical extent
        // -----------------------------
        const rawFloor =
            typeof ring.minVerticalMeters === "number" && Number.isFinite(ring.minVerticalMeters)
                ? Math.max(0, ring.minVerticalMeters)
                : 0;

        let rawCeil: number;
        if (typeof ring.maxVerticalMeters === "number" && Number.isFinite(ring.maxVerticalMeters)) {
            rawCeil = Math.max(rawFloor, ring.maxVerticalMeters);
        } else if (
            typeof ring.verticalMeters === "number" &&
            Number.isFinite(ring.verticalMeters) &&
            ring.verticalMeters > 0
        ) {
            rawCeil = rawFloor + ring.verticalMeters;
        } else {
            rawCeil = rawFloor;
        }

        let floorMeters = rawFloor;
        let ceilMeters = rawCeil;
        if (treatAsAgl) {
            floorMeters = scaledAlt(rawFloor);
            ceilMeters = scaledAlt(rawCeil);
        }

        const hasVerticalSlab = ceilMeters > floorMeters;
        const height = baseHeight + floorMeters;
        const extrudedHeight = hasVerticalSlab ? baseHeight + ceilMeters : undefined;

        // -----------------------------
        // 6. Style
        // -----------------------------
        const style = resolveRangeRingStyle(ring) as any;

        const strokeCss =
            style.stroke ??
            style.color ??
            "red";

        const strokeOpacity =
            typeof style.strokeOpacity === "number"
                ? style.strokeOpacity
                : typeof style.opacity === "number"
                ? style.opacity
                : 1.0;

        const outlineWidth =
            typeof style.width === "number" ? style.width : 2;

        const hasExplicitNoFill = style.fill === null;
        const fillCss =
            hasExplicitNoFill
                ? null
                : (style.fill ?? strokeCss);

        const fillOpacity =
            typeof style.fillOpacity === "number"
                ? style.fillOpacity
                : typeof style.opacity === "number"
                ? style.opacity
                : 0.15;

        const outlineColor = Color.fromCssColorString(strokeCss).withAlpha(strokeOpacity);

        const fillColor = fillCss
            ? Color.fromCssColorString(fillCss).withAlpha(fillOpacity)
            : Color.fromCssColorString(strokeCss).withAlpha(0);

        const shape = ring.shape ?? "circle";

        // -----------------------------
        // 7. Center-follow logic – piggyback directly on the unit entity
        // -----------------------------
        ringEnt.position = unitEnt.position;


        // -----------------------------
        // 8A. Square ? Rectangle
        // -----------------------------
        if (shape === "square") {
            const lon = lonCenter;
            const lat = latCenter;

            const R = 6378137;
            const latRad = (lat * Math.PI) / 180;

            const metersToLatDeg = (m: number) => (m / R) * (180 / Math.PI);
            const metersToLonDeg = (m: number) =>
                (m / (R * Math.cos(latRad))) * (180 / Math.PI);

            const halfX = outerMeters;
            const halfY = outerMinorMeters;

            const dLatN = metersToLatDeg(+halfY);
            const dLatS = -dLatN;
            const dLonE = metersToLonDeg(+halfX);
            const dLonW = -dLonE;

            const south = lat + dLatS;
            const north = lat + dLatN;
            const west = lon + dLonW;
            const east = lon + dLonE;

            const rect = Cesium.Rectangle.fromDegrees(west, south, east, north);

            const rectangle = new Cesium.RectangleGraphics({
                coordinates: rect,
                height,
                extrudedHeight,
                heightReference: hRef,
                extrudedHeightReference: hRef,
                material: fillColor,
                outline: true,
                outlineColor,
                outlineWidth,
            });

            (ringEnt as any).ellipse = undefined;
            (ringEnt as any).rectangle = rectangle;
            (ringEnt as any).ellipsoid = undefined;
            ringEnt.show = true;
            continue;
        }

        // 8B. Sphere / spheroid (shell or solid)
        if (shape === "sphere" || shape === "spheroid") {
            const radiusX = outerMeters;
            const radiusY = shape === "spheroid" ? outerMinorMeters : outerMeters;

            const verticalRadius =
                hasVerticalSlab
                    ? Math.max((ceilMeters - floorMeters) / 2, 1)
                    : outerMeters;

            const useShell = innerMeters > 0;

            // Compute center at current time for the shell
            let centerNow: Cesium.Cartesian3 | undefined;
            try {
                const posProp: any = ringEnt.position;
                if (posProp && typeof posProp.getValue === "function" && now) {
                    centerNow = posProp.getValue(now);
                } else if (posProp) {
                    centerNow = posProp as Cesium.Cartesian3;
                }
            } catch {
                centerNow = undefined;
            }

            if (!centerNow) {
                centerNow = Cesium.Cartesian3.fromDegrees(
                    lonCenter,
                    latCenter,
                    baseHeight,
                );
            }

                        const shellColor = fillColor; // includes alpha

            // Reuse existing primitive when possible; only create if missing.
            let prim = (ringEnt as any).__primitive as Cesium.Primitive | undefined;

            if (useShell && centerNow) {
                if (!prim) {
                    prim = buildSphericalShellPrimitive({
                        outerRadius: outerMeters,
                        innerRadius: innerMeters,
                        verticalRadius,
                        phiSegments: 32,
                        thetaSegments: 64,
                        center: centerNow,
                        color: shellColor,
                    });

                    viewer.scene.primitives.add(prim);
                    (ringEnt as any).__primitive = prim;
                } else {
                    // Only move the existing primitive so it follows the unit
                    prim.modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(centerNow);
                }

                // Make sure old graphic types are off
                (ringEnt as any).ellipse = undefined;
                (ringEnt as any).rectangle = undefined;
                (ringEnt as any).ellipsoid = undefined;
                ringEnt.show = true;
                continue;
            }

            // If we're not using a shell anymore but had one, remove it.
            if (prim && !useShell) {
                try {
                    viewer.scene.primitives.remove(prim);
                } catch { /* ignore */ }
                (ringEnt as any).__primitive = undefined;
            }

            // Fallback: solid ellipsoid
            const radii = new Cesium.Cartesian3(
                radiusX,
                radiusY,
                verticalRadius,
            );


            const ellipsoid = new Cesium.EllipsoidGraphics({
                radii,
                material: fillColor,
                fill: true,
                outline: true,
                outlineColor,
                outlineWidth,
            });

            (ringEnt as any).ellipse = undefined;
            (ringEnt as any).rectangle = undefined;
            (ringEnt as any).ellipsoid = ellipsoid;
            ringEnt.show = true;
            continue;
        }

        // -----------------------------
        // 8C. Circle / ellipse ? Ellipse
        // -----------------------------
        const semiMajorOuter = outerMeters;
        const semiMinorOuter =
            shape === "ellipse" ? outerMinorMeters : outerMeters;

        const ellipseOuter = new Cesium.EllipseGraphics({
            semiMajorAxis: semiMajorOuter,
            semiMinorAxis: semiMinorOuter,
            height,
            extrudedHeight,
            heightReference: hRef,
            extrudedHeightReference: hRef,
            material: fillColor,
            outline: true,
            outlineColor,
            outlineWidth,
        });

        (ringEnt as any).ellipse = ellipseOuter;
        (ringEnt as any).rectangle = undefined;
        (ringEnt as any).ellipsoid = undefined;
        ringEnt.show = true;

        // Inner "hole" ring if minRange > 0
        if (innerMeters > 0) {
            const innerId = `${ringId}::inner`;
            activeRingIds.add(innerId);

            let innerEnt = rangeRingEntities.get(innerId);
            if (!innerEnt) {
                innerEnt = viewer.entities.add({ id: innerId });
                rangeRingEntities.set(innerId, innerEnt);
            }

            innerEnt.position = ringEnt.position;
            (innerEnt as any).__followUnitCenter = true;

            const semiMajorInner = innerMeters;
            const semiMinorInner =
                shape === "ellipse" ? innerMinorMeters : innerMeters;

            const ellipseInner = new Cesium.EllipseGraphics({
                semiMajorAxis: semiMajorInner,
                semiMinorAxis: semiMinorInner,
                height,
                extrudedHeight,
                heightReference: hRef,
                extrudedHeightReference: hRef,
                material: Color.TRANSPARENT,
                outline: true,
                outlineColor,
                outlineWidth,
            });

            (innerEnt as any).ellipse = ellipseInner;
            (innerEnt as any).rectangle = undefined;
            (innerEnt as any).ellipsoid = undefined;
            innerEnt.show = true;
        }
    }
}

function cleanupRangeRings(viewer: Cesium.Viewer, activeIds: Set<string>) {
  for (const [rid, ent] of rangeRingEntities) {
    if (!activeIds.has(rid)) {
      ent.show = false;

      // Also remove any shell primitive we attached for this ring
      const prim = (ent as any).__primitive as Cesium.Primitive | undefined;
      if (prim) {
        try {
          viewer.scene.primitives.remove(prim);
        } catch {
          // ignore
        }
        (ent as any).__primitive = undefined;
      }
    }
  }
}



    /** Core: evaluate all units at time t and apply on/off map + sidc changes. */
function updateAllUnitsAtTime(tMs: number) {
    if (!api) return;
    const viewer = api.viewer;
    const now = viewer?.clock?.currentTime;

    // Track which ring entity ids are still valid this tick
    const activeRingIds = new Set<string>();

    // Recover the scenario unitMap once
    let store: any;
    try {
        const sc = (window as any).__scenario;
        store = sc?.store ?? sc;
    } catch {
        store = null;
    }
    const unitMap = store?.unitMap ?? store?.state?.unitMap ?? {};

    for (const [id, u] of unitMeta) {
        const ent = entities.get(id) ?? viewer.entities.getById(id);
        if (!ent) continue;

        // Respect filter + 2D hidden at all times
        const passes = (_unitFilter ? _unitFilter(u) : true) && !isHidden2D(u);
        if (!passes) {
            if (ent.show !== false) ent.show = false;
            hideToeUnderbar(viewer, id);
            removeManPortableIconCap(viewer, id);
            continue;
        }
        // Decide per events
        const snap = computeSnapshot(u, tMs);
        const sidcSnap = (typeof snap.sidc === "string" && snap.sidc.trim()) ? snap.sidc : undefined;
        const sidcForRender = resolvedSidcForRendering(u, viewer, sidcSnap);
        const isGroundException = isManPortableWeaponException(u, viewer, sidcForRender);

        // IMPORTANT: update TOE-vs-SIDC underbar policy BEFORE we (re)build the icon
        // for this timestamp. Otherwise a SIDC change at t can bake an underbar into
        // the icon using the *previous* policy (which then appears “cached”).
        if (snap.onMap) {
            if (isGroundException) {
                setToeWinsUnderbarPolicy(u, false);
                hideToeUnderbar(viewer, id);
                if (
                    isTriangleWeaponSidc(sidcForRender)
                    || isFixedVehicleBlockSidc(sidcForRender)
                    || isDualTubeLauncherSidc(sidcForRender)
                    || isSixTubeLauncherSidc(sidcForRender)
                    || isSingleLargeTubeLauncherSidc(sidcForRender)
                    || hasLandEquipRecipeOverrideForSidc(sidcForRender)
                ) {
                    const shape = resolveSidcShapeOverride(sidcForRender);
                    const preserve: string[] = [];
                    if (
                        shape === "weaponDualTubeLauncher"
                        || shape === "weaponSixTubeLauncher"
                        || shape === "weaponSingleLargeTubeLauncher"
                    ) {
                        preserve.push(...launcherTubeIdsForShape(id, shape));
                    }
                    if (shape === "vehicleTankTurret") {
                        preserve.push(...tankPartIdsForUnit(id));
                    }
                    if (shape === "vehicleIfvTurret") {
                        preserve.push(...ifvPartIdsForUnit(id));
                    }
                    if (shape === "vehicleArmoredTurret") {
                        preserve.push(...armoredPartIdsForUnit(id));
                    }
                    if (shape === "vehicleRecoveryBoom") {
                        preserve.push(...recoveryPartIdsForUnit(id));
                    }
                    if (shape === "vehicleApcModule") {
                        preserve.push(...apcPartIdsForUnit(id));
                    }
                    if (shape === "vehicleApcAmbulance") {
                        preserve.push(...apcAmbulancePartIdsForUnit(id));
                    }
                    if (shape === "vehicleReconMast") {
                        preserve.push(...reconPartIdsForUnit(id));
                    }
                    if (shape === "vehicleCargoModule") {
                        preserve.push(...cargoPartIdsForUnit(id));
                    }
                    if (shape === "vehicleCommandMast") {
                        preserve.push(...commandPartIdsForUnit(id));
                    }
                    if (shape === "vehicleRecoveryRig") {
                        preserve.push(...recoveryRigPartIdsForUnit(id));
                    }
                    if (
                        shape === "vehicleTankTurret"
                        || shape === "vehicleIfvTurret"
                        || shape === "vehicleArmoredTurret"
                        || shape === "vehicleRecoveryBoom"
                        || shape === "vehicleApcModule"
                        || shape === "vehicleApcAmbulance"
                        || shape === "vehicleReconMast"
                        || shape === "vehicleCargoModule"
                        || shape === "vehicleCommandMast"
                        || shape === "vehicleRecoveryRig"
                        || shape === "vehicleBox"
                    ) {
                        preserve.push(...armoredHullPartIdsForUnit(id));
                    }
                    preserve.push(...vehicleMobilityPartIdsForSidc(id, sidcForRender));
                    preserve.push(...landEquipPartIdsForUnit(viewer, id));
                    clearGroundOverrideArtifacts(viewer, u, {
                        removeSidcCap: true,
                        preserveEntityIds: preserve.length ? preserve : undefined,
                    });
                    clearGroundOverrideEntityGraphics(ent);
                }
            } else {
                updateToeUnderbarForUnit(viewer, ent as any, u, tMs);
            }
        } else {
            hideToeUnderbar(viewer, id);
        }

        // Apply show/hide based on onMap
        ent.show = snap.onMap;
        if (isGroundException) {
            const cap = viewer.entities.getById(manPortableIconCapIdForUnit(id));
            const decal = viewer.entities.getById(manPortableIconDecalIdForUnit(id));
            if (cap) cap.show = snap.onMap;
            if (decal) decal.show = snap.onMap;
        }

        // Visibility toggle (location=null ? off map)
        const prevOn = lastOnMap.get(id);
        if (prevOn !== snap.onMap || prevOn == null) {
            ent.show = snap.onMap;
            lastOnMap.set(id, snap.onMap);
        }

        // If on-map, update position only for STATIC units.
        if (snap.onMap && typeof snap.lon === "number" && typeof snap.lat === "number") {
            if (!hasDynamicPosition(u, ent)) {
                if (isGroundException) {
                    const centerOffset = groundPrimitiveCenterOffsetMeters(sidcForRender);
                    const footprint = groundPrimitiveFootprintForSidc(sidcForRender);
                    ent.position = new CallbackProperty(
                        () => terrainAwareProductCenterFromDegrees(
                            viewer,
                            snap.lon!,
                            snap.lat!,
                            centerOffset,
                            footprint,
                        ),
                        false,
                    ) as any;
                    ent.orientation = new CallbackProperty(
                        () => {
                            const pose = computeGroundConformPose(
                                (lon, lat) => terrainHeightMetersAtLonLatDeg(viewer, lon, lat),
                                {
                                    lonDeg: snap.lon!,
                                    latDeg: snap.lat!,
                                    footprint,
                                    clearanceMeters: GROUND_PRIMITIVE_CLEARANCE_M,
                                    includeCenterSample: true,
                                },
                            );
                            const pos = Cartesian3.fromDegrees(
                                snap.lon!,
                                snap.lat!,
                                pose.anchorHeightMeters + centerOffset,
                            );
                            return orientationFromGroundPose(pos, pose);
                        },
                        false,
                    ) as any;
                } else {
                    const wouldClamp = u.clampToGround !== false && u.alt == null;
                    const treatAsAgl = u?.altIsAgl !== false;
                    const baseAlt = u?.alt ?? 0;
                    const h = wouldClamp ? 0 : (treatAsAgl ? scaledAlt(baseAlt) : baseAlt);
                    setEntityPosition(ent, snap.lon, snap.lat, h);
                }
            }
        }

        // Apply SIDC changes using the resolved render SIDC so unit-level edits
        // can override stale/non-overridden event SIDC values.
        const sidcEvt = snap.sidc ?? (u as any).sidc;
        const sidcToApply = sidcForRender ?? sidcEvt;
        const prevSidc = lastSidc.get(id);
        const sidcOnBillboard = sidcFromBillboard(ent, now);
        const sidcMismatchFromBillboard = !isGroundException && sidcToApply !== sidcOnBillboard;
        if (shouldDebugSidc(id)) {
            logSidcDebug("updateAllUnitsAtTime.sidcDecision", {
                unitId: id,
                sidcSnap: snap.sidc,
                sidcEvt,
                sidcForRender,
                sidcToApply,
                prevSidc,
                sidcOnBillboard,
                sidcMismatchFromBillboard,
                isGroundException,
                shapeForRender: resolveSidcShapeOverride(sidcForRender),
            });
        }

        if (sidcToApply && (sidcToApply !== prevSidc || sidcMismatchFromBillboard)) {
            // Clear any memoized base so we don’t stick to an old data: URL
            try {
                if (u.iconUrl && u.iconUrl.startsWith("data:")) {
                    (u as any).iconUrl = undefined as any;
                }
            } catch { /* ignore */ }

            applySidcChange(ent, u, sidcToApply, viewer, tMs);

            // Book-keeping so we only patch when rendered SIDC actually changes
            lastSidc.set(id, sidcToApply);
            lastFillHex.delete(id);
        }

        // React to fill color changes (replace params)
        const curHex = normalizeHex(extractGroupFill(u));
        const prevHex = lastFillHex.get(id);

        if (curHex !== prevHex) {
            const bb = ent.billboard as Cesium.BillboardGraphics | undefined;

            const resolveImage = (): string | undefined => {
                if (!bb) return undefined;
                const img: any = bb.image;
                if (typeof img === "string") return img;
                if (img && typeof img.getValue === "function") {
                    try { return img.getValue(now); } catch { }
                }
                return undefined;
            };

            let imgUrl = resolveImage();
            if (imgUrl && typeof imgUrl === "string") {
                const nextUrl = withSymbolColor(imgUrl, curHex) ?? imgUrl;
                (bb as any).image = nextUrl;
            } else {
                // If we can't resolve a string URL, rebuild the billboard graphics safely
                applySymbolAwareBillboardGraphics(ent, u, viewer);
            }

            lastFillHex.set(id, curHex);
        }
        // ?? NEW: range rings around this unit
        applyRangeRingsForSnapshot(
            id,
            u,
            snap,
            ent,       // ?? pass the unit entity
            viewer,
            now,       // ?? pass the Cesium time actually driving billboards
            unitMap,
            activeRingIds,
            tMs,   
        );
    }

    // Remove any ring entities no longer associated with active units/rings
    cleanupRangeRings(viewer, activeRingIds);

    viewer.scene.requestRender?.();
}

    return {
        async mount(el) {
            const { getByKey } = makeImageryProviders();
            const base =
                getByKey("esriWorldImagery")?.create() ??
                new UrlTemplateImageryProvider({
                    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
                    credit: "\u00A9 OpenStreetMap contributors",
                    subdomains: "abc",
                });

            api = await useGlobe(el, { imageryProvider: base });
refreshGroupIndexFromScenario();
wx = new WeatherSkyController(api.viewer);

api.viewer.scene.globe.depthTestAgainstTerrain = true;

// publish viewer + maps for the console
publishDebug(api.viewer);
setSurfaceHeightSampler(sampleSurfaceHeightMeters);

            try {
                (window as any).MentatDebugSIDC = (id?: string) => {
                    const dbg = (window as any).MentatGlobeAdapterDebug;
                    const viewer = dbg?.viewer;
                    const t = viewer ? Cesium.JulianDate.toDate(viewer.clock.currentTime).getTime() : Date.now();

                    // Prefer our Map keys (exact ids we added), then Cesium as a fallback
                    let targetId = id;
                    if (!targetId) {
                        const firstKey = dbg?._entities && typeof dbg._entities.keys === "function"
                            ? Array.from(dbg._entities.keys())[0]
                            : undefined;
                        targetId = firstKey ?? viewer?.entities?.values?.[0]?.id;
                    }

                    const ent = targetId
                        ? (dbg?._entities?.get(targetId) ?? viewer?.entities?.getById?.(targetId))
                        : undefined;

                    const u = ent ? dbg?._unitMeta?.get(ent.id) : undefined;
                    const src = u?.__sourceUnit ?? u ?? null;

                    const sidcFromEvents = src ? (window as any).lastSidcAtOrBefore?.(src, t) : undefined;
                    const sidcFromUnit = src?.sidc ?? u?.sidc;

                    return { id: ent?.id, t, sidcFromEvents, sidcFromUnit, u, src };
                };
            } catch { }

            api.viewer.scene.globe.depthTestAgainstTerrain = true;
            api.viewer.clock.shouldAnimate = false;
            api.viewer.clock.clockRange = ClockRange.CLAMPED;

            baseImageryLayer =
                api.viewer.imageryLayers.length > 0 ? api.viewer.imageryLayers.get(0) : undefined;
        },

        unmount() {
            if (!api) return;
            setSurfaceHeightSampler(undefined);
            wx?.dispose();
            wx = null;
            api.destroy();
            api = null;
            entities.clear();
            unitMeta.clear();
            baseImageryLayer = undefined;
            overlayLayers.clear();
            groupColorIdx = new Map();
        },

        setUnits(units) {
            setUnitsInner(units);
        },

        upsertUnit(u) {
            if (!api) return;
            if (!groupColorIdx || groupColorIdx.size === 0) refreshGroupIndexFromScenario();
            applyGroupFillColorToUnit(u as any, groupColorIdx, { mirrorToIcon: false });

            // Force re-evaluation of SIDC-driven shape/style on every ORBAT/unit upsert.
            (lastSidc as Map<string, string | undefined>).delete(u.id);
            (lastOnMap as Map<string, boolean>).delete(u.id);
            lastFillHex.delete(u.id);

            const visibleByFilter = _unitFilter ? _unitFilter(u) : true;
            const notHidden2D = !isHidden2D(u);
            const passes = visibleByFilter && notHidden2D;

            const entExisting = api.viewer.entities.getById(u.id);

            if (!passes) {
                if (entExisting) {
                    api.viewer.entities.removeById(u.id);
                    entities.delete(u.id);
                    unitMeta.delete(u.id);
                    // also clear caches to avoid stale state
                    (lastOnMap as Map<string, boolean>).delete(u.id);
                    (lastSidc as Map<string, string | undefined>).delete(u.id);
                    lastFillHex.delete(u.id);
                    api.viewer.scene.requestRender();
                }
                unitMeta.set(u.id, u);
                return;
            }

            const ent = entExisting ?? api.viewer.entities.add({ id: u.id });
            entities.set(u.id, ent);
            unitMeta.set(u.id, u);

            // Preserve an immutable "baseline" SIDC for time playback.
            // We MUST NOT mutate src.sidc during scrubs; instead, keep the original here.
            try {
                const src: any = (u as any).__sourceUnit ?? u;
                if ((src as any).__baseSidc == null && typeof src?.sidc === "string" && src.sidc.trim()) {
                    (src as any).__baseSidc = src.sidc;
                }
                if ((u as any).__baseSidc == null) {
                    (u as any).__baseSidc = (src as any).__baseSidc ?? src?.sidc ?? u.sidc;
                }
            } catch { /* ignore */ }

            const renderMode = resolveSymbol3DRenderMode(u);
            if (renderMode === "installationFootprint") {
                applyInstallationGraphics(ent as any, u as any, {
                    getParentById: (id) => unitMeta.get(id),
                    defaultSize: { x: 20, y: 20, z: 10 },
                    style: "footprint",
                });
                applyAvailability(ent, u);
            } else if (renderMode === "block") {
                applyBlockGraphics(ent, u);
            } else {
                applySymbolAwareBillboardGraphics(ent, u, api.viewer);
            }

            ent.show = true;
            const tNow = currentViewerMs(api.viewer);
            if (typeof tNow === "number" && Number.isFinite(tNow)) {
                updateAllUnitsAtTime(tNow);
            }
            api.viewer.scene.requestRender();
            publishDebug(api.viewer);

            if (!u.getPositionAtTime && (u as any).__sourceUnit) {
                const src = (u as any).__sourceUnit;
                u.getPositionAtTime = (tMs) => getUnitPositionAtTime(src, tMs);
            }
        },

        removeUnit(id) {
            if (!api) return;
            const ent = entities.get(id);
            if (ent) uninstallIconLiftTick(api.viewer, ent);
            api.viewer.entities.removeById(id);
            removeManPortableIconCap(api.viewer, id);
            entities.delete(id);
            unitMeta.delete(id);
            (lastOnMap as Map<string, boolean>).delete(id);
            (lastSidc as Map<string, string | undefined>).delete(id);
            lastFillHex.delete(id);
            api.viewer.scene.requestRender();
            publishDebug(api.viewer);
            api.viewer.entities.removeById(toeUnderbarIdForUnit(id));
            lastToeUnderbarSig.delete(id);
            api.viewer.entities.removeById(pedestalLinesIdForUnit(id));
            pedestalTipCache.delete(id);
            for (const childId of [
                launcherTubeEntityId(id, 0),
                launcherTubeEntityId(id, 1),
                launcherTubeEntityId(id, 2),
                launcherTubeEntityId(id, 3),
                launcherTubeEntityId(id, 4),
                launcherTubeEntityId(id, 5),
                launcherTubeEntityId(id, 6),
                tankTurretEntityId(id),
                tankBarrelEntityId(id),
                ifvTurretEntityId(id),
                ifvBarrelEntityId(id),
                ...armoredUpperHullPartIdsForUnit(id),
                armoredTurretEntityId(id),
                armoredBarrelEntityId(id),
                recoveryBoomEntityId(id),
                apcModuleEntityId(id),
                apcAmbulanceModuleEntityId(id),
                apcAmbulancePodEntityId(id),
                reconMastEntityId(id),
                cargoModuleEntityId(id),
                commandModuleEntityId(id),
                commandMastEntityId(id),
                commandHeadEntityId(id),
                recoveryRigBoomEntityId(id),
                recoveryRigHookEntityId(id),
            ]) {
                try { api.viewer.entities.removeById(childId); } catch { /* ignore */ }
            }
            const lePrefix = `${id}${LAND_EQUIP_PART_SUFFIX}`;
            for (const childId of (api.viewer.entities.values ?? [])
                .map((e: any) => e?.id)
                .filter((eid: any) => typeof eid === "string" && eid.startsWith(lePrefix)) as string[]) {
                try { api.viewer.entities.removeById(childId); } catch { /* ignore */ }
            }
            const mobPrefix = `${id}${VEHICLE_MOBILITY_PART_SUFFIX}`;
            for (const childId of (api.viewer.entities.values ?? [])
                .map((e: any) => e?.id)
                .filter((eid: any) => typeof eid === "string" && eid.startsWith(mobPrefix)) as string[]) {
                try { api.viewer.entities.removeById(childId); } catch { /* ignore */ }
            }
            const hullAddonPrefix = `${id}${VEHICLE_HULL_ADDON_PART_SUFFIX}`;
            for (const childId of (api.viewer.entities.values ?? [])
                .map((e: any) => e?.id)
                .filter((eid: any) => typeof eid === "string" && eid.startsWith(hullAddonPrefix)) as string[]) {
                try { api.viewer.entities.removeById(childId); } catch { /* ignore */ }
            }
        },

        flyToLatLon(lon, lat, height = 120000) {
            if (!api) return;
            api.viewer.camera.flyTo({
                destination: Cartesian3.fromDegrees(lon, lat, height),
                duration: 1.0,
            });
        },

        onCameraChange(cb: (o: { heading: number; pitch: number; roll: number }) => void) {
            // If useGlobe provides a native subscription, forward to it.
            if (api && typeof (api as any).onCameraChange === "function") {
                return (api as any).onCameraChange(cb);
            }

            // Fallback: wire to viewer postRender and synthesize the payload.
            const v = api?.viewer;
            if (!v) {
                console.warn("[GlobeAdapter] onCameraChange called before mount; no-op.");
                return () => { };
            }
            const handler = () => {
                const c = v.camera;
                cb({ heading: c.heading, pitch: c.pitch, roll: c.roll });
            };
            try { v.scene.postRender.addEventListener(handler); } catch { }
            handler(); // push an initial sample
            return () => { try { v.scene.postRender.removeEventListener(handler); } catch { } };
        },

        async setExaggeration(factor: number) {
            if (!api) return;
            exaggerationFactor = factor;
            await api.setExaggeration(factor);

            for (const [id, ent] of entities) {
                const u = unitMeta.get(id);
                if (!u) continue;
                const renderMode = resolveSymbol3DRenderMode(u);
                if (renderMode === "installationFootprint") {
                    applyInstallationGraphics(ent as any, u as any, {
                        getParentById: (pid) => unitMeta.get(pid),
                        defaultSize: { x: 20, y: 20, z: 10 },
                        style: "footprint",
                    });
                    applyAvailability(ent, u);
                } else if (renderMode === "block") {
                    applyBlockGraphics(ent, u);
                } else {
                    applySymbolAwareBillboardGraphics(ent, u, api.viewer);
                }
            }
            api.viewer.scene.requestRender();
        },

        setRangeRingsVisible(visible: boolean) {
            rangeRingsVisible = !!visible;

            if (!api) return;

            // Re-run the time-based unit logic at the current viewer time
            const tMs = currentViewerMs(api.viewer);
            if (tMs != null) {
                updateAllUnitsAtTime(tMs);
            } else {
                // Fallback: at least force a render
                api.viewer.scene.requestRender?.();
            }
        },

        setBaseLayer(key: string) {
            if (!api) return;
            const entry = getByKey(key);
            if (!entry) {
                console.warn(`[GlobeAdapter] Imagery key not found: ${key}`);
                return;
            }
            const provider = entry.create();
            replaceBaseImageryLayer(api.viewer, provider);
        },

        setBaseLayerTemplate(url, opts) {
            if (!api) return;
            const provider = providerFromTemplate(url, opts);
            replaceBaseImageryLayer(api.viewer, provider);
        },

        async setTerrainKey(key: "world" | "flat" | "bathymetry" | "bathy") {
            if (!api) return;
            const anyApi: any = api;

            if (typeof anyApi.setTerrainKey === "function") {
                await anyApi.setTerrainKey(key);
            } else {
                // legacy fallback
                await api.setElevationEnabled(key === "world");
            }
        },

        setWaterEffectEnabled(enabled: boolean) {
            if (!api) return;
            const anyApi: any = api;

            if (typeof anyApi.setWaterEffectEnabled === "function") {
                anyApi.setWaterEffectEnabled(!!enabled);
                return;
            }

            // last-resort fallback
            try {
                (api.viewer.scene.globe as any).showWaterEffect = !!enabled;
                api.viewer.scene.requestRender();
            } catch { }
        },

        updateUnitPosition(id, lon, lat, alt?: number | null) {
            const ent = entities.get(id);
            if (!ent) return;

            const u = unitMeta.get(id);

            const wouldClamp = u?.clampToGround !== false && u?.alt == null && alt == null;
            if (wouldClamp) {
                setEntityPosition(ent, lon, lat, 0);
                return;
            }

            const treatAsAgl = u?.altIsAgl !== false;
            const baseAlt = alt ?? u?.alt ?? 0;
            const h = treatAsAgl ? scaledAlt(baseAlt) : baseAlt;
            setEntityPosition(ent, lon, lat, h);
        },

        setTime(epochMs: number) {
            if (!api) return;
            api.viewer.clock.currentTime = JulianDate.fromDate(new Date(epochMs));
            // First, drive weather
            wx?.onTimeChanged(epochMs);
            // Then, apply unit event logic (visibility + sidc + position)
            updateAllUnitsAtTime(epochMs);
        },

        setTimeBounds(startMs: number, stopMs: number) {
            if (!api) return;
            const clk = api.viewer.clock;
            clk.startTime = JulianDate.fromDate(new Date(startMs));
            clk.stopTime = JulianDate.fromDate(new Date(stopMs));

            if (clk.startTime && JulianDate.lessThan(clk.currentTime, clk.startTime)) {
                clk.currentTime = clk.startTime.clone();
            }
            if (clk.stopTime && JulianDate.greaterThan(clk.currentTime, clk.stopTime)) {
                clk.currentTime = clk.stopTime.clone();
            }

            api.viewer.scene.requestRender?.();
        },

        enableDayNight(enabled: boolean) {
            if (!api) return;
            api.viewer.scene.globe.enableLighting = enabled;
            if ("dynamicAtmosphereLighting" in api.viewer.scene.globe)
                (api.viewer.scene.globe as any).dynamicAtmosphereLighting = enabled;
            if ("dynamicAtmosphereLightingFromSun" in api.viewer.scene.globe)
                (api.viewer.scene.globe as any).dynamicAtmosphereLightingFromSun = enabled;
            api.viewer.scene.light = enabled ? new SunLight() : undefined;
            if (api.viewer.shadowMap) api.viewer.shadowMap.enabled = false;
            api.viewer.scene.requestRender?.();
        },

        enableSkybox(enabled: boolean) {
            if (!api) return;
            if (!api.viewer.scene.skyAtmosphere) api.viewer.scene.skyAtmosphere = new SkyAtmosphere();
            api.viewer.scene.skyAtmosphere.show = enabled;
            if (!api.viewer.scene.sun) api.viewer.scene.sun = new Sun();
            if (!api.viewer.scene.moon) api.viewer.scene.moon = new Moon();
            api.viewer.scene.sun.show = enabled;
            api.viewer.scene.moon.show = enabled;
            if (enabled) {
                api.viewer.scene.skyBox = new SkyBox({
                    sources: {
                        positiveX: Cesium.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_px.jpg"),
                        negativeX: Cesium.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_mx.jpg"),
                        positiveY: Cesium.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_py.jpg"),
                        negativeY: Cesium.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_my.jpg"),
                        positiveZ: Cesium.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_pz.jpg"),
                        negativeZ: Cesium.buildModuleUrl("Assets/Textures/SkyBox/tycho2t3_80_mz.jpg"),
                    },
                });
            } else if (api.viewer.scene.skyBox) {
                api.viewer.scene.skyBox.show = false;
            }
            api.viewer.scene.requestRender?.();
        },

        enableCloudOverlay(enabled: boolean, options?: GibsCloudOptions) {
            if (!api || !wx) return;
            wx.enableCloudOverlay(enabled, options);
        },

        /* overlays */
        addOverlayTemplate(id, url, opts) {
            if (!api) return;
            try {
                const existing = overlayLayers.get(id);
                if (existing) {
                    if (typeof opts?.alpha === "number") existing.alpha = opts.alpha;
                    existing.show = true;
                    api.viewer.imageryLayers.raiseToTop(existing);
                    api.viewer.scene.requestRender();
                    return;
                }

                const provider = providerFromTemplate(url, opts);
                const layer = api.viewer.imageryLayers.addImageryProvider(provider);

                if (typeof opts?.alpha === "number") layer.alpha = opts.alpha;
                layer.show = true;

                api.viewer.imageryLayers.raiseToTop(layer);
                overlayLayers.set(id, layer);
                api.viewer.scene.requestRender();
            } catch (e) {
                console.error("[GlobeAdapter] addOverlayTemplate failed:", e);
            }
        },

        removeOverlay(id) {
            if (!api) return;
            const layer = overlayLayers.get(id);
            if (!layer) return;
            try {
                api.viewer.imageryLayers.remove(layer, true);
            } catch { }
            overlayLayers.delete(id);
            api.viewer.scene.requestRender();
        },

        setOverlayVisibility(id, show) {
            const layer = overlayLayers.get(id);
            if (!layer) return;
            layer.show = !!show;
            if (show) {
                layer.alpha = Math.max(0.0, layer.alpha ?? 1.0);
                api!.viewer.imageryLayers.raiseToTop(layer);
            }
            api!.viewer.scene.requestRender();
        },

        getViewer: () => api?.viewer,

        setOverlayAlpha(id, alpha) {
            const layer = overlayLayers.get(id);
            if (!layer) return;
            layer.alpha = Math.min(1, Math.max(0, alpha));
            api!.viewer.scene.requestRender();
        },

        listOverlays() {
            const out: { id: string; show: boolean; alpha: number }[] = [];
            overlayLayers.forEach((layer, id) => {
                out.push({ id, show: !!layer.show, alpha: layer.alpha ?? 1 });
            });
            return out;
        },

        /* filter */
        setUnitFilter(fn) {
            _unitFilter = (typeof fn === "function") ? fn : () => true;
            setUnitsInner(_lastUnitsInput);
        },
        refreshVisibility: reapplyVisibility,
    };
}

try {
    (window as any).buildIconUrlSync = (u: any) => buildIconUrlSync(u, (window as any).MentatGlobe?.viewer);
} catch { }








