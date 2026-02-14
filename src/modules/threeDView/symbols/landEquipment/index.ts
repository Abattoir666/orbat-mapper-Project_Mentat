import { symbolSetFromSidc } from "../sidc";
import {
  CIVILIAN_VEHICLES_DEFINITION,
  EMERGENCY_OPERATION_DEFINITION,
  ENGINEER_VEHICLES_AND_EQUIPMENT_DEFINITION,
  LAND_MINES_DEFINITION,
  LAW_ENFORCEMENT_DEFINITION,
  MISSILE_SUPPORT_DEFINITION,
  OTHER_EQUIPMENT_DEFINITION,
  SENSORS_DEFINITION,
  TRAINS_DEFINITION,
  UTILITY_VEHICLES_DEFINITION,
  VEHICLES_DEFINITION,
  WEAPONS_WEAPON_SYSTEM_DEFINITION,
} from "./definitions";
import {
  CIVILIAN_VEHICLES_SUBCATEGORY_DEFINITIONS,
  EMERGENCY_OPERATION_SUBCATEGORY_DEFINITIONS,
  ENGINEER_VEHICLES_AND_EQUIPMENT_SUBCATEGORY_DEFINITIONS,
  LAND_MINES_SUBCATEGORY_DEFINITIONS,
  LAW_ENFORCEMENT_SUBCATEGORY_DEFINITIONS,
  MISSILE_SUPPORT_SUBCATEGORY_DEFINITIONS,
  OTHER_EQUIPMENT_SUBCATEGORY_DEFINITIONS,
  SENSORS_SUBCATEGORY_DEFINITIONS,
  TRAINS_SUBCATEGORY_DEFINITIONS,
  UTILITY_VEHICLES_SUBCATEGORY_DEFINITIONS,
  VEHICLES_SUBCATEGORY_DEFINITIONS,
  WEAPONS_WEAPON_SYSTEM_SUBCATEGORY_DEFINITIONS,
} from "./subcategories";
import type { LandEquipmentCategoryDefinition, LandEquipmentSubcategoryDefinition } from "./types";

export type { LandEquipmentCategoryDefinition, LandEquipmentSubcategoryDefinition } from "./types";

export const LAND_EQUIPMENT_CATEGORY_DEFINITIONS: LandEquipmentCategoryDefinition[] = [
  WEAPONS_WEAPON_SYSTEM_DEFINITION,
  VEHICLES_DEFINITION,
  ENGINEER_VEHICLES_AND_EQUIPMENT_DEFINITION,
  TRAINS_DEFINITION,
  CIVILIAN_VEHICLES_DEFINITION,
  LAW_ENFORCEMENT_DEFINITION,
  UTILITY_VEHICLES_DEFINITION,
  MISSILE_SUPPORT_DEFINITION,
  LAND_MINES_DEFINITION,
  SENSORS_DEFINITION,
  EMERGENCY_OPERATION_DEFINITION,
  OTHER_EQUIPMENT_DEFINITION,
];

const definitionByEntityCode = new Map<string, LandEquipmentCategoryDefinition>(
  LAND_EQUIPMENT_CATEGORY_DEFINITIONS.map((definition) => [definition.entityCode, definition]),
);

export const LAND_EQUIPMENT_SUBCATEGORY_DEFINITIONS: LandEquipmentSubcategoryDefinition[] = [
  ...WEAPONS_WEAPON_SYSTEM_SUBCATEGORY_DEFINITIONS,
  ...VEHICLES_SUBCATEGORY_DEFINITIONS,
  ...ENGINEER_VEHICLES_AND_EQUIPMENT_SUBCATEGORY_DEFINITIONS,
  ...TRAINS_SUBCATEGORY_DEFINITIONS,
  ...CIVILIAN_VEHICLES_SUBCATEGORY_DEFINITIONS,
  ...LAW_ENFORCEMENT_SUBCATEGORY_DEFINITIONS,
  ...UTILITY_VEHICLES_SUBCATEGORY_DEFINITIONS,
  ...MISSILE_SUPPORT_SUBCATEGORY_DEFINITIONS,
  ...LAND_MINES_SUBCATEGORY_DEFINITIONS,
  ...SENSORS_SUBCATEGORY_DEFINITIONS,
  ...EMERGENCY_OPERATION_SUBCATEGORY_DEFINITIONS,
  ...OTHER_EQUIPMENT_SUBCATEGORY_DEFINITIONS,
];

