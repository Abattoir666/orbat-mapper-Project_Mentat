// src/modules/scenarioeditor/bulkEdit/quickBulkActions.ts

export type ScenarioStoreLike = {
  unitMap?: any; // Map | Record | Array or a Ref to one
  state?: { unitMap?: any };
  history?: { push?: (entry: { undo: () => void; redo: () => void }) => void };
};

function getUnitMap(store: ScenarioStoreLike) {
  const um =
    (store as any)?.unitMap?.value ??
    (store as any)?.unitMap ??
    (store as any)?.state?.unitMap;
  return um;
}

function getUnit(store: ScenarioStoreLike, id: string): any | undefined {
  const um = getUnitMap(store);
  if (!um) return undefined;
  if (typeof um.get === "function") return um.get(id); // Map
  if (Array.isArray(um)) return um.find((u: any) => u?.id === id); // Array
  if (typeof um === "object") return (um as any)[id]; // Dict
  return undefined;
}

function setUnit(store: ScenarioStoreLike, u: any) {
  const um = getUnitMap(store);
  if (!um || !u) return;
  if (typeof um.set === "function") {
    um.set(u.id, u);
    return; // Map
  }
  if (Array.isArray(um)) {
    const i = um.findIndex((x: any) => x?.id === u.id);
    if (i >= 0) um.splice(i, 1, u);
    return;
  }
  if (typeof um === "object") {
    (um as any)[u.id] = u;
  }
}

/** Minimal field snapshot so we don't clone reactive or circular data */
type SidcSnapshot = { id: string; prevSidc?: string };
type FillSnapshot = { id: string; prevFill?: string; hadSymbolOptions: boolean };

export function setSidcBulk(
  store: ScenarioStoreLike,
  ids: Iterable<string>,
  sidc: string
) {
  const v = String(sidc || "").trim();
  if (!v) return;

  const list = Array.from(ids);
  if (!list.length) return;

  const before: SidcSnapshot[] = [];

  // compute next values and apply
  for (const id of list) {
    const cur = getUnit(store, id);
    if (!cur) continue;
    before.push({ id, prevSidc: cur.sidc });
    setUnit(store, { ...cur, sidc: v });
  }

  // undo/redo only touches sidc
  store?.history?.push?.({
    undo: () => {
      for (const snap of before) {
        const cur = getUnit(store, snap.id);
        if (!cur) continue;
        setUnit(store, { ...cur, sidc: snap.prevSidc });
      }
    },
    redo: () => {
      for (const id of list) {
        const cur = getUnit(store, id);
        if (!cur) continue;
        setUnit(store, { ...cur, sidc: v });
      }
    },
  });
}

export function setFillColorBulk(
  store: ScenarioStoreLike,
  ids: Iterable<string>,
  fillColor: string
) {
  const v = String(fillColor || "").trim();
  if (!v) return;

  const list = Array.from(ids);
  if (!list.length) return;

  const before: FillSnapshot[] = [];

  // compute next values and apply
  for (const id of list) {
    const cur = getUnit(store, id);
    if (!cur) continue;

    const hadSymbolOptions = !!cur.symbolOptions;
    const prevFill = cur.symbolOptions?.fillColor;

    before.push({ id, prevFill, hadSymbolOptions });

    const nextSO = { ...(cur.symbolOptions ?? {}), fillColor: v };
    setUnit(store, { ...cur, symbolOptions: nextSO });
  }

  // undo/redo only touches symbolOptions.fillColor (rest untouched)
  store?.history?.push?.({
    undo: () => {
      for (const snap of before) {
        const cur = getUnit(store, snap.id);
        if (!cur) continue;

        if (snap.hadSymbolOptions) {
          const so = { ...(cur.symbolOptions ?? {}) };
          if (typeof snap.prevFill === "undefined") {
            // remove the key if it didn't exist before
            if ("fillColor" in so) delete (so as any).fillColor;
          } else {
            (so as any).fillColor = snap.prevFill;
          }
          setUnit(store, { ...cur, symbolOptions: so });
        } else {
          // previously no symbolOptions at all
          const so = { ...(cur.symbolOptions ?? {}) };
          if ("fillColor" in so) delete (so as any).fillColor;
          // if SO becomes empty, you could remove it entirely:
          // const keys = Object.keys(so);
          // setUnit(store, { ...cur, ...(keys.length ? { symbolOptions: so } : { symbolOptions: undefined }) });
          setUnit(store, { ...cur, symbolOptions: so });
        }
      }
    },
    redo: () => {
      for (const id of list) {
        const cur = getUnit(store, id);
        if (!cur) continue;
        const so = { ...(cur.symbolOptions ?? {}), fillColor: v };
        setUnit(store, { ...cur, symbolOptions: so });
      }
    },
  });
}

/* ───────────────────── Delete states in time range (selected units only) ───────────────────── */

export type TimeRange = {
  from: string | Date;
  to: string | Date;
};

