import type { NewScenarioStore } from "@/scenariostore/newScenarioStore";
import type { NState, NUnit } from "@/types/internalModels";
import { mergeArray, nanoid } from "@/utils";
import { klona } from "klona";
import type { EntityId, HistoryAction } from "@/types/base";
import { createInitialState, updateCurrentUnitState } from "@/scenariostore/time";
import type { State, StateAdd } from "@/types/scenarioModels";
import { type Position } from "@/types/scenarioGeoModels";

function isFiniteNumber(v: unknown): v is number {
    return typeof v === "number" && Number.isFinite(v);
}

function altOf(pos: Position | null | undefined): number | undefined {
    if (!pos) return undefined;
    const z = (pos as any)[2];
    return isFiniteNumber(z) ? z : undefined;
}

/**
 * If `next` is XY-only and `prev` has Z, carry Z forward.
 * - next === null => explicit clear
 * - next === undefined => no-op
 */
function mergeAltitude(
    prev: Position | null | undefined,
    next: Position | null | undefined,
): Position | null | undefined {
    if (next === null) return null;
    if (next === undefined) return undefined;

    const nextZ = altOf(next);
    if (nextZ !== undefined) return next;

    const prevZ = altOf(prev);
    if (prevZ !== undefined) return [next[0], next[1], prevZ];

    return [next[0], next[1]];
}

function getPrevLocationAtOrBefore(u: NUnit, t: number): Position | null | undefined {
    // baseline: initial location if present
    let baseline: Position | null | undefined = (u.location as any) ?? undefined;

    const st = u.state;
    if (!st?.length) return baseline;

    for (let i = st.length - 1; i >= 0; i--) {
        const s = st[i];
        if (!s) continue;
        if (s.t > t) continue;

        if (s.location === null) return null;
        if (s.location !== undefined) return s.location as any;
    }

    return baseline;
}

export function removeUnusedUnitStateEntries(unit: NUnit) {
    if (!unit || !unit.state) return;
    const usedEquipmentIds = new Set(unit.equipment?.map((e) => e.id) ?? []);
    const usedPersonnelIds = new Set(unit.personnel?.map((e) => e.id) ?? []);
    const usedSupplyIds = new Set(unit.supplies?.map((e) => e.id) ?? []);

    const filteredState = unit.state.map((state) => {
        const update = state.update;
        const diff = state.diff;
        if (update) {
            update.equipment = update.equipment?.filter((e) => usedEquipmentIds.has(e.id));
            if (update.equipment?.length === 0) delete update.equipment;
            update.personnel = update.personnel?.filter((e) => usedPersonnelIds.has(e.id));
            if (update.personnel?.length === 0) delete update.personnel;
            update.supplies = update.supplies?.filter((e) => usedSupplyIds.has(e.id));
            if (update.supplies?.length === 0) delete update.supplies;
            if (!update.equipment && !update.personnel && !update.supplies) {
                delete state.update;
            }
        }

        if (diff) {
            diff.equipment = diff.equipment?.filter((e) => usedEquipmentIds.has(e.id));
            if (diff.equipment?.length === 0) delete diff.equipment;
            diff.personnel = diff.personnel?.filter((e) => usedPersonnelIds.has(e.id));
            if (diff.personnel?.length === 0) delete diff.personnel;
            diff.supplies = diff.supplies?.filter((e) => usedSupplyIds.has(e.id));
            if (diff.supplies?.length === 0) delete diff.supplies;
            if (!diff.equipment && !diff.personnel && !diff.supplies) {
                delete state.diff;
            }
        }

        return state;
    });

    unit.state = filteredState;
}

