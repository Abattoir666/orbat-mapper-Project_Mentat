import { describe, expect, it } from "vitest";
import {
  expectedVehicleMobilityPartCount,
  resolveLandEquipmentMobilityProfileFromSidc,
} from "./mobilityModifiers";

describe("mobilityModifiers", () => {
  const mk = (mobilityCode: string, towedCode = "00") => `1003150000120201${mobilityCode}${towedCode}`;

  it("parses wheeled mobility from modifier one", () => {
    const profile = resolveLandEquipmentMobilityProfileFromSidc(mk("32"));
    expect(profile?.kind).toBe("wheeled");
    expect(profile?.wheelCount).toBe(6);
    expect(profile?.modifierOne).toBe("32");
  });

  it("parses tracked + towed array from modifiers", () => {
    const profile = resolveLandEquipmentMobilityProfileFromSidc(mk("33", "61"));
    expect(profile?.kind).toBe("tracked");
    expect(profile?.hasTracks).toBe(true);
    expect(profile?.towedArray).toBe("short");
  });

  it("returns undefined for non-land-equipment sidc", () => {
    const profile = resolveLandEquipmentMobilityProfileFromSidc("10031000001202013200");
    expect(profile).toBeUndefined();
  });

  it("estimates parts count for common profiles", () => {
    const wheeled = resolveLandEquipmentMobilityProfileFromSidc(mk("31"));
    const tracked = resolveLandEquipmentMobilityProfileFromSidc(mk("33"));
    expect(expectedVehicleMobilityPartCount(wheeled)).toBe(4);
    expect(expectedVehicleMobilityPartCount(tracked)).toBe(2);
  });

  it("covers the mobility code matrix for 3D readiness", () => {
    const cases: Array<{ code: string; kind: string; parts: number }> = [
      { code: "31", kind: "wheeled", parts: 4 },
      { code: "32", kind: "wheeled", parts: 6 },
      { code: "33", kind: "tracked", parts: 2 },
      { code: "34", kind: "wheeledTracked", parts: 4 },
      { code: "35", kind: "towed", parts: 3 },
      { code: "36", kind: "rail", parts: 6 },
      { code: "41", kind: "snow", parts: 2 },
      { code: "42", kind: "sled", parts: 2 },
      { code: "52", kind: "amphibious", parts: 2 },
    ];

    for (const c of cases) {
      const profile = resolveLandEquipmentMobilityProfileFromSidc(mk(c.code));
      expect(profile?.kind).toBe(c.kind);
      expect(profile?.modifierOne).toBe(c.code);
      expect(expectedVehicleMobilityPartCount(profile)).toBe(c.parts);
    }
  });

  it("parses towed-array modifier matrix", () => {
    const shortTow = resolveLandEquipmentMobilityProfileFromSidc(mk("35", "61"));
    const longTow = resolveLandEquipmentMobilityProfileFromSidc(mk("35", "62"));
    expect(shortTow?.towedArray).toBe("short");
    expect(longTow?.towedArray).toBe("long");
  });
});
