import type { Position } from "geojson";
import { useInteractionAdapter } from "./interactionAdapter";

/**
 * One-shot "move unit": pick a globe location and call provided setter.
 */
export function useMoveUnit3D(setUnitPosition: (unitId: string, pos: Position) => void) {
  const ia = useInteractionAdapter();

  function moveUnit(unitId: string) {
    ia.requestLocationPick((pos) => {
      // pos is [lon, lat, alt?]
      setUnitPosition(unitId, pos);
    });
  }

  function cancelMove() {
    ia.cancelLocationPick();
  }

  return { moveUnit, cancelMove, isActive: ia.isPickingLocation };
}