type StateSnapshot = {
  id: string;
  prevState: any[]; // previous unit.state array
  nextState: any[]; // new unit.state array
};

/**
 * Helper: return a copy of the unit with .state set to stateArr,
 * and _state updated to the latest state (highest t), or removed if none.
 */
function withStateAndSnapshot(unit: any, stateArr: any[]): any {
  const nextUnit: any = { ...unit, state: stateArr };

  if (Array.isArray(stateArr) && stateArr.length > 0) {
    let latest = stateArr[0];
    let latestT = Number(latest?.t ?? Number.NEGATIVE_INFINITY);

    for (const ev of stateArr) {
      const t = Number(ev?.t);
      if (Number.isFinite(t) && t > latestT) {
        latest = ev;
        latestT = t;
      }
    }

    // Copy the latest state object into _state
    nextUnit._state = latest ? { ...(latest ?? {}) } : undefined;
  } else {
    // No states left; remove _state if present
    if ("_state" in nextUnit) {
      delete nextUnit._state;
    }
  }

  return nextUnit;
}

/**
 * Mass-delete "state" entries for the GIVEN units whose `t` falls in [from, to].
 *
 * This matches what your OrbatLocationIngestor writes:
 *   - unit.state: JsonArray of states
 *   - each state has "t" (ms since Unix epoch) and "location" [lon, lat]
 *   - _state is kept as the latest state snapshot
 *
 * We:
 *   - Only touch `state` (singular).
 *   - Treat `t` as ms since epoch (number).
 *   - Keep states whose `t` is outside [fromMs, toMs].
 *   - Recompute _state after edits.
 *   - Record undo/redo in store.history.
 */
export function deleteEventsInTimeRangeForUnitsBulk(
  store: ScenarioStoreLike,
  ids: Iterable<string>,
  range: TimeRange
) {
  const fromMs = +new Date(range.from as any);
  const toMs = +new Date(range.to as any);

  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    console.warn(
      "[deleteEventsInTimeRangeForUnitsBulk] invalid date range",
      range
    );
    return;
  }
  if (fromMs > toMs) {
    console.warn("[deleteEventsInTimeRangeForUnitsBulk] from > to", range);
    return;
  }

  const selectedIds = Array.from(ids);
  if (!selectedIds.length) {
    console.warn(
      "[deleteEventsInTimeRangeForUnitsBulk] no unit IDs supplied"
    );
    return;
  }

  const snapshots: StateSnapshot[] = [];
  let unitsChanged = 0;
  let statesBefore = 0;
  let statesAfter = 0;

  for (const id of selectedIds) {
    const unit = getUnit(store, id);
    if (!unit) continue;

    const curState = Array.isArray((unit as any).state)
      ? (unit as any).state
      : null;
    if (!curState || curState.length === 0) continue;

    const prevState = curState.map((s: any) => ({ ...(s ?? {}) }));

    const nextState = curState.filter((s: any) => {
      const rawT = s?.t;
      const t = typeof rawT === "number" ? rawT : Number(rawT);
      if (!Number.isFinite(t)) {
        // No valid t => never auto-delete; safer to keep
        return true;
      }
      // Keep only if outside [fromMs, toMs]
      return t < fromMs || t > toMs;
    });

    if (nextState.length === curState.length) {
      // nothing deleted for this unit
      continue;
    }

    const nextStateCopy = nextState.map((s: any) => ({ ...(s ?? {}) }));

    const updatedUnit = withStateAndSnapshot(unit, nextStateCopy);
    setUnit(store, updatedUnit);

    snapshots.push({
      id,
      prevState,
      nextState: nextStateCopy,
    });

    unitsChanged += 1;
    statesBefore += prevState.length;
    statesAfter += nextStateCopy.length;
  }

  if (!snapshots.length) {
    console.info(
      "[deleteEventsInTimeRangeForUnitsBulk] no matching states found to delete"
    );
    return;
  }

  console.info(
    "[deleteEventsInTimeRangeForUnitsBulk] unitsChanged=%d, statesBefore=%d, statesAfter=%d, deleted=%d",
    unitsChanged,
    statesBefore,
    statesAfter,
    statesBefore - statesAfter
  );

  store?.history?.push?.({
    undo: () => {
      for (const snap of snapshots) {
        const cur = getUnit(store, snap.id);
        if (!cur) continue;
        const restoredUnit = withStateAndSnapshot(
          cur,
          snap.prevState.map((s) => ({ ...(s ?? {}) }))
        );
        setUnit(store, restoredUnit);
      }
    },
    redo: () => {
      for (const snap of snapshots) {
        const cur = getUnit(store, snap.id);
        if (!cur) continue;
        const reappliedUnit = withStateAndSnapshot(
          cur,
          snap.nextState.map((s) => ({ ...(s ?? {}) }))
        );
        setUnit(store, reappliedUnit);
      }
    },
  });
}