export function useUnitStateManipulations(store: NewScenarioStore) {
    const { state, update } = store;

    function updateUnitState(unitId: EntityId) {
        const unit = state.unitMap[unitId];
        if (!unit) return;
        const timestamp = state.currentTime;
        updateCurrentUnitState(unit, timestamp);
        state.unitStateCounter++;
    }

    function clearUnitState(unitId: EntityId) {
        update((s) => {
            const unit = s.unitMap[unitId];
            if (!unit) return;
            unit.state = [];
        });
        updateUnitState(unitId);
    }

    function deleteUnitStateEntryByStateId(unitId: EntityId, stateId: string) {
        update((s) => {
            const unit = s.unitMap[unitId];
            if (!unit?.state) return;
            const idx = unit.state.findIndex((x) => x.id === stateId);
            if (idx >= 0) unit.state.splice(idx, 1);
        });
        updateUnitState(unitId);
    }

    function addUnitStateEntry(unitId: EntityId, stateAdd: StateAdd, merge = false) {
        update(
            (s) => {
                const u = s.unitMap[unitId];
                if (!u) return;

                const newState = klona(stateAdd) as any;
                newState.id = nanoid();

                if (!u.state) u.state = [];
                const t = stateAdd.t;

                // Preserve Z when caller provides XY-only
                if (Object.prototype.hasOwnProperty.call(newState, "location")) {
                    const prev = getPrevLocationAtOrBefore(u, t);
                    newState.location = mergeAltitude(prev as any, newState.location as any);
                }

                for (let i = 0, len = u.state.length; i < len; i++) {
                    if (t <= u.state[i].t) {
                        if (merge && u.state[i].t === t) {
                            // Merge into existing at the same timestamp
                            const {
                                id,
                                t: _t,
                                update: upd,
                                diff,
                                location,
                                via,
                                ...rest
                            } = newState;

                            Object.assign(u.state[i], rest);

                            if (Object.prototype.hasOwnProperty.call(newState, "location")) {
                                const prev = u.state[i].location ?? getPrevLocationAtOrBefore(u, t);
                                (u.state[i] as any).location = mergeAltitude(prev as any, location as any);
                            }
                            if (via !== undefined) (u.state[i] as any).via = via;

                            if (upd) {
                                const source = u.state[i]?.update || {};
                                const dest = {
                                    equipment:
                                        source.equipment || upd.equipment
                                            ? mergeArray(source.equipment ?? [], upd.equipment ?? [], "id")
                                            : undefined,
                                    personnel:
                                        source.personnel || upd.personnel
                                            ? mergeArray(source.personnel ?? [], upd.personnel ?? [], "id")
                                            : undefined,
                                    supplies:
                                        source.supplies || upd.supplies
                                            ? mergeArray(source.supplies ?? [], upd.supplies ?? [], "id")
                                            : undefined,
                                };
                                Object.assign(u.state[i], { update: dest });
                            }

                            if (diff) {
                                const source = u.state[i]?.diff || {};
                                const dest = {
                                    equipment:
                                        source.equipment || diff.equipment
                                            ? mergeArray(source.equipment ?? [], diff.equipment ?? [], "id")
                                            : undefined,
                                    personnel:
                                        source.personnel || diff.personnel
                                            ? mergeArray(source.personnel ?? [], diff.personnel ?? [], "id")
                                            : undefined,
                                    supplies:
                                        source.supplies || diff.supplies
                                            ? mergeArray(source.supplies ?? [], diff.supplies ?? [], "id")
                                            : undefined,
                                };
                                Object.assign(u.state[i], { diff: dest });
                            }

                        } else {
                            u.state.splice(i, 0, newState as NState);
                        }
                        return;
                    }
                }

                u.state.push(newState as NState);
            },
            { label: "addUnitPosition", value: unitId },
        );

        updateUnitState(unitId);
    }

    function deleteUnitStateEntry(unitId: EntityId, index: number) {
        update((s) => {
            const _unit = s.unitMap[unitId];
            if (!_unit) return;
            _unit.state?.splice(index, 1);
        });
        updateUnitState(unitId);
    }

    function updateUnitStateEntry(unitId: EntityId, index: number, data: Partial<State>) {
        update((s) => {
            const unit = s.unitMap[unitId];
            if (!unit?.state) return;

            const cur = unit.state[index];
            if (!cur) return;

            const patch: any = { ...data };

            // Preserve Z on XY-only location updates
            if (Object.prototype.hasOwnProperty.call(patch, "location")) {
                const prev = (cur.location as any) ?? getPrevLocationAtOrBefore(unit, cur.t);
                patch.location = mergeAltitude(prev as any, patch.location as any);
            }

            Object.assign(cur, patch);
            unit.state.sort(({ t: a }, { t: b }) => (a < b ? -1 : a > b ? 1 : 0));
        });

        state.unitStateCounter++;
        updateUnitState(unitId);
    }

    function setUnitState(unitId: EntityId, nextState: NState[]) {
        update((s) => {
            const unit = s.unitMap[unitId];
            if (!unit) return;
            unit.state = nextState;
        });
        updateUnitState(unitId);
    }

    function setUnitStateAtCurrentTime(unitId: EntityId, stateAdd: StateAdd, merge = true) {
        addUnitStateEntry(unitId, { ...stateAdd, t: store.state.currentTime }, merge);
    }

    function updateUnitStateVia(
        unitId: EntityId,
        action: HistoryAction,
        stateIndex: number,
        elementIndex: number,
        data: Position,
    ) {
        update(
            (s) => {
                const unit = s.unitMap[unitId];
                if (!unit || !unit.state) return;

                const stateElement = unit.state[stateIndex];
                if (!stateElement) return;

                if (!stateElement.via) stateElement.via = [];

                if (action === "add") {
                    stateElement.via.splice(elementIndex, 0, data);
                } else if (action === "modify") {
                    const prev = stateElement.via[elementIndex];
                    stateElement.via[elementIndex] = (mergeAltitude(prev as any, data as any) ?? data) as any;
                } else if (action === "remove") {
                    stateElement.via.splice(elementIndex, 1);
                }
            },
            { label: "addUnitPosition", value: unitId },
        );
    }

    function setUnitState(unitId: EntityId, newState: NState[]) {
        update((s) => {
            const unit = s.unitMap[unitId];
            if (!unit) return;
            unit.state = newState;
        });
        updateUnitState(unitId);
    }

    function setUnitStateVia(unitId: EntityId, stateIndex: number, via: Position[] | undefined) {
        update((s) => {
            const unit = s.unitMap[unitId];
            if (!unit?.state) return;
            const se = unit.state[stateIndex];
            if (!se) return;
            (se as any).via = via;
        });
    }

    function setUnitStateAtTime(unitId: EntityId, timestamp: number) {
        const unit = state.unitMap[unitId];
        if (!unit) return;

        // ensure initial state exists so subsequent state changes have a baseline
        createInitialState(unit);

        // ensures _state reflects current time
        updateCurrentUnitState(unit, timestamp);
        state.unitStateCounter++;
    }

    return {
        clearUnitState,
        updateUnitState,
        deleteUnitStateEntryByStateId,
        addUnitStateEntry,
        deleteUnitStateEntry,
        updateUnitStateEntry,
        setUnitState,
        setUnitStateAtCurrentTime,
        updateUnitStateVia,
        setUnitStateAtTime,
    };
}
