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

// ──────────────────────────────────────────────────────────────────────────────
// Public types (unchanged)
// ──────────────────────────────────────────────────────────────────────────────

export type GoToScenarioEventOptions = {
    silent?: boolean;
};

export type GoToScenarioEventEvent = {
    event: NScenarioEvent;
};

// ──────────────────────────────────────────────────────────────────────────────
// Initial state helpers (kept compatible with your original)
// ──────────────────────────────────────────────────────────────────────────────

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

function ensureNonNullState(unit: NUnit, st: CurrentState | null): CurrentState {
    // In practice, some scenarios can have state entries before a base location exists.
    // We must not leave _state as null or the map (and locationFilter) will hide the unit.
    if (st) return st;
    return {
        t: Number.MIN_SAFE_INTEGER,
        location: unit.location,
        type: "initial",
        sidc: unit.sidc,
        equipment: unit.equipment ? klona(unit.equipment) : undefined,
        personnel: unit.personnel ? klona(unit.personnel) : undefined,
        supplies: unit.supplies ? klona(unit.supplies) : undefined,
    } as any;
}

// ──────────────────────────────────────────────────────────────────────────────
// Runtime caches (per-unit / per-feature), kept off your persisted scenario model
// ──────────────────────────────────────────────────────────────────────────────

type UnitRt = {
    lastScrubTs: number;
    cursor: number;          // index of first state with t > lastScrubTs (in sortedStates)
    anchorT: number;         // last DISCRETE state time applied (not interpolated)
    anchorLoc?: [number, number];

    // sorted copy only when needed; NEVER mutates unit.state (important for Immer/freeze)
    sortedStates?: any[];
    sortedStatesSrc?: any[];

    // id -> index maps for in-place mutation
    eqIdx?: Map<string, number>;
    persIdx?: Map<string, number>;
    supIdx?: Map<string, number>;

    // interpolation segment cache
    seg?: {
        nextIndex: number; // cursor at which "next" lives
        line: ReturnType<typeof lineString>;
        pathLengthKm: number;
        startMs: number;
        avgSpeedKmPerMs: number;
    };
};

function getUnitRt(unit: NUnit): UnitRt {
    const u = unit as any;
    if (!u.__timeRt) {
        u.__timeRt = {
            lastScrubTs: Number.NEGATIVE_INFINITY,
            cursor: 0,
            anchorT: Number.MIN_SAFE_INTEGER,
        } satisfies UnitRt;
    }
    return u.__timeRt as UnitRt;
}

function isMonotonicStatesByT(states: any[]): boolean {
    for (let i = 1; i < states.length; i++) {
        if ((states[i - 1]?.t ?? 0) > (states[i]?.t ?? 0)) return false;
    }
    return true;
}

function getSortedStates(unit: NUnit, rt: UnitRt): any[] {
    const src = (unit as any).state ?? [];
    if (rt.sortedStates && rt.sortedStatesSrc === src) return rt.sortedStates;

    if (src.length <= 1 || isMonotonicStatesByT(src)) {
        rt.sortedStates = src;
        rt.sortedStatesSrc = src;
        return src;
    }

    // IMPORTANT: copy + sort; never mutate src
    const copy = src.slice().sort((a: any, b: any) => (a.t ?? 0) - (b.t ?? 0));
    rt.sortedStates = copy;
    rt.sortedStatesSrc = src;
    return copy;
}

function ensureIndexes(rt: UnitRt, st: any) {
    if (st?.equipment && !rt.eqIdx) rt.eqIdx = new Map(st.equipment.map((e: any, i: number) => [e.id, i]));
    if (st?.personnel && !rt.persIdx) rt.persIdx = new Map(st.personnel.map((p: any, i: number) => [p.id, i]));
    if (st?.supplies && !rt.supIdx) rt.supIdx = new Map(st.supplies.map((s: any, i: number) => [s.id, i]));
}

