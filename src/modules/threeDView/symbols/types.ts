export type Symbol3DRenderMode = "billboard" | "installationFootprint" | "block";

export interface SymbolSet3DProfile {
  symbolSet: string;
  name: string;
  renderMode: Symbol3DRenderMode;
}
