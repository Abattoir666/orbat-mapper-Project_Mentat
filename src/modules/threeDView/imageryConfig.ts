// src/modules/threeDView/imageryConfig.ts
// -----------------------------------------------------------------------------
// This file simply re-exports makeImageryProviders for backward compatibility.
// The authoritative imagery registry now lives in makeImageryProviders.ts.
// -----------------------------------------------------------------------------

export { makeImageryProviders } from "./makeImageryProviders";
export type { ImageryEntry } from "./makeImageryProviders";

console.log("[imageryConfig] Deprecated: use makeImageryProviders.ts directly.");
