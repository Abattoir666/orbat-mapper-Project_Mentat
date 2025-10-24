// src/globe/globeFeatureBridge.ts
import { watch, onUnmounted } from "vue";
import type { Ref } from "vue";
import type { Unit } from "@/types/scenarioModels";
import { inject as vueInject } from "vue";
import { activeScenarioKey } from "@/components/injects";

/**
 * Minimal shape your Globe adapter needs (matches what you showed in logs).
 * If you already have these, this type is just for TS help.
 */
export interface GlobeAdapter {
    mount: (el: HTMLElement) => void;
    unmount: () => void;
    upsertUnit: (u: Unit) => void;
    removeUnit: (id: string) => void;
    upsertUnitsBulk?: (units: Unit[]) => void; // optional; we’ll use if present
    flyToLatLon?: (lat: number, lon: number, height?: number) => void;
}

type UnitMap = Record<string, Unit | undefined>;

/**
 * Creates a one-way “bridge” from the scenario store -> Globe overlay.
 * Mirrors the 2D map-listener pattern but with lightweight batching for Cesium.
 */
export function createGlobeFeatureBridge(globeRef: Ref<GlobeAdapter | null>) {
    // Pull the same scenario the 2D view uses:
    const scenario = vueInject(activeScenarioKey, null);

    // Keep previous snapshot to compute diffs efficiently:
    let prevUnitMap: UnitMap = {};
    let stopHandle: (() => void) | null = null;

    // A microtask-batched queue so bursty edits don’t spam Cesium
    let pending: { upserts: Unit[]; removals: string[] } | null = null;
    const flush = () => {
        if (!pending) return;
        const globe = globeRef.value;
        if (!globe) { pending = null; return; }

        const { upserts, removals } = pending;

        if (upserts.length && globe.upsertUnitsBulk) {
            globe.upsertUnitsBulk(upserts);
        } else {
            for (const u of upserts) globe.upsertUnit(u);
        }
        for (const id of removals) globe.removeUnit(id);

        pending = null;
    };

    const enqueue = (upserts: Unit[], removals: string[]) => {
        if (!pending) {
            pending = { upserts: [], removals: [] };
            queueMicrotask(flush);
        }
        pending.upserts.push(...upserts);
        pending.removals.push(...removals);
    };

    // Compute shallow diffs between previous and next maps
    const diffUnits = (prev: UnitMap, next: UnitMap) => {
        const upserts: Unit[] = [];
        const removals: string[] = [];

        // Added/changed
        for (const [id, u] of Object.entries(next)) {
            if (!u) continue;
            const p = prev[id];
            if (!p) {
                upserts.push(u);
            } else if (
                p.lat !== u.lat ||
                p.lon !== u.lon ||
                p.sidc !== u.sidc ||
                p.name !== u.name ||
                p.parent_id !== u.parent_id ||
                p.side !== u.side ||
                p.group !== u.group
            ) {
                upserts.push(u);
            }
        }
        // Removed
        for (const id of Object.keys(prev)) {
            if (!(id in next)) removals.push(id);
        }
        return { upserts, removals };
    };

    /**
     * Start watching the same source of truth the 2D map watches.
     * If your project exposes a different accessor, swap in that getter below.
     */
    const start = () => {
        // Many projects keep units in something like scenario.value?.unitMap
        stopHandle = watch(
            () => scenario?.value?.unitMap as UnitMap | undefined,
            (unitMap) => {
                if (!unitMap) return;
                const next = unitMap;
                const { upserts, removals } = diffUnits(prevUnitMap, next);
                if (upserts.length || removals.length) enqueue(upserts, removals);
                prevUnitMap = next;
            },
            { deep: false, immediate: true }
        );
    };

    const stop = () => {
        if (stopHandle) {
            stopHandle();
            stopHandle = null;
        }
        // When tearing down the view, clear the overlay to avoid “ghosts”
        const globe = globeRef.value;
        if (globe) {
            // remove anything still on scene
            const ids = Object.keys(prevUnitMap);
            for (const id of ids) globe.removeUnit(id);
        }
        prevUnitMap = {};
        pending = null;
    };

    onUnmounted(stop);
    start();

    return { stop };
}
