import { ACTIVITY_SYMBOL_SET_PROFILES } from "./profiles/activity";
import { AIR_AND_SPACE_SYMBOL_SET_PROFILES } from "./profiles/airAndSpace";
import { LAND_SYMBOL_SET_PROFILES } from "./profiles/land";
import { MARITIME_SYMBOL_SET_PROFILES } from "./profiles/maritime";
import { symbolSetFromSidc } from "./sidc";
import type { Symbol3DRenderMode, SymbolSet3DProfile } from "./types";

export type { Symbol3DRenderMode, SymbolSet3DProfile } from "./types";
export { symbolSetFromSidc } from "./sidc";
export type { GroundShapeOverride } from "./shapeOverrides";
export { parseSidcParts, resolveSidcShapeOverride } from "./shapeOverrides";
export * from "./landEquipment";
export * from "./Products";

export const SYMBOL_SET_3D_PROFILES: SymbolSet3DProfile[] = [
  ...LAND_SYMBOL_SET_PROFILES,
  ...MARITIME_SYMBOL_SET_PROFILES,
  ...AIR_AND_SPACE_SYMBOL_SET_PROFILES,
  ...ACTIVITY_SYMBOL_SET_PROFILES,
];

const profileBySymbolSet = new Map<string, SymbolSet3DProfile>(
  SYMBOL_SET_3D_PROFILES.map((profile) => [profile.symbolSet, profile]),
);

export function getSymbolSet3DProfile(symbolSet?: string): SymbolSet3DProfile | undefined {
  if (!symbolSet) return undefined;
  return profileBySymbolSet.get(symbolSet);
}

export function getSymbolSet3DProfileFromSidc(sidc?: string): SymbolSet3DProfile | undefined {
  return getSymbolSet3DProfile(symbolSetFromSidc(sidc));
}

export function isInstallationSymbolSet(sidc?: string): boolean {
  return symbolSetFromSidc(sidc) === "20";
}

type RenderDecisionInput = {
  sidc?: string;
  render?: "billboard" | "block";
  isInstallation?: boolean;
  symbolOptions?: {
    isInstallation?: boolean;
  };
};

export function resolveSymbol3DRenderMode(u: RenderDecisionInput): Symbol3DRenderMode {
  if (u.render === "block") return "block";
  if (u.isInstallation || u.symbolOptions?.isInstallation) return "installationFootprint";

  const bySidc = getSymbolSet3DProfileFromSidc(u.sidc)?.renderMode;
  return bySidc ?? "billboard";
}
