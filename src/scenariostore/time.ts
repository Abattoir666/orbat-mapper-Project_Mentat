import type { NewScenarioStore } from "./newScenarioStore";
import type { CurrentState, ScenarioEvent } from "@/types/scenarioModels";
import type {
    NScenarioEvent,
    NScenarioFeature,
    NUnit,
    ScenarioEventUpdate,
} from "@/types/internalModels";
import dayjs, { type ManipulateType } from "dayjs";
import { computed } from "vue";
import turfLength from "@turf/length";
import turfAlong from "@turf/along";
import { lineString } from "@turf/helpers";
import type { EntityId } from "@/types/base";
import { klona } from "klona";
import { createEventHook } from "@vueuse/core";
import { invalidateUnitStyle } from "@/geo/unitStyles";
import type { CurrentScenarioFeatureState } from "@/types/scenarioGeoModels";
import { nanoid } from "@/utils";

export type GoToScenarioEventOptions = {
    silent?: boolean;
};

export type GoToScenarioEventEvent = {
    event: NScenarioEvent;
};

export function createInitialState(unit: NUnit): CurrentState | null {
    if (
        unit.location ||
        unit.equipment?.length ||
        unit.personnel?.length ||
        unit.supplies?.length
    )
        return {
            t: Number.MIN_SAFE_INTEGER,
            location: unit.location,
            type: "initial",
            sidc: unit.sidc,
            equipment: klona(unit.equipment),
            personnel: klona(unit.personnel),
            supplies: klona(unit.supplies),
        };
    return null;
}

export function updateCurrentUnitState(unit: NUnit, timestamp: number) {
    if (!unit.state || !unit.state.length) {
        unit._state = createInitialState(unit);
        return;
    }
    let currentState = createInitialState(unit);
    for (const s of unit.state) {
        if (s.t <= timestamp) {
            const { diff, update, ...rest } = s;
            if (update?.equipment && currentState?.equipment) {
                for (const e of update.equipment) {
                    const idx = currentState.equipment.findIndex((ee) => ee.id === e.id);
                    if (idx !== -1) {
                        currentState.equipment[idx] = { ...currentState.equipment[idx], ...e };
                    } else {
                        console.warn("Equipment not found", e);
                    }
                }
            }
            if (update?.personnel && currentState?.personnel) {
                for (const p of update.personnel) {
                    const idx = currentState.personnel.findIndex((pp) => pp.id === p.id);
                    if (idx !== -1) {
                        currentState.personnel[idx] = { ...currentState.personnel[idx], ...p };
                    } else {
                        console.warn("Personnel not found", p);
                    }
                }
            }

            if (update?.supplies && currentState?.supplies) {
                for (const p of update.supplies) {
                    const idx = currentState.supplies.findIndex((pp) => pp.id === p.id);
                    if (idx !== -1) {
                        currentState.supplies[idx] = { ...currentState.supplies[idx], ...p };
                    } else {
                        console.warn("Supplies not found", p);
                    }
                }
            }

            if (diff?.equipment && currentState?.equipment) {
                for (const e of diff.equipment) {
                    const idx = currentState.equipment.findIndex((ee) => ee.id === e.id);
                    if (idx !== -1) {
                        const eq = currentState.equipment[idx];
                        const onHand = (eq?.onHand ?? eq.count) + (e.onHand ?? 0);
                        currentState.equipment[idx] = { ...currentState.equipment[idx], onHand };
                    } else {
                        console.warn("Equipment not found", e);
                    }
                }
            }
            if (diff?.personnel && currentState?.personnel) {
                for (const p of diff.personnel) {
                    const idx = currentState.personnel.findIndex((pp) => pp.id === p.id);
                    if (idx !== -1) {
                        const pe = currentState.personnel[idx];
                        const onHand = (pe?.onHand ?? pe.count) + (p.onHand ?? 0);
                        currentState.personnel[idx] = { ...currentState.personnel[idx], onHand };
                    } else {
                        console.warn("Personnel not found", p);
                    }
                }
            }

            if (diff?.supplies && currentState?.supplies) {
                for (const p of diff.supplies) {
                    const idx = currentState.supplies.findIndex((pp) => pp.id === p.id);
                    if (idx !== -1) {
                        const pe = currentState.supplies[idx];
                        const onHand = (pe?.onHand ?? pe.count) + (p.onHand ?? 0);
                        currentState.supplies[idx] = { ...currentState.supplies[idx], onHand };
                    } else {
                        console.warn("Supplies not found", p);
                    }
                }
            }
            currentState = { ...currentState, ...rest };
        } else {
            if (
                currentState?.location &&
                s.location &&
                !(s.interpolate === false) &&
                (s.viaStartTime ?? -Infinity) <= timestamp
            ) {
                const n = lineString(
                    s.via
                        ? [currentState.location, ...s.via, s.location]
                        : [currentState.location, s.location],
                );
                const timeDiff = s.t - (s.viaStartTime ?? currentState.t);
                const pathLength = turfLength(n); // kilometers (turf default)
                const averageSpeed = pathLength / timeDiff; // km per ms
                const p = turfAlong(
                    n,
                    averageSpeed * (timestamp - (s.viaStartTime ?? currentState.t)), // kilometers
                );
                currentState = {
                    ...currentState,
                    t: timestamp,
                    location: p.geometry.coordinates as [number, number],
                    type: "interpolated",
                };
            }
            break;
        }
    }
    if (currentState?.sidc !== unit._state?.sidc) {
        invalidateUnitStyle(unit.id);
    }
    unit._state = currentState;
}

