export type LandEquipmentMobilityKind =
  | "unspecified"
  | "wheeled"
  | "tracked"
  | "wheeledTracked"
  | "towed"
  | "rail"
  | "pack"
  | "snow"
  | "sled"
  | "barge"
  | "amphibious";

export type LandEquipmentTowedArrayKind = "none" | "short" | "long";

export type LandEquipmentMobilityProfile = {
  symbolSet: string;
  modifierOne: string;
  modifierTwo: string;
  kind: LandEquipmentMobilityKind;
  wheelCount: number;
  hasTracks: boolean;
  hasTowArm: boolean;
  runnerCount: number;
  hasPontoons: boolean;
  hasRailBogies: boolean;
  towedArray: LandEquipmentTowedArrayKind;
};

function symbolSetFromSidc(sidc?: string): string | undefined {
  if (typeof sidc !== "string") return undefined;
  const normalized = sidc.trim();
  if (normalized.length < 6) return undefined;
  return normalized.slice(4, 6);
}

function modifierOneFromSidc(sidc?: string): string {
  if (typeof sidc !== "string") return "00";
  const normalized = sidc.trim();
  if (normalized.length < 18) return "00";
  return normalized.slice(16, 18) || "00";
}

function modifierTwoFromSidc(sidc?: string): string {
  if (typeof sidc !== "string") return "00";
  const normalized = sidc.trim();
  if (normalized.length < 20) return "00";
  return normalized.slice(18, 20) || "00";
}

function mobilityKindFromModifierOne(code: string): LandEquipmentMobilityKind {
  switch (code) {
    case "31":
    case "32":
      return "wheeled";
    case "33":
      return "tracked";
    case "34":
      return "wheeledTracked";
    case "35":
      return "towed";
    case "36":
      return "rail";
    case "37":
      return "pack";
    case "41":
      return "snow";
    case "42":
      return "sled";
    case "51":
      return "barge";
    case "52":
      return "amphibious";
    default:
      return "unspecified";
  }
}

function towedArrayFromModifierTwo(code: string): LandEquipmentTowedArrayKind {
  if (code === "61") return "short";
  if (code === "62") return "long";
  return "none";
}

export function resolveLandEquipmentMobilityProfileFromSidc(
  sidc?: string,
): LandEquipmentMobilityProfile | undefined {
  const symbolSet = symbolSetFromSidc(sidc);
  if (symbolSet !== "15") return undefined;

  const modifierOne = modifierOneFromSidc(sidc);
  const modifierTwo = modifierTwoFromSidc(sidc);
  const kind = mobilityKindFromModifierOne(modifierOne);
  const towedArray = towedArrayFromModifierTwo(modifierTwo);

  const wheelCount =
    modifierOne === "31" ? 4
      : modifierOne === "32" ? 6
        : modifierOne === "34" ? 2
          : modifierOne === "35" ? 2
            : modifierOne === "36" ? 4
              : 0;

  const hasTracks = kind === "tracked" || kind === "wheeledTracked";
  const hasTowArm = kind === "towed";
  const runnerCount = (kind === "snow" || kind === "sled") ? 2 : 0;
  const hasPontoons = kind === "amphibious";
  const hasRailBogies = kind === "rail";

  return {
    symbolSet,
    modifierOne,
    modifierTwo,
    kind,
    wheelCount,
    hasTracks,
    hasTowArm,
    runnerCount,
    hasPontoons,
    hasRailBogies,
    towedArray,
  };
}

export function expectedVehicleMobilityPartCount(profile?: LandEquipmentMobilityProfile): number {
  if (!profile) return 0;
  let count = 0;

  if (profile.wheelCount > 0) count += profile.wheelCount;
  if (profile.hasTracks) count += 2;
  if (profile.runnerCount > 0) count += profile.runnerCount;
  if (profile.hasPontoons) count += 2;
  if (profile.hasRailBogies) count += 2; // rail strips
  if (profile.hasTowArm) count += 1;
  if (profile.towedArray !== "none") count += 1;

  return count;
}
