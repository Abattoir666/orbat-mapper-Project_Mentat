// src/composables/getUnitLonLatStrict.ts
import type { Unit } from "@/types/scenarioModels";

type Position = [number, number] | [number, number, number];

function isPosition(x: any): x is Position {
  return (
    Array.isArray(x) &&
    x.length >= 2 &&
    typeof x[0] === "number" &&
    typeof x[1] === "number" &&
    x[0] >= -180 && x[0] <= 180 &&
    x[1] >= -90 && x[1] <= 90
  );
}

/** STRICT interpretation: only accept Unit.location or last State.location */
export function getUnitLonLatStrict(u: Unit): [number, number] | undefined {
  // Primary: unit.location
  if (isPosition((u as any).location)) {
    const [lon, lat] = (u as any).location;
    return [lon, lat];
  }

  // Secondary: latest state location
  const states = (u as any).state;
  if (Array.isArray(states) && states.length > 0) {
    const last = states[states.length - 1];
    if (isPosition(last?.location)) {
      const [lon, lat] = last.location;
      return [lon, lat];
    }
  }

  return undefined;
}
