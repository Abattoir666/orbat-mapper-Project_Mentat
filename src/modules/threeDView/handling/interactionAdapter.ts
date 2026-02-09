import * as Cesium from "cesium";
import { inject, provide, ref, type InjectionKey, type Ref } from "vue";
import type { Position } from "geojson";

/**
 * We use GeoJSON Position order: [lon, lat, alt?]
 */
export type GlobePickPosition = Position;

export interface InteractionAdapter {
  /** True while we're in a one-shot "pick a location" mode. */
  isPickingLocation: Readonly<Ref<boolean>>;

  /** One-shot pick: next LEFT_CLICK yields [lon,lat,alt?], then auto-cancels. */
  requestLocationPick(cb: (pos: GlobePickPosition) => void): void;

  /** Cancel any active pick mode. */
  cancelLocationPick(): void;
}

export const interactionAdapterKey: InjectionKey<InteractionAdapter> =
  Symbol("mentatInteractionAdapter");

/**
 * Some UI (toolbars, dock panels) may not be descendants of GlobeView,
 * so Vue inject() can legitimately fail in 3D mode. We keep a global fallback.
 */
let globalAdapter: InteractionAdapter | null = null;

function getViewerFromWindow(): Cesium.Viewer | undefined {
  const g: any = (globalThis as any).MentatGlobe;
  return (g?.getViewer?.() ?? g?.viewer) as Cesium.Viewer | undefined;
}

export function provideInteractionAdapter(adapter: InteractionAdapter) {
  provide(interactionAdapterKey, adapter);
  // Also store globally so non-descendant components can still pick locations.
  globalAdapter = adapter;
}

export function useInteractionAdapter(): InteractionAdapter {
  const a = inject(interactionAdapterKey, null);
  if (a) return a;

  // Fallback: create a singleton Cesium-backed adapter using window.MentatGlobe viewer.
  if (!globalAdapter) {
    globalAdapter = createCesiumInteractionAdapter(() => getViewerFromWindow());
    console.warn(
      "[InteractionAdapter] Not provided via inject(); using window.MentatGlobe fallback."
    );
  }
  return globalAdapter;
}

/**
 * Cesium-backed adapter. Does NOT depend on OpenLayers.
 */
export function createCesiumInteractionAdapter(
  getViewer: () => Cesium.Viewer | undefined
): InteractionAdapter {
  const isPickingLocation = ref(false);
  let handler: Cesium.ScreenSpaceEventHandler | null = null;

  function setCursor(cursor: string) {
    try {
      const v = getViewer();
      const canvas = v?.scene?.canvas as HTMLCanvasElement | undefined;
      if (canvas) canvas.style.cursor = cursor;
    } catch {
      /* ignore */
    }
  }

  function cancelLocationPick() {
    isPickingLocation.value = false;
    try {
      handler?.destroy();
    } catch {
      /* ignore */
    }
    handler = null;
    setCursor("");
  }

  function requestLocationPick(cb: (pos: GlobePickPosition) => void) {
    const viewer = getViewer();
    if (!viewer) {
      console.warn("[InteractionAdapter] requestLocationPick called but viewer is unavailable");
      return;
    }

    cancelLocationPick();
    isPickingLocation.value = true;
    setCursor("crosshair");

    handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    handler.setInputAction(
      (movement: any) => {
        try {
          const screen = movement?.position ?? movement?.endPosition;
          if (!screen) return;

          const cart =
            viewer.scene.pickPosition?.(screen) ??
            viewer.camera.pickEllipsoid(screen, viewer.scene.globe.ellipsoid);

          if (!cart) return;

          const carto = Cesium.Cartographic.fromCartesian(cart);
          const lon = Cesium.Math.toDegrees(carto.longitude);
          const lat = Cesium.Math.toDegrees(carto.latitude);
          const alt = Number.isFinite(carto.height) ? carto.height : 0;

          cb([lon, lat, alt]);
        } catch (e) {
          console.warn("[InteractionAdapter] pick failed:", e);
        } finally {
          cancelLocationPick();
        }
      },
      Cesium.ScreenSpaceEventType.LEFT_CLICK
    );

    handler.setInputAction(
      () => cancelLocationPick(),
      Cesium.ScreenSpaceEventType.RIGHT_CLICK
    );
  }

  return { isPickingLocation, requestLocationPick, cancelLocationPick };
}