function createInitialFeatureState(
    feature: NScenarioFeature,
): CurrentScenarioFeatureState | null {
    return {
        t: Number.MIN_SAFE_INTEGER,
        geometry: feature.geometry,
    };
}

export function useScenarioTime(store: NewScenarioStore) {
    const { state, update } = store;

    const goToScenarioEventHook = createEventHook<GoToScenarioEventEvent>();

    function setCurrentTime(timestamp: number) {
        Object.values(state.unitMap).forEach((unit) =>
            updateCurrentUnitState(unit, timestamp),
        );
        Object.values(state.layerMap).forEach((layer) => {
            const visibleFromT = layer.visibleFromT || Number.MIN_SAFE_INTEGER;
            const visibleUntilT = layer.visibleUntilT || Number.MAX_SAFE_INTEGER;
            layer._hidden = timestamp <= visibleFromT || timestamp >= visibleUntilT;
            layer.features.forEach((featureId) => {
                const feature = state.featureMap[featureId];
                const visibleFromT = feature.meta.visibleFromT || Number.MIN_SAFE_INTEGER;
                const visibleUntilT = feature.meta.visibleUntilT || Number.MAX_SAFE_INTEGER;
                if (!feature) return;
                feature._hidden = timestamp <= visibleFromT || timestamp >= visibleUntilT;
                if (feature.state?.length) {
                    let currentState = createInitialFeatureState(feature);
                    for (const s of feature.state) {
                        if (s.t <= timestamp) {
                            currentState = { ...currentState, ...s };
                        } else {
                            break;
                        }
                    }
                    feature._state = currentState;
                }
            });
        });
        state.currentTime = timestamp;
    }

    function add(amount: number, unit: ManipulateType, normalize = false) {
        const newTime = normalize
            ? dayjs(state.currentTime).add(amount, unit).tz(timeZone.value).hour(12)
            : dayjs(state.currentTime).add(amount, unit);
        setCurrentTime(newTime.valueOf());
    }

    function subtract(amount: number, unit: ManipulateType, normalize = false) {
        const newTime = normalize
            ? dayjs(state.currentTime).subtract(amount, unit).tz(timeZone.value).hour(12)
            : dayjs(state.currentTime).subtract(amount, unit);
        setCurrentTime(newTime.valueOf());
    }

    function jumpToNextEvent() {
        let newTime = Number.MAX_SAFE_INTEGER;
        Object.values(state.unitMap).forEach((unit) => {
            if (!unit?.state?.length) {
                return;
            }
            for (const s of unit.state) {
                if (s.t > state.currentTime) {
                    if (s.t < newTime) newTime = s.t;
                    break;
                }
            }
        });
        if (newTime < Number.MAX_SAFE_INTEGER) setCurrentTime(newTime);
    }

    function jumpToPrevEvent() {
        let newTime = Number.MIN_SAFE_INTEGER;
        Object.values(state.unitMap).forEach((unit) => {
            if (!unit?.state?.length) {
                return;
            }
            for (const s of unit.state) {
                if (s.t < state.currentTime) {
                    if (s.t > newTime) newTime = s.t;
                    break;
                }
            }
        });
        if (newTime > Number.MIN_SAFE_INTEGER) setCurrentTime(newTime);
    }

    function computeTimeHistogram() {
        const histogram: Record<number, number> = {};
        let max = 1;

        Object.values(state.unitMap).forEach((unit) => {
            (unit?.state || []).forEach((s) => {
                // round to nearest hour
                const t = Math.round(s.t / 3600000) * 3600000;
                histogram[t] = (histogram[t] || 0) + 1;
                max = Math.max(max, histogram[t]);
            });
        });

        Object.values(state.featureMap).forEach((feature) => {
            (feature?.state || []).forEach((s) => {
                // round to nearest hour
                const t = Math.round(s.t / 3600000) * 3600000;
                histogram[t] = (histogram[t] || 0) + 1;
                max = Math.max(max, histogram[t]);
            });
        });

        return {
            histogram: Object.entries(histogram).map(([k, v]) => ({ t: +k, count: v })),
            max,
        };
    }

    function goToNextScenarioEvent(options: GoToScenarioEventOptions = {}) {
        const nextEventId = state.events.find(
            (event) => state.eventMap[event].startTime > state.currentTime,
        );
        const nextEvent = nextEventId && state.eventMap[nextEventId];
        const newTime = nextEvent ? nextEvent.startTime : Number.MAX_SAFE_INTEGER;
        if (newTime < Number.MAX_SAFE_INTEGER) goToScenarioEvent(nextEvent!, options);
    }

    function goToPrevScenarioEvent(options: GoToScenarioEventOptions = {}) {
        const prevEventId = state.events
            .slice()
            .reverse()
            .find((event) => state.eventMap[event].startTime < state.currentTime);
        const prevEvent = prevEventId && state.eventMap[prevEventId];
        const newTime = prevEvent ? prevEvent.startTime : Number.MIN_SAFE_INTEGER;
        if (newTime > Number.MIN_SAFE_INTEGER) goToScenarioEvent(prevEvent!, options);
    }

    function goToScenarioEvent(
        eventOrEventId: EntityId | NScenarioEvent,
        options: GoToScenarioEventOptions = {},
    ) {
        const event =
            typeof eventOrEventId === "string"
                ? state.eventMap[eventOrEventId]
                : eventOrEventId;
        if (event) {
            setCurrentTime(event.startTime);
            if (!options.silent) {
                goToScenarioEventHook.trigger({ event }).then();
            }
        }
    }

    const utcTime = computed(() => {
        return dayjs.utc(state.currentTime);
    });

    const scenarioTime = computed(() => {
        return dayjs(state.currentTime).tz(state.info.timeZone || "UTC");
    });

    const timeZone = computed(() => {
        return state.info.timeZone;
    });

    function getEventById(id: EntityId) {
        return state.eventMap[id];
    }

    function addScenarioEvent(event: NScenarioEvent | ScenarioEvent) {
        let newEvent = klona(event) as NScenarioEvent;
        if (!newEvent.id) newEvent.id = nanoid();
        if (!newEvent._type) newEvent._type = "scenario";
        update((s) => {
            s.events.push(newEvent.id);
            s.eventMap[newEvent.id] = newEvent;
            s.events.sort((a, b) => s.eventMap[a].startTime - s.eventMap[b].startTime);
        });
        return newEvent.id;
    }

    function deleteScenarioEvent(id: EntityId) {
        update((s) => {
            s.events = s.events.filter((e) => e !== id);
            delete s.eventMap[id];
        });
    }

    function updateScenarioEvent(id: EntityId, data: ScenarioEventUpdate) {
        const event = getEventById(id);
        if (!event) return;
        if (event._type === "scenario") {
            update((s) => {
                const e = s.eventMap[id];
                if (!e) return;
                s.eventMap[e.id] = klona(Object.assign(e, { ...data }));
                if ("startTime" in data) {
                    s.events.sort((a, b) => s.eventMap[a].startTime - s.eventMap[b].startTime);
                }
            });
        } else {
            console.warn("Cannot update non-scenario event yet");
        }
    }

    return {
        setCurrentTime,
        add,
        subtract,
        utcTime,
        scenarioTime,
        timeZone,
        jumpToNextEvent,
        jumpToPrevEvent,
        goToScenarioEvent,
        goToNextScenarioEvent,
        goToPrevScenarioEvent,
        getEventById,
        addScenarioEvent,
        updateScenarioEvent,
        deleteScenarioEvent,
        computeTimeHistogram,
        onGoToScenarioEventEvent: goToScenarioEventHook.on,
    };
}