function applyUpdateArray<T extends { id: string }>(
    arr: T[] | undefined,
    idxMap: Map<string, number> | undefined,
    updates: Array<Partial<T> & { id: string }> | undefined,
) {
    if (!arr || !idxMap || !updates?.length) return;
    for (const u of updates) {
        const i = idxMap.get(u.id);
        if (i === undefined) continue;
        Object.assign(arr[i], u);
    }
}

function applyDiffOnHand<T extends { id: string; onHand?: number; count?: number }>(
    arr: T[] | undefined,
    idxMap: Map<string, number> | undefined,
    diffs: Array<Partial<T> & { id: string; onHand?: number }> | undefined,
) {
    if (!arr || !idxMap || !diffs?.length) return;
    for (const d of diffs) {
        const i = idxMap.get(d.id);
        if (i === undefined) continue;
        const cur = arr[i];
        const base = (cur.onHand ?? cur.count ?? 0);
        const delta = (d.onHand ?? 0);
        cur.onHand = base + delta;
    }
}

function clearInterpolation(rt: UnitRt) {
    rt.seg = undefined;
}

function maybeInterpolate(rt: UnitRt, st: any, next: any, timestamp: number) {
    if (!st?.location || !next?.location) return;
    if (next.interpolate === false) return;

    const startLoc: [number, number] | undefined = rt.anchorLoc ?? st.location;
    if (!startLoc) return;

    const startMs = next.viaStartTime ?? (rt.anchorT ?? st.t ?? Number.NEGATIVE_INFINITY);
    if (startMs > timestamp) return;

    // Rebuild segment cache only when "next" changes (cursor changes)
    if (!rt.seg || rt.seg.nextIndex !== rt.cursor) {
        const coords: [number, number][] = next.via
            ? [startLoc, ...next.via, next.location]
            : [startLoc, next.location];

        const line = lineString(coords);
        const pathLengthKm = turfLength(line);
        const timeDiffMs = next.t - startMs;

        if (!(timeDiffMs > 0) || !(pathLengthKm > 0)) {
            rt.seg = undefined;
            return;
        }

        rt.seg = {
            nextIndex: rt.cursor,
            line,
            pathLengthKm,
            startMs,
            avgSpeedKmPerMs: pathLengthKm / timeDiffMs,
        };
    }

    const seg = rt.seg;
    if (!seg) return;

    const elapsedMs = Math.max(0, timestamp - seg.startMs);
    const distKm = Math.min(seg.pathLengthKm, seg.avgSpeedKmPerMs * elapsedMs);
    const p = turfAlong(seg.line, distKm);

    st.location = p.geometry.coordinates as [number, number];
    st.type = "interpolated";
    st.t = timestamp;
}

// ──────────────────────────────────────────────────────────────────────────────
// Unit state updater (same signature; faster implementation; does NOT mutate unit.state)
// ──────────────────────────────────────────────────────────────────────────────

