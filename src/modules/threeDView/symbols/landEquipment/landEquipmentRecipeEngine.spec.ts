import { describe, expect, it } from "vitest";
import {
  compileRecipeToInstances,
  findBestOverrideRow,
  parsePrimitiveRecipe,
  type LandEquipShapeOverride,
} from "./landEquipmentRecipeEngine";

describe("landEquipmentRecipeEngine", () => {
  it("parses primitive terms with counts and args", () => {
    const parsed = parsePrimitiveRecipe(
      "box(veh_medium) + 2x cylinder(tube_medium,offset=rear-top,axis=longitudinal,tilt=45)",
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.kind).toBe("box");
    expect(parsed[1]?.kind).toBe("cylinder");
    expect(parsed[1]?.count).toBe(2);
    expect(parsed[1]?.kv.offset).toBe("rear-top");
    expect(parsed[1]?.kv.axis).toBe("longitudinal");
    expect(parsed[1]?.kv.tilt).toBe("45");
  });

  it("compiles recipe using tokens and produces bounded instance count", () => {
    const tokens = {
      veh_medium: "6.5x3.5x3.0",
      tube_medium: "r=0.45,h=5.0",
    };
    const { instances, bodyBounds } = compileRecipeToInstances(
      "box(veh_medium) + 4x cylinder(tube_medium,offset=rear-top,axis=longitudinal,tilt=45)",
      tokens,
    );
    expect(bodyBounds.halfH).toBeCloseTo(1.5);
    expect(instances.length).toBe(5);
    expect(instances[0]?.kind).toBe("box");
    expect(instances[1]?.kind).toBe("cylinder");
    expect(instances[1]?.axis).toBe("longitudinal");
    expect(instances[1]?.tiltDeg).toBe(45);
  });

  it("matches override rows by exact subtype then wildcard", () => {
    const rows: LandEquipShapeOverride[] = [
      {
        entityCode: "22",
        entityTypeCode: "03",
        entitySubtypeCode: "*",
        proposedShapeType: "sensorRadar",
        primitiveRecipe: "box(1x1x1)",
        orientationAssumption: "forward=north",
        anchorAltitude: "ground-hugging-center",
        labelOffset: [0, 0, 0],
        removeLegacySidcPedestal: true,
        confidence: "high",
        priority: "P1",
      },
      {
        entityCode: "22",
        entityTypeCode: "03",
        entitySubtypeCode: "01",
        proposedShapeType: "sensorRadarSubtype",
        primitiveRecipe: "box(2x2x2)",
        orientationAssumption: "forward=north",
        anchorAltitude: "ground-hugging-center",
        labelOffset: [0, 0, 0],
        removeLegacySidcPedestal: true,
        confidence: "high",
        priority: "P1",
      },
    ];
    const exact = findBestOverrideRow(rows, "22", "03", "01");
    const wildcard = findBestOverrideRow(rows, "22", "03", "09");
    expect(exact?.proposedShapeType).toBe("sensorRadarSubtype");
    expect(wildcard?.proposedShapeType).toBe("sensorRadar");
  });
});
