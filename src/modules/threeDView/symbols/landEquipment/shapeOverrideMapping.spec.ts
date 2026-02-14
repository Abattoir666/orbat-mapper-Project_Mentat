import { describe, expect, it } from "vitest";
import {
  LAND_EQUIP_SHAPE_OVERRIDES,
  findLandEquipShapeOverrideForSidc,
  hasLandEquipRecipeOverrideForSidc,
} from "./shapeOverrideMapping";
import { LAND_EQUIPMENT_SUBCATEGORY_DEFINITIONS } from "./index";
import { findBestOverrideRow } from "./landEquipmentRecipeEngine";

describe("shapeOverrideMapping coverage", () => {
  it("uses valid SIDC code formats for override rows", () => {
    for (const row of LAND_EQUIP_SHAPE_OVERRIDES) {
      expect(row.entityCode).toMatch(/^\d{2}$/);
      expect(row.entityTypeCode).toMatch(/^(\d{2}|\*)$/);
      expect(row.entitySubtypeCode).toMatch(/^(\d{2}|\*)$/);
      expect(typeof row.primitiveRecipe).toBe("string");
      expect(row.primitiveRecipe.length).toBeGreaterThan(0);
    }
  });

  it("includes at least one wildcard type fallback for each non-weapon/non-vehicle category", () => {
    const requiredEntityCodes = ["13", "14", "15", "16", "17", "19", "20", "21", "22", "23"];
    const fallbackRows = LAND_EQUIP_SHAPE_OVERRIDES.filter(
      (r) => r.entityTypeCode === "*" && r.entitySubtypeCode === "*",
    );
    const covered = new Set(fallbackRows.map((r) => r.entityCode));
    for (const entityCode of requiredEntityCodes) {
      expect(covered.has(entityCode)).toBe(true);
    }
  });

  it("can resolve an override row for every non-weapon/non-vehicle landEquipment subcategory", () => {
    const coveredEntityCodes = new Set(["13", "14", "15", "16", "17", "19", "20", "21", "22", "23"]);
    for (const sub of LAND_EQUIPMENT_SUBCATEGORY_DEFINITIONS) {
      if (!coveredEntityCodes.has(sub.entityCode)) continue;
      const row = findBestOverrideRow(
        LAND_EQUIP_SHAPE_OVERRIDES,
        sub.entityCode,
        sub.entityTypeCode,
        sub.entitySubtypeCode ?? "*",
      );
      expect(row, `missing override for ${sub.entityCode}:${sub.entityTypeCode}:${sub.entitySubtypeCode ?? "*"}`).toBeTruthy();
    }
  });

  it("resolves expected recipe overrides from SIDC strings", () => {
    const sensorRadarSidc = "10031500002203000000"; // 15:22:03
    const utilityTowSidc = "10031500001412010000"; // 15:14:12:01
    const vehicleSidc = "10031500001201010000"; // 15:12:01:01 (vehicle path stays separate)

    expect(hasLandEquipRecipeOverrideForSidc(sensorRadarSidc)).toBe(true);
    expect(findLandEquipShapeOverrideForSidc(sensorRadarSidc)?.proposedShapeType).toBe("sensorRadar");

    expect(hasLandEquipRecipeOverrideForSidc(utilityTowSidc)).toBe(true);
    expect(findLandEquipShapeOverrideForSidc(utilityTowSidc)?.proposedShapeType).toBe("utilityTowTruckLight");

    expect(hasLandEquipRecipeOverrideForSidc(vehicleSidc)).toBe(false);
  });
});