export function updateCurrentUnitState(unit: NUnit, timestamp: number) {
    const rt = getUnitRt(unit);
    const states = getSortedStates(unit, rt);

    // No time series: initialize once (map wants _state.location)
    if (!states || states.length === 0) {
        if (unit._state == null) unit._state = createInitialState(unit);
        rt.lastScrubTs = timestamp;
        rt.cursor = 0;
        rt.anchorT = unit._state?.t ?? Number.MIN_SAFE_INTEGER;
        rt.anchorLoc = unit._state?.location;
        clearInterpolation(rt);
        return;
    }

    // Backwards scrub or first run: rebuild deterministically
    const backward = timestamp < rt.lastScrubTs || rt.lastScrubTs === Number.NEGATIVE_INFINITY || !unit._state;
    if (backward) {
        let st = ensureNonNullState(unit, createInitialState(unit));
        rt.cursor = 0;
        rt.anchorT = st.t ?? Number.MIN_SAFE_INTEGER;
        rt.anchorLoc = st.location;
        rt.eqIdx = undefined;
        rt.persIdx = undefined;
        rt.supIdx = undefined;
        clearInterpolation(rt);

        ensureIndexes(rt, st);

        for (; rt.cursor < states.length; rt.cursor++) {
            const s: any = states[rt.cursor];
            if (s.t <= timestamp) {
                const { diff, update, ...rest } = s;

                applyUpdateArray(st.equipment as any, rt.eqIdx, update?.equipment);
                applyUpdateArray(st.personnel as any, rt.persIdx, update?.personnel);
                applyUpdateArray(st.supplies as any, rt.supIdx, update?.supplies);

                applyDiffOnHand(st.equipment as any, rt.eqIdx, diff?.equipment);
                applyDiffOnHand(st.personnel as any, rt.persIdx, diff?.personnel);
                applyDiffOnHand(st.supplies as any, rt.supIdx, diff?.supplies);

                Object.assign(st as any, rest);

                if ((st as any)?.t !== undefined) rt.anchorT = (st as any).t;
                if ((st as any)?.location) rt.anchorLoc = (st as any).location;
                clearInterpolation(rt);

                ensureIndexes(rt, st);
            } else {
                maybeInterpolate(rt, st, s, timestamp);
                break;
            }
        }

        if ((st as any)?.sidc !== (unit._state as any)?.sidc) invalidateUnitStyle(unit.id);
        unit._state = st as any;
        rt.lastScrubTs = timestamp;
        return;
    }

    // Forward scrub: apply only newly-crossed discrete states
    const st: any = ensureNonNullState(unit, unit._state as any);
    const prevSidc = st.sidc;

    ensureIndexes(rt, st);

    while (rt.cursor < states.length) {
        const s: any = states[rt.cursor];
        if (s.t <= timestamp) {
            const { diff, update, ...rest } = s;

            applyUpdateArray(st.equipment, rt.eqIdx, update?.equipment);
            applyUpdateArray(st.personnel, rt.persIdx, update?.personnel);
            applyUpdateArray(st.supplies, rt.supIdx, update?.supplies);

            applyDiffOnHand(st.equipment, rt.eqIdx, diff?.equipment);
            applyDiffOnHand(st.personnel, rt.persIdx, diff?.personnel);
            applyDiffOnHand(st.supplies, rt.supIdx, diff?.supplies);

            Object.assign(st, rest);

            if (st.t !== undefined) rt.anchorT = st.t;
            if (st.location) rt.anchorLoc = st.location;
            clearInterpolation(rt);

            rt.cursor++;
            ensureIndexes(rt, st);
            continue;
        }

        maybeInterpolate(rt, st, s, timestamp);
        break;
    }

    if (st.sidc !== prevSidc) invalidateUnitStyle(unit.id);

    unit._state = st;
    rt.lastScrubTs = timestamp;
}

// ──────────────────────────────────────────────────────────────────────────────
// Feature state (incremental; does NOT mutate feature.state)
// ──────────────────────────────────────────────────────────────────────────────

function createInitialFeatureState(feature: NScenarioFeature): CurrentScenarioFeatureState | null {
    return {
        t: Number.MIN_SAFE_INTEGER,
        geometry: feature.geometry,
    };
}

type FeatureRt = {
    lastScrubTs: number;
    cursor: number;
    sortedStates?: any[];
    sortedStatesSrc?: any[];
};

function getFeatureRt(feature: NScenarioFeature): FeatureRt {
    const f = feature as any;
    if (!f.__timeRt) {
        f.__timeRt = {
            lastScrubTs: Number.NEGATIVE_INFINITY,
            cursor: 0,
        } satisfies FeatureRt;
    }
    return f.__timeRt as FeatureRt;
}

function getSortedFeatureStates(feature: NScenarioFeature, rt: FeatureRt): any[] {
    const src = (feature as any).state ?? [];
    if (rt.sortedStates && rt.sortedStatesSrc === src) return rt.sortedStates;

    if (src.length <= 1 || isMonotonicStatesByT(src)) {
        rt.sortedStates = src;
        rt.sortedStatesSrc = src;
        return src;
    }

    const copy = src.slice().sort((a: any, b: any) => (a.t ?? 0) - (b.t ?? 0));
    rt.sortedStates = copy;
    rt.sortedStatesSrc = src;
    return copy;
}