// ───────────────────────── 3D/2D motion bridge helpers ─────────────────────────
export type LonLatAlt = { lon: number; lat: number; alt?: number };

function isLonLat(v: any): v is [number, number] {
    return Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number";
}

/**
 * Return the best-known lon/lat for a unit at time tMs:
 * - If we are between two states that both yield a path (prevLoc → nextLoc), interpolate with the same
 *   average-speed-along-line method used by updateCurrentUnitState.
 * - Otherwise, snap to the last known location at/before tMs (prev state with a location, or _state/location).
 * - Never mutates the unit.
 */
export function getUnitPositionAtTime(
    unit: { state?: any[]; location?: [number, number]; _state?: any },
    tMs: number
): LonLatAlt | undefined {
    const states = (unit?.state ?? []).slice().sort((a, b) => a.t - b.t) as Array<any>;

    // Find last state at/before tMs (could be non-location update)
    let prevIdx = -1;
    for (let i = 0; i < states.length; i++) {
        if (states[i].t <= tMs) prevIdx = i; else break;
    }

    // Find first state after tMs
    let nextIdx = -1;
    for (let i = prevIdx + 1; i < states.length; i++) {
        if (states[i].t > tMs) { nextIdx = i; break; }
    }

    // Resolve prev location by scanning backward until we find a state with .location;
    // if none, fall back to unit._state.location or unit.location.
    let prevLoc: [number, number] | undefined = undefined;
    let prevT: number | undefined = undefined;
    for (let i = prevIdx; i >= 0; i--) {
        const s = states[i];
        if (isLonLat(s.location)) { prevLoc = s.location; prevT = s.t; break; }
    }
    if (!prevLoc) {
        const fallback = unit._state?.location ?? unit.location;
        if (isLonLat(fallback)) { prevLoc = fallback; prevT = states[prevIdx]?.t ?? Number.NEGATIVE_INFINITY; }
    }

    // Resolve next state WITH a location (skip non-location updates)
    let next: any | undefined;
    if (nextIdx !== -1) {
        for (let i = nextIdx; i < states.length; i++) {
            const s = states[i];
            if (isLonLat(s.location)) { next = s; break; }
        }
    }

    // Interpolate if possible
    if (
        prevLoc &&
        next &&
        !(next.interpolate === false) &&
        (next.viaStartTime ?? prevT ?? Number.NEGATIVE_INFINITY) <= tMs
    ) {
        const coords: [number, number][] = next.via ? [prevLoc, ...next.via, next.location] : [prevLoc, next.location];

        const line = lineString(coords);
        const pathLengthKm = turfLength(line); // kilometers
        const startMs = next.viaStartTime ?? prevT ?? tMs;
        const timeDiffMs = next.t - startMs;

        if (timeDiffMs > 0 && pathLengthKm > 0) {
            const avgSpeedKmPerMs = pathLengthKm / timeDiffMs;
            const elapsedMs = Math.max(0, tMs - startMs);
            const distKm = Math.min(pathLengthKm, avgSpeedKmPerMs * elapsedMs);

            const pt = turfAlong(line, distKm); // kilometers
            const [lon, lat] = pt.geometry.coordinates as [number, number];
            return { lon, lat };
        }
    }

    // Snap to last known location
    if (prevLoc) {
        return { lon: prevLoc[0], lat: prevLoc[1] };
    }
    return undefined;
}
