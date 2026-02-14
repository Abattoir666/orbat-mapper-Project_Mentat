export type GroundShapeOverride =
  | "vehicleBox"
  | "vehicleTankTurret"
  | "vehicleIfvTurret"
  | "vehicleArmoredTurret"
  | "vehicleRecoveryBoom"
  | "vehicleApcModule"
  | "vehicleApcAmbulance"
  | "vehicleReconMast"
  | "vehicleCargoModule"
  | "vehicleCommandMast"
  | "vehicleRecoveryRig"
  | "weaponCylinder"
  | "weaponTriangle"
  | "weaponDualTubeLauncher"
  | "weaponSixTubeLauncher"
  | "weaponSingleLargeTubeLauncher";

type SidcParts = {
  symbolSet?: string;
  entityCode?: string;
  entityTypeCode?: string;
  entitySubtypeCode?: string;
};

type SidcShapeRule = {
  symbolSet: string;
  entityCode: string;
  entityTypeCodes?: string[];
  entitySubtypeCodes?: string[];
  shape: GroundShapeOverride;
};

// Ordered most-specific to least-specific.
const SIDC_SHAPE_RULES: SidcShapeRule[] = [
  // 15:11:13,15 => single large-tube launcher composite
  { symbolSet: "15", entityCode: "11", entityTypeCodes: ["13", "15"], shape: "weaponSingleLargeTubeLauncher" },
  // 15:11:16 => six-tube launcher composite
  { symbolSet: "15", entityCode: "11", entityTypeCodes: ["16"], shape: "weaponSixTubeLauncher" },
  // 15:11:11 => dual-tube launcher composite
  { symbolSet: "15", entityCode: "11", entityTypeCodes: ["11"], shape: "weaponDualTubeLauncher" },
  // 15:11:05..09,14 => triangle guns
  { symbolSet: "15", entityCode: "11", entityTypeCodes: ["05", "06", "07", "08", "09", "14"], shape: "weaponTriangle" },
  // 15:11:* => cylinder weapons
  { symbolSet: "15", entityCode: "11", shape: "weaponCylinder" },
  // 15:12:02 => tank hull + turret + barrel
  { symbolSet: "15", entityCode: "12", entityTypeCodes: ["02"], shape: "vehicleTankTurret" },
  // 15:12:01:01 => infantry fighting vehicle with smaller turret + gun
  { symbolSet: "15", entityCode: "12", entityTypeCodes: ["01"], entitySubtypeCodes: ["01"], shape: "vehicleIfvTurret" },
  // 15:12:01:03 => APC hull + rear module
  { symbolSet: "15", entityCode: "12", entityTypeCodes: ["01"], entitySubtypeCodes: ["03"], shape: "vehicleApcModule" },
  // 15:12:01:04,07 => APC ambulance/medevac with roof medical pod
  { symbolSet: "15", entityCode: "12", entityTypeCodes: ["01"], entitySubtypeCodes: ["04", "07"], shape: "vehicleApcAmbulance" },
  // 15:12:01:11 => light armor reconnaissance with sensor mast
  { symbolSet: "15", entityCode: "12", entityTypeCodes: ["01"], entitySubtypeCodes: ["11"], shape: "vehicleReconMast" },
  // 15:12:01:09 => combat service support with rear cargo module
  { symbolSet: "15", entityCode: "12", entityTypeCodes: ["01"], entitySubtypeCodes: ["09"], shape: "vehicleCargoModule" },
  // 15:12:01:02 => armored command and control with comms mast
  { symbolSet: "15", entityCode: "12", entityTypeCodes: ["01"], entitySubtypeCodes: ["02"], shape: "vehicleCommandMast" },
  // 15:12:01:06,08 => protected/APC recovery with rear recovery rig
  { symbolSet: "15", entityCode: "12", entityTypeCodes: ["01"], entitySubtypeCodes: ["06", "08"], shape: "vehicleRecoveryRig" },
  // 15:12:01 => armored fighting vehicle hull + compact turret + short barrel
  { symbolSet: "15", entityCode: "12", entityTypeCodes: ["01"], shape: "vehicleArmoredTurret" },
  // 15:12:03 => recovery vehicle hull + recovery boom
  { symbolSet: "15", entityCode: "12", entityTypeCodes: ["03"], shape: "vehicleRecoveryBoom" },
  // 15:12:* => vehicle box
  { symbolSet: "15", entityCode: "12", shape: "vehicleBox" },
];

export function parseSidcParts(sidc?: string): SidcParts {
  if (typeof sidc !== "string") return {};
  const normalized = sidc.trim();
  if (normalized.length < 12) return {};

  const symbolSet = normalized.slice(4, 6);
  const entityCode = normalized.slice(10, 12);
  const entityTypeCode = normalized.length >= 14 ? normalized.slice(12, 14) : undefined;
  const entitySubtypeCode = normalized.length >= 16 ? normalized.slice(14, 16) : undefined;
  return { symbolSet, entityCode, entityTypeCode, entitySubtypeCode };
}

export function resolveSidcShapeOverride(sidc?: string): GroundShapeOverride | undefined {
  const p = parseSidcParts(sidc);
  if (!p.symbolSet || !p.entityCode) return undefined;

  for (const rule of SIDC_SHAPE_RULES) {
    if (rule.symbolSet !== p.symbolSet) continue;
    if (rule.entityCode !== p.entityCode) continue;
    if (rule.entityTypeCodes && (!p.entityTypeCode || !rule.entityTypeCodes.includes(p.entityTypeCode))) continue;
    if (rule.entitySubtypeCodes && (!p.entitySubtypeCode || !rule.entitySubtypeCodes.includes(p.entitySubtypeCode))) continue;
    return rule.shape;
  }
  return undefined;
}