function updateCurrentFeatureState(feature: NScenarioFeature, timestamp: number) {
    const rt = getFeatureRt(feature);
    const states = getSortedFeatureStates(feature, rt);

    if (!states || states.length === 0) {
        if (feature._state == null) feature._state = createInitialFeatureState(feature);
        return;
    }

    const backward = timestamp < rt.lastScrubTs || rt.lastScrubTs === Number.NEGATIVE_INFINITY || !feature._state;
    if (backward) {
        let st: any = createInitialFeatureState(feature);
        rt.cursor = 0;
        for (; rt.cursor < states.length; rt.cursor++) {
            const s: any = states[rt.cursor];
            if (s.t <= timestamp) Object.assign(st, s);
            else break;
        }
        feature._state = st;
        rt.lastScrubTs = timestamp;
        return;
    }

    const st: any = feature._state ?? createInitialFeatureState(feature);
    while (rt.cursor < states.length) {
        const s: any = states[rt.cursor];
        if (s.t <= timestamp) {
            Object.assign(st, s);
            rt.cursor++;
        } else {
            break;
        }
    }
    feature._state = st;
    rt.lastScrubTs = timestamp;
}

// ──────────────────────────────────────────────────────────────────────────────
// Scenario time composable (API preserved)
// ──────────────────────────────────────────────────────────────────────────────

