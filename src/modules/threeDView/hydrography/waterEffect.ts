/* eslint-disable @typescript-eslint/no-explicit-any */
// src/modules/threeDView/hydrography/waterEffect.ts

import type { Viewer } from "cesium";

/**
 * Cesium globe water effect toggle (water-mask shader). On/off.
 */
export function applyWaterEffectEnabled(viewer: Viewer, enabled: boolean): void {
    try {
        (viewer.scene.globe as any).showWaterEffect = !!enabled;
    } catch {
        // ignore
    }
    viewer.scene.requestRender();
}
