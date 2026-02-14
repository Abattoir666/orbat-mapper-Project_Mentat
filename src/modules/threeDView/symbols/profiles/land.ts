import type { SymbolSet3DProfile } from "../types";

export const LAND_SYMBOL_SET_PROFILES: SymbolSet3DProfile[] = [
  { symbolSet: "10", name: "Land unit", renderMode: "billboard" },
  { symbolSet: "11", name: "Land civilian unit/organization", renderMode: "billboard" },
  { symbolSet: "15", name: "Land equipment", renderMode: "billboard" },
  { symbolSet: "20", name: "Land installations", renderMode: "installationFootprint" },
  { symbolSet: "25", name: "Control measure", renderMode: "billboard" },
  { symbolSet: "27", name: "Dismounted individual", renderMode: "billboard" },
];