export function useScenarioTime(store: NewScenarioStore) {
    const { state, update } = store;

    const goToScenarioEventHook = createEventHook<GoToScenarioEventEvent>();

    // Cache ID lists to avoid Object.values allocations per tick
    let cachedUnitCount = -1;
    let cachedFeatureCount = -1;
    let unitsWithSeries: EntityId[] = [];
    let unitsToInit: EntityId[] = [];

    function rebuildUnitCachesIfNeeded() {
        const unitCount = Object.keys(state.unitMap).length;
        if (unitCount === cachedUnitCount) return;
        cachedUnitCount = unitCount;

        unitsWithSeries = [];
        unitsToInit = [];

        for (const [id, u] of Object.entries(state.unitMap)) {
            const unit = u as NUnit;
            if (unit?.state?.length) unitsWithSeries.push(id);
            // Always ensure _state exists for map and locationFilter (init-once for non-series units)
            if (!unit?.state?.length && unit._state == null) unitsToInit.push(id);
        }
    }

    function rebuildFeatureCacheIfNeeded() {
        const featureCount = Object.keys(state.featureMap).length;
        if (featureCount === cachedFeatureCount) return;
        cachedFeatureCount = featureCount;
    }

    function setCurrentTime(timestamp: number) {
        rebuildUnitCachesIfNeeded();
        rebuildFeatureCacheIfNeeded();

        // Update time-series units only (big win)
        for (const id of unitsWithSeries) {
            const unit = state.unitMap[id];
            if (unit) updateCurrentUnitState(unit, timestamp);
        }

        // Initialize non-series units once (so they appear immediately)
        if (unitsToInit.length) {
            const remaining: EntityId[] = [];
            for (const id of unitsToInit) {
                const unit = state.unitMap[id];
                if (!unit) continue;
                if (unit._state == null) unit._state = createInitialState(unit);
                if (unit._state == null) remaining.push(id);
            }
            unitsToInit = remaining;
        }

        // Layers/features visibility + incremental feature state
        Object.values(state.layerMap).forEach((layer) => {
            const visibleFromT = layer.visibleFromT || Number.MIN_SAFE_INTEGER;
            const visibleUntilT = layer.visibleUntilT || Number.MAX_SAFE_INTEGER;
            layer._hidden = timestamp <= visibleFromT || timestamp >= visibleUntilT;

            layer.features.forEach((featureId) => {
                const feature = state.featureMap[featureId];
                if (!feature) return;

                const fFrom = feature.meta.visibleFromT || Number.MIN_SAFE_INTEGER;
                const fUntil = feature.meta.visibleUntilT || Number.MAX_SAFE_INTEGER;
                feature._hidden = timestamp <= fFrom || timestamp >= fUntil;

                updateCurrentFeatureState(feature, timestamp);
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

    // Keep your original semantics for "event jumps" (scenario events list)
    function goToNextScenarioEvent(options: GoToScenarioEventOptions = {}) {
        const nextEventId = state.events.find(
            (event) => state.eventMap[event].startTime > state.currentTime,
        );
        const nextEvent = nextEventId && state.eventMap[nextEventId];
        if (nextEvent) goToScenarioEvent(nextEvent, options);
    }

    function goToPrevScenarioEvent(options: GoToScenarioEventOptions = {}) {
        const prevEventId = state.events
            .slice()
            .reverse()
            .find((event) => state.eventMap[event].startTime < state.currentTime);
        const prevEvent = prevEventId && state.eventMap[prevEventId];
        if (prevEvent) goToScenarioEvent(prevEvent, options);
    }

    function goToScenarioEvent(
        eventOrEventId: EntityId | NScenarioEvent,
        options: GoToScenarioEventOptions = {},
    ) {
        const event =
            typeof eventOrEventId === "string" ? state.eventMap[eventOrEventId] : eventOrEventId;
        if (event) {
            setCurrentTime(event.startTime);
            if (!options.silent) {
                goToScenarioEventHook.trigger({ event }).then();
            }
        }
    }

    // These two are about "any state point" jumps (units + features)
    // Kept compatible with your old behavior but without mutating arrays.
    function jumpToNextEvent() {
        let newTime = Number.MAX_SAFE_INTEGER;

        Object.values(state.unitMap).forEach((unit) => {
            const rt = getUnitRt(unit);
            const states = getSortedStates(unit, rt);
            for (const s of states) {
                if (s.t > state.currentTime) {
                    newTime = Math.min(newTime, s.t);
                    break;
                }
            }
        });

        Object.values(state.featureMap).forEach((feature) => {
            const rt = getFeatureRt(feature);
            const states = getSortedFeatureStates(feature, rt);
            for (const s of states) {
                if (s.t > state.currentTime) {
                    newTime = Math.min(newTime, s.t);
                    break;
                }
            }
        });

        if (newTime < Number.MAX_SAFE_INTEGER) setCurrentTime(newTime);
    }

    function jumpToPrevEvent() {
        let newTime = Number.MIN_SAFE_INTEGER;

        Object.values(state.unitMap).forEach((unit) => {
            const rt = getUnitRt(unit);
            const states = getSortedStates(unit, rt);
            for (let i = states.length - 1; i >= 0; i--) {
                if (states[i].t < state.currentTime) {
                    newTime = Math.max(newTime, states[i].t);
                    break;
                }
            }
        });

        Object.values(state.featureMap).forEach((feature) => {
            const rt = getFeatureRt(feature);
            const states = getSortedFeatureStates(feature, rt);
            for (let i = states.length - 1; i >= 0; i--) {
                if (states[i].t < state.currentTime) {
                    newTime = Math.max(newTime, states[i].t);
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
            const rt = getUnitRt(unit);
            const states = getSortedStates(unit, rt);
            states.forEach((s: any) => {
                const t = Math.round(s.t / 3600000) * 3600000;
                histogram[t] = (histogram[t] || 0) + 1;
                max = Math.max(max, histogram[t]);
            });
        });

        Object.values(state.featureMap).forEach((feature) => {
            const rt = getFeatureRt(feature);
            const states = getSortedFeatureStates(feature, rt);
            states.forEach((s: any) => {
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

    function getEventById(id: EntityId) {
        return state.eventMap[id];
    }

    function addScenarioEvent(event: NScenarioEvent | ScenarioEvent) {
        let newEvent = klona(event) as NScenarioEvent;
        if (!newEvent._type) newEvent._type = "scenario";

        if (!newEvent.id) newEvent.id = nanoid();

        // Accumulation safety (same intent as the version I sent earlier)
        if ((state as any).eventMap?.[newEvent.id]) {
            const oldId = newEvent.id;
            newEvent.id = nanoid();
            (newEvent as any).sourceEventId = oldId;
            console.warn("[events] ID collision; accumulating as new event", {
                incomingId: oldId,
                mintedId: newEvent.id,
            });
        }

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

    const utcTime = computed(() => dayjs.utc(state.currentTime));
    const scenarioTime = computed(() => dayjs(state.currentTime).tz(state.info.timeZone || "UTC"));
    const timeZone = computed(() => state.info.timeZone);

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

// ──────────────────────────────────────────────────────────────────────────────
// Helper: get a unit position at an arbitrary time (export preserved)
// ──────────────────────────────────────────────────────────────────────────────

export type LonLatAlt = { lon: number; lat: number; alt?: number };

function isLonLat(v: any): v is [number, number] {
    return Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number";
}

function upperBoundState(states: any[], tMs: number): number {
    let lo = 0;
    let hi = states.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if ((states[mid]?.t ?? 0) <= tMs) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/**
 * Return the best-known lon/lat for a unit at time tMs.
 * Never mutates the unit.
 */
export function getUnitPositionAtTime(
    unit: { state?: any[]; location?: [number, number]; _state?: any },
    tMs: number,
): LonLatAlt | undefined {
    const raw = unit?.state ?? [];
    if (!raw.length) {
        const fallback = unit._state?.location ?? unit.location;
        if (isLonLat(fallback)) return { lon: fallback[0], lat: fallback[1] };
        return undefined;
    }

    // Cache a sorted copy if needed; never mutate raw.
    let states = raw as any[];
    const u = unit as any;
    if (!(u.__posSorted && u.__posSortedSrc === raw)) {
        if (states.length > 1 && !isMonotonicStatesByT(states)) {
            u.__posSorted = raw.slice().sort((a: any, b: any) => a.t - b.t);
            u.__posSortedSrc = raw;
        } else {
            u.__posSorted = raw;
            u.__posSortedSrc = raw;
        }
    }
    states = u.__posSorted;

    const ub = upperBoundState(states, tMs);
    const prevIdx = ub - 1;

    // Find prev location by scanning backward to a state with a location.
    let prevLoc: [number, number] | undefined;
    let prevT: number | undefined;

    for (let i = prevIdx; i >= 0; i--) {
        const s = states[i];
        if (isLonLat(s.location)) {
            prevLoc = s.location;
            prevT = s.t;
            break;
        }
    }

    if (!prevLoc) {
        const fallback = unit._state?.location ?? unit.location;
        if (isLonLat(fallback)) {
            prevLoc = fallback;
            prevT = states[Math.max(0, prevIdx)]?.t ?? Number.NEGATIVE_INFINITY;
        }
    }

    // Find next state WITH a location.
    let next: any | undefined;
    for (let i = ub; i < states.length; i++) {
        const s = states[i];
        if (isLonLat(s.location)) {
            next = s;
            break;
        }
    }

    if (
        prevLoc &&
        next &&
        !(next.interpolate === false) &&
        (next.viaStartTime ?? prevT ?? Number.NEGATIVE_INFINITY) <= tMs
    ) {
        const coords: [number, number][] = next.via
            ? [prevLoc, ...next.via, next.location]
            : [prevLoc, next.location];

        const line = lineString(coords);
        const pathLengthKm = turfLength(line);
        const startMs = next.viaStartTime ?? prevT ?? tMs;
        const timeDiffMs = next.t - startMs;

        if (timeDiffMs > 0 && pathLengthKm > 0) {
            const avgSpeedKmPerMs = pathLengthKm / timeDiffMs;
            const elapsedMs = Math.max(0, tMs - startMs);
            const distKm = Math.min(pathLengthKm, avgSpeedKmPerMs * elapsedMs);
            const pt = turfAlong(line, distKm);
            const [lon, lat] = pt.geometry.coordinates as [number, number];
            return { lon, lat };
        }
    }

    if (prevLoc) return { lon: prevLoc[0], lat: prevLoc[1] };
    return undefined;
}