const subcategoryByEntityAndEntityTypeCode = new Map<string, LandEquipmentSubcategoryDefinition>(
  LAND_EQUIPMENT_SUBCATEGORY_DEFINITIONS
    .filter((definition) => !definition.entitySubtypeCode)
    .map((definition) => [`${definition.entityCode}:${definition.entityTypeCode}`, definition]),
);

const subcategoryByEntityAndEntityTypeAndSubtypeCode = new Map<string, LandEquipmentSubcategoryDefinition>(
  LAND_EQUIPMENT_SUBCATEGORY_DEFINITIONS
    .filter((definition) => !!definition.entitySubtypeCode)
    .map((definition) => [
      `${definition.entityCode}:${definition.entityTypeCode}:${definition.entitySubtypeCode}`,
      definition,
    ]),
);

const MAN_PORTABLE_WEAPON_SUBCATEGORY_IDS = new Set<string>([
  "weapon-rifle",
  "weapon-machine-gun",
  "weapon-grenade-launcher",
  "weapon-flame-thrower",
]);

function entityCodeFromSidc(sidc?: string): string | undefined {
  if (typeof sidc !== "string") return undefined;
  const normalized = sidc.trim();
  if (normalized.length < 12) return undefined;
  return normalized.slice(10, 12);
}

function entityTypeCodeFromSidc(sidc?: string): string | undefined {
  if (typeof sidc !== "string") return undefined;
  const normalized = sidc.trim();
  if (normalized.length < 14) return undefined;
  return normalized.slice(12, 14);
}

function entitySubtypeCodeFromSidc(sidc?: string): string | undefined {
  if (typeof sidc !== "string") return undefined;
  const normalized = sidc.trim();
  if (normalized.length < 16) return undefined;
  return normalized.slice(14, 16);
}

export function isLandEquipmentSidc(sidc?: string): boolean {
  return symbolSetFromSidc(sidc) === "15";
}

export function resolveLandEquipmentCategoryFromSidc(
  sidc?: string,
): LandEquipmentCategoryDefinition | undefined {
  if (!isLandEquipmentSidc(sidc)) return undefined;
  const entityCode = entityCodeFromSidc(sidc);
  if (!entityCode) return undefined;
  return definitionByEntityCode.get(entityCode);
}

export function resolveLandEquipmentSubcategoryFromSidc(
  sidc?: string,
): LandEquipmentSubcategoryDefinition | undefined {
  if (!isLandEquipmentSidc(sidc)) return undefined;
  const entityCode = entityCodeFromSidc(sidc);
  const entityTypeCode = entityTypeCodeFromSidc(sidc);
  const entitySubtypeCode = entitySubtypeCodeFromSidc(sidc);
  if (!entityCode || !entityTypeCode) return undefined;
  if (entitySubtypeCode) {
    const subtypeMatch = subcategoryByEntityAndEntityTypeAndSubtypeCode.get(
      `${entityCode}:${entityTypeCode}:${entitySubtypeCode}`,
    );
    if (subtypeMatch) return subtypeMatch;
  }
  return subcategoryByEntityAndEntityTypeCode.get(`${entityCode}:${entityTypeCode}`);
}

export function isManPortableLandWeaponSidc(sidc?: string): boolean {
  const subcategory = resolveLandEquipmentSubcategoryFromSidc(sidc);
  if (!subcategory) return false;
  return MAN_PORTABLE_WEAPON_SUBCATEGORY_IDS.has(subcategory.id);
}
