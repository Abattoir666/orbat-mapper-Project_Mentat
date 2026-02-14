import { describe, expect, it } from "vitest";
import { resolveSidcShapeOverride } from "./shapeOverrides";

describe("shapeOverrides", () => {
  it("maps tank vehicle SIDC to vehicleTankTurret", () => {
    // 15:12:02:01 (land equipment -> vehicles -> tank light)
    expect(resolveSidcShapeOverride("10031500001202010000")).toBe("vehicleTankTurret");
  });

  it("maps IFV SIDC to vehicleIfvTurret", () => {
    // 15:12:01:01 (land equipment -> vehicles -> armored fighting vehicle)
    expect(resolveSidcShapeOverride("10031500001201010000")).toBe("vehicleIfvTurret");
  });

  it("keeps non-IFV armored subtype on vehicleArmoredTurret", () => {
    // 15:12:01:05 (land equipment -> vehicles -> armored protected vehicle)
    expect(resolveSidcShapeOverride("10031500001201050000")).toBe("vehicleArmoredTurret");
  });

  it("maps APC subtype SIDC to vehicleApcModule", () => {
    // 15:12:01:03 (land equipment -> vehicles -> armored personnel carrier)
    expect(resolveSidcShapeOverride("10031500001201030000")).toBe("vehicleApcModule");
  });

  it("maps APC ambulance SIDC to vehicleApcAmbulance", () => {
    // 15:12:01:04 (land equipment -> vehicles -> APC ambulance)
    expect(resolveSidcShapeOverride("10031500001201040000")).toBe("vehicleApcAmbulance");
  });

  it("maps recon SIDC to vehicleReconMast", () => {
    // 15:12:01:11 (land equipment -> vehicles -> light armor reconnaissance)
    expect(resolveSidcShapeOverride("10031500001201110000")).toBe("vehicleReconMast");
  });

  it("maps combat support SIDC to vehicleCargoModule", () => {
    // 15:12:01:09 (land equipment -> vehicles -> combat service support vehicle)
    expect(resolveSidcShapeOverride("10031500001201090000")).toBe("vehicleCargoModule");
  });

  it("maps armored C2 SIDC to vehicleCommandMast", () => {
    // 15:12:01:02 (land equipment -> vehicles -> armored C2)
    expect(resolveSidcShapeOverride("10031500001201020000")).toBe("vehicleCommandMast");
  });

  it("maps armored recovery SIDC to vehicleRecoveryRig", () => {
    // 15:12:01:06 (land equipment -> vehicles -> armored protected recovery)
    expect(resolveSidcShapeOverride("10031500001201060000")).toBe("vehicleRecoveryRig");
  });

  it("maps recovery vehicle SIDC to vehicleRecoveryBoom", () => {
    // 15:12:03:01 (land equipment -> vehicles -> tank recovery light)
    expect(resolveSidcShapeOverride("10031500001203010000")).toBe("vehicleRecoveryBoom");
  });

  it("keeps non-tank vehicles on vehicleBox", () => {
    // 15:12:04:00 (falls back to generic vehicle box)
    expect(resolveSidcShapeOverride("10031500001204000000")).toBe("vehicleBox");
  });
});
