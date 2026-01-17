import type { NewScenarioStore } from "@/scenariostore/newScenarioStore";
import { computed } from "vue";
import type { CurrentState } from "@/types/scenarioModels";
import type {
    CurrentScenarioFeatureState,
    FeatureId,
    LayerFeatureItem,
    Position,
    ScenarioLayer,
    ScenarioMapLayer,
} from "@/types/scenarioGeoModels";
import type { EntityId } from "@/types/base";
import type {
    NScenarioFeature,
    NScenarioLayer,
    ScenarioFeatureUpdate,
    ScenarioLayerUpdate,
    ScenarioMapLayerUpdate,
} from "@/types/internalModels";
import { klona } from "klona";
import { moveItemMutable, nanoid, removeElement } from "@/utils";
import { createEventHook } from "@vueuse/core";
import type { DropTarget } from "@/components/types";
import type { Geometry } from "geojson";

export type ScenarioMapLayerEvent =
    | {
        type: "add" | "remove" | "update";
        id: FeatureId;
        data: ScenarioMapLayer | ScenarioMapLayerUpdate;
    }
    | { type: "move"; id: FeatureId; index: number };

export type ScenarioFeatureLayerEvent =
    | {
        type: "addLayer";
        id: FeatureId;
        data: NScenarioLayer;
    }
    | { type: "removeLayer" | "moveLayer"; id: FeatureId }
    | { type: "updateLayer"; id: FeatureId; data: ScenarioLayerUpdate }
    | { type: "deleteFeature"; id: FeatureId }
    | { type: "updateFeature"; id: FeatureId; data: ScenarioFeatureUpdate }
    | { type: "addFeature"; id: FeatureId; data: NScenarioFeature }
    | { type: "moveFeature"; id: FeatureId; fromLayer?: FeatureId; toLayer?: FeatureId };

export type UpdateOptions = {
    undoable?: boolean;
    noEmit?: boolean;
    force?: boolean;
    emitOnly?: boolean;
};

export type UnitPositionChangeEvent = {
    unitId: EntityId;
    t: number;
    location: Position | null;
};

export interface MoveLayerOptions {
    toIndex?: number;
    direction?: "up" | "down";
}

function createInitialFeatureState(
    feature: NScenarioFeature,
): CurrentScenarioFeatureState | null {
    return {
        t: Number.MIN_SAFE_INTEGER,
        geometry: feature.geometry,
    };
}

export function useGeo(store: NewScenarioStore) {
    const { state, update } = store;
    const mapLayerEvent = createEventHook<ScenarioMapLayerEvent>();
    const featureLayerEvent = createEventHook<ScenarioFeatureLayerEvent>();

    // Multiplayer support: emit local unit-position changes (and allow remote apply without echo).
    const unitPositionEvent = createEventHook<UnitPositionChangeEvent>();
    let suppressUnitPositionEvent = 0;

    function positionsEqual(a: Position | null | undefined, b: Position | null | undefined) {
        if (!a && !b) return true;
        if (!a || !b) return false;
        if (a[0] !== b[0] || a[1] !== b[1]) return false;
        const az = (a as any)[2];
        const bz = (b as any)[2];
        if (typeof az === "number" || typeof bz === "number") return az === bz;
        return true;
    }

    const hiddenGroups = computed(() => {
        return new Set(
            Object.values(state.sideGroupMap)
                .filter((group) => !!(group.isHidden || state.sideMap[group._pid]?.isHidden))
                .map((group) => group.id),
        );
    });
    const everyVisibleUnit = computed(() => {
        return Object.values(state.unitMap).filter(
            (unit) => !hiddenGroups.value.has(unit._gid) && unit._state?.location,
        );
    });

    function mergeAltitude(
        prev: Position | null | undefined,
        next: Position | null,
    ): Position | null {
        if (!next) return null;

        const nextZ = typeof (next as any)[2] === "number" ? (next as any)[2] : undefined;
        if (nextZ != null) return next;

        const prevZ = prev && typeof (prev as any)[2] === "number" ? (prev as any)[2] : undefined;
        if (prevZ != null) return [next[0], next[1], prevZ];

        return [next[0], next[1]];
    }

    function addUnitPosition(
        unitId: EntityId,
        coordinates: Position | null,
        atTime?: number,
    ) {
        let newState: CurrentState | null = null;
        let didChange = false;

        update(
            (s) => {
                const u = s.unitMap[unitId];
                const t = atTime ?? s.currentTime;

                const existingAtT =
                    u.state?.find((e) => e.t === t)?.location ?? u._state?.location ?? u.location;

                const merged = mergeAltitude(existingAtT, coordinates);
                // No-op if location did not actually change (including altitude).
                if (positionsEqual(existingAtT, merged)) return;

                newState = { t, location: merged };
                didChange = true;

                if (t === s.currentTime) u._state = newState;
                if (!u.state) u.state = [];
                for (let i = 0, len = u.state.length; i < len; i++) {
                    if (t < u.state[i].t) {
                        u.state.splice(i, 0, { id: nanoid(), ...newState });
                        return;
                    } else if (t === u.state[i].t) {
                        u.state[i] = { ...u.state[i], ...newState };
                        return;
                    }
                }
                u.state.push({ id: nanoid(), ...newState });
            },
            { label: "addUnitPosition", value: unitId },
        );

        if (!didChange || !newState) return;

        store.state.unitStateCounter++;

        if (suppressUnitPositionEvent === 0) {
            unitPositionEvent
                .trigger({ unitId, t: newState.t, location: newState.location })
                .then();
        }
    }

    function applyRemoteUnitPosition(
        unitId: EntityId,
        coordinates: Position | null,
        atTime?: number,
    ) {
        suppressUnitPositionEvent++;
        try {
            addUnitPosition(unitId, coordinates, atTime);
        } finally {
            suppressUnitPositionEvent--;
        }
    }

    function addFeatureStateGeometry(
        featureId: FeatureId,
        geometry: Geometry,
        atTime?: number,
    ) {
        let newState: CurrentScenarioFeatureState | null = null;
        update(
            (s) => {
                const u = s.featureMap[featureId];
                const t = atTime ?? s.currentTime;
                newState = { t, geometry };
                if (t === s.currentTime) u._state = newState;
                if (!u.state) u.state = [];
                for (let i = 0, len = u.state.length; i < len; i++) {
                    if (t < u.state[i].t) {
                        u.state.splice(i, 0, { id: nanoid(), ...newState });
                        return;
                    } else if (t === u.state[i].t) {
                        u.state[i] = { ...u.state[i], ...newState };
                        return;
                    }
                }
                u.state.push({ id: nanoid(), ...newState });
            },
            { label: "updateFeatureState", value: featureId },
        );

        updateFeatureState(featureId);
    }

    function addLayer(data: NScenarioLayer) {
        const newLayer = klona({ ...data, _isNew: true });
        if (!newLayer.id) newLayer.id = nanoid();
        newLayer._isNew = true;
        newLayer._isOpen = true;
        update(
            (s) => {
                s.layers.push(newLayer.id);
                s.layerMap[newLayer.id] = newLayer;
            },
            { label: "addLayer", value: newLayer.id },
        );
        featureLayerEvent
            .trigger({ type: "addLayer", id: newLayer.id, data: newLayer })
            .then();

        return state.layerMap[newLayer.id];
    }

    function addMapLayer(data: ScenarioMapLayer) {
        const newLayer = klona({
            opacity: 0.7,
            ...data,
            _isNew: true,
            _isTemporary: data.url.startsWith("blob:"),
        });
        if (!newLayer.id) newLayer.id = nanoid();
        update(
            (s) => {
                s.mapLayers.push(newLayer.id);
                s.mapLayerMap[newLayer.id] = newLayer;
            },
            { label: "addMapLayer", value: newLayer.id },
        );
        mapLayerEvent.trigger({ type: "add", id: newLayer.id, data: newLayer }).then();
        return state.mapLayerMap[newLayer.id];
    }

    function moveLayer(layerId: FeatureId, toIndex: number) {
        const fromIndex = state.layers.indexOf(layerId);
        update(
            (s) => {
                moveItemMutable(s.layers, fromIndex, toIndex);
            },
            { label: "moveLayer", value: layerId },
        );
        featureLayerEvent.trigger({ type: "moveLayer", id: layerId }).then();
    }

    function moveMapLayer(layerId: FeatureId, options: MoveLayerOptions) {
        const fromIndex = state.mapLayers.indexOf(layerId);
        const toIndex =
            options.toIndex ?? (options.direction === "up" ? fromIndex - 1 : fromIndex + 1);
        update(
            (s) => {
                moveItemMutable(s.mapLayers, fromIndex, toIndex);
            },
            { label: "moveMapLayer", value: layerId },
        );
        mapLayerEvent.trigger({ type: "move", id: layerId, index: toIndex }).then();
    }

    function moveFeature(featureId: FeatureId, toIndex: number) {
        const feature = state.featureMap[featureId];

        update(
            (s) => {
                const layer = s.layerMap[feature._pid];
                const fromIndex = layer.features.indexOf(featureId);
                moveItemMutable(layer.features, fromIndex, toIndex);
                layer.features.forEach((fid, i) => {
                    const feature = s.featureMap[fid];
                    if (feature.meta._zIndex !== i) feature.meta._zIndex = i;
                });
            },
            { label: "moveFeature", value: featureId },
        );
        featureLayerEvent.trigger({ type: "moveFeature", id: featureId }).then();
    }

    function reorderFeature(
        featureId: FeatureId,
        destinationFeatureOrLayerId: FeatureId,
        target: DropTarget,
    ) {
        const feature = state.featureMap[featureId];
        const destinationFeature = state.featureMap[destinationFeatureOrLayerId];
        const destinationLayerId = destinationFeature?._pid ?? destinationFeatureOrLayerId;
        if (!feature) return;
        const layer = state.layerMap[feature._pid];
        const destinationLayer = state.layerMap[destinationLayerId];
        if (!layer || !destinationLayer) return;

        const toIndex = destinationLayer.features.indexOf(destinationFeatureOrLayerId);
        if (layer.id === destinationLayer.id) {
            const fromIndex = layer.features.indexOf(featureId);
            let newIndex = toIndex;
            if (target === "above") newIndex = toIndex;
            else if (target === "below") newIndex = toIndex + 1;
            if (fromIndex < toIndex) newIndex--;
            moveFeature(featureId, newIndex);
        } else {
            update(
                (s) => {
                    const fromLayer = s.layerMap[feature._pid];
                    const toLayer = s.layerMap[destinationLayerId];
                    const f = s.featureMap[featureId];

                    removeElement(featureId, fromLayer.features);
                    let newIndex = toIndex;
                    if (target === "above") newIndex = toIndex;
                    else if (target === "below") newIndex = toIndex + 1;
                    if (toIndex >= 0) {
                        toLayer.features.splice(newIndex, 0, featureId);
                    } else {
                        toLayer.features.push(featureId);
                    }
                    f._pid = toLayer.id;
                },
                { label: "moveFeature", value: featureId },
            );
            featureLayerEvent
                .trigger({
                    type: "moveFeature",
                    id: featureId,
                    fromLayer: layer.id,
                    toLayer: destinationLayerId,
                })
                .then();
        }
    }

    function getFullLayer(layerId: FeatureId): ScenarioLayer | undefined {
        const layer = state.layerMap[layerId];
        if (!layer) return;
        return { ...layer, features: layer.features.map((f) => klona(state.featureMap[f])) };
    }

    const layers = computed(() => {
        return state.layers
            .map((layerId) => state.layerMap[layerId])
            .map((layer) => ({
                ...layer,
                features: layer.features.map((featureId) => state.featureMap[featureId]),
            }));
    });

    const mapLayers = computed(() => {
        return state.mapLayers.map((layerId) => state.mapLayerMap[layerId]);
    });

    const layersFeatures = computed(() => {
        return state.layers
            .map((layerId) => state.layerMap[layerId])
            .map((layer) => ({
                layer,
                features: layer.features.map((featureId) => state.featureMap[featureId]),
            }));
    });

    function updateLayer(
        layerId: FeatureId,
        data: ScenarioLayerUpdate,
        options: UpdateOptions = {},
    ) {
        const undoable = options.undoable ?? true;
        const noEmit = options.noEmit ?? false;

        if (undoable) {
            update(
                (s) => {
                    const layer = s.layerMap[layerId];
                    Object.assign(layer, data);
                },
                { label: "updateLayer", value: layerId },
            );
        } else {
            const layer = state.layerMap[layerId];
            Object.assign(layer, data);
        }
        if (noEmit) return;
        featureLayerEvent.trigger({ type: "updateLayer", id: layerId, data }).then();
    }

    function updateMapLayer(
        layerId: FeatureId,
        data: ScenarioMapLayerUpdate,
        options: UpdateOptions = {},
    ) {
        const undoable = options.undoable ?? true;
        const noEmit = options.noEmit ?? false;
        const emitOnly = options.emitOnly ?? false;
        if (undoable) {
            update(
                (s) => {
                    const layer = s.mapLayerMap[layerId];
                    Object.assign(layer, data);
                },
                { label: "updateMapLayer", value: layerId },
            );
        } else if (!emitOnly) {
            const layer = state.mapLayerMap[layerId];
            Object.assign(layer, data);
        }
        if (noEmit) return;
        mapLayerEvent.trigger({ type: "update", id: layerId, data });
    }

    function deleteLayer(layerId: FeatureId, options: UpdateOptions = {}) {
        const noEmit = options.noEmit ?? false;
        update(
            (s) => {
                const layer = s.layerMap[layerId];
                if (!layer) return;
                layer.features.forEach((featureId) => delete s.featureMap[featureId]);
                delete s.layerMap[layerId];
                removeElement(layerId, s.layers);
            },
            { label: "deleteLayer", value: layerId },
        );
        if (noEmit) return;
        featureLayerEvent.trigger({ type: "removeLayer", id: layerId });
    }

    function deleteMapLayer(layerId: FeatureId, options: UpdateOptions = {}) {
        const noEmit = options.noEmit ?? false;
        update(
            (s) => {
                const layer = s.mapLayerMap[layerId];
                if (!layer) return;
                delete s.mapLayerMap[layerId];
                removeElement(layerId, s.mapLayers);
            },
            { label: "deleteMapLayer", value: layerId },
        );
        if (noEmit) return;
        mapLayerEvent.trigger({ type: "remove", id: layerId, data: {} });
    }

    function addFeature(
        data: Omit<NScenarioFeature, "_pid">,
        layerId: FeatureId,
        options: UpdateOptions = {},
    ) {
        const noEmit = options.noEmit ?? false;
        const newFeature = klona(data) as NScenarioFeature;
        if (!newFeature.id) newFeature.id = nanoid();
        newFeature._pid = layerId;
        update(
            (s) => {
                const layer = s.layerMap[layerId];
                if (!layer) return;
                s.featureMap[newFeature.id!] = newFeature;
                layer.features.push(newFeature.id!);
            },
            { label: "addFeature", value: newFeature.id },
        );

        if (noEmit) return;
        featureLayerEvent.trigger({ type: "addFeature", id: newFeature.id!, data: newFeature }).then();
    }

    function deleteFeature(featureId: FeatureId, options: UpdateOptions = {}) {
        const noEmit = options.noEmit ?? false;
        update(
            (s) => {
                const feature = s.featureMap[featureId];
                if (!feature) return;
                const layer = s.layerMap[feature._pid];
                if (layer) removeElement(featureId, layer.features);
                delete s.featureMap[featureId];
            },
            { label: "deleteFeature", value: featureId },
        );
        if (noEmit) return;
        featureLayerEvent.trigger({ type: "deleteFeature", id: featureId }).then();
    }

    function updateFeature(
        featureId: FeatureId,
        data: ScenarioFeatureUpdate,
        options: UpdateOptions = {},
    ) {
        const undoable = options.undoable ?? true;
        const noEmit = options.noEmit ?? false;
        const emitOnly = options.emitOnly ?? false;

        if (undoable) {
            update(
                (s) => {
                    const feature = s.featureMap[featureId];
                    Object.assign(feature, data);
                },
                { label: "updateFeature", value: featureId },
            );
        } else if (!emitOnly) {
            const feature = state.featureMap[featureId];
            Object.assign(feature, data);
        }
        if (noEmit) return;
        featureLayerEvent.trigger({ type: "updateFeature", id: featureId, data }).then();
    }

    function duplicateFeature(featureId: FeatureId, layerId: FeatureId) {
        const feature = state.featureMap[featureId];
        if (!feature) return;
        const newFeature = klona(feature) as NScenarioFeature;
        newFeature.id = nanoid();
        newFeature.meta._zIndex = state.layerMap[layerId]?.features.length ?? 0;
        addFeature(newFeature, layerId);
    }

    function deleteFeatureStateEntry(featureId: FeatureId, stateId: string) {
        update(
            (s) => {
                const u = s.featureMap[featureId];
                if (!u?.state) return;
                u.state = u.state.filter((e) => e.id !== stateId);
            },
            { label: "deleteFeatureStateEntry", value: featureId },
        );
        updateFeatureState(featureId);
    }

    function updateFeatureState(featureId: FeatureId) {
        const feature = store.state.featureMap[featureId];
        if (!feature) return;
        if (!feature.state?.length) {
            feature._state = createInitialFeatureState(feature);
            store.state.featureStateCounter++;
            return;
        }

        const t = store.state.currentTime;
        let currentState: CurrentScenarioFeatureState | null = null;

        for (let i = 0; i < feature.state.length; i++) {
            if (feature.state[i].t <= t) {
                currentState = feature.state[i];
            } else {
                break;
            }
        }
        feature._state = currentState;
        store.state.featureStateCounter++;
    }

    const itemsInfo = computed<LayerFeatureItem[]>(() => {
        let items: LayerFeatureItem[] = [];
        layers.value.forEach((layer) => {
            items.push({ id: layer.id, type: "layer", name: layer.name });
            const mappedFeatures: LayerFeatureItem[] = layer.features.map((feature) => {
                const { meta, id } = feature;
                return {
                    id,
                    type: meta.type,
                    name: meta.name || "",
                    description: meta.description,
                    _pid: layer.id,
                };
            });
            items.push(...mappedFeatures);
        });
        return items;
    });

    return {
        everyVisibleUnit,
        addUnitPosition,
        applyRemoteUnitPosition,
        addLayer,
        getLayerById: (id: FeatureId) => state.layerMap[id],
        getFullLayer,
        getFeatureById: (id: FeatureId) => {
            const feature = state.featureMap[id];
            if (!feature) return { feature, layer: undefined };
            return { feature, layer: state.layerMap[feature._pid] };
        },
        moveFeature,
        updateLayer,
        deleteLayer,
        getLayerIndex: (id: FeatureId) => state.layers.indexOf(id),
        moveLayer,
        addFeature,
        duplicateFeature,
        deleteFeature,
        updateFeature,
        deleteFeatureStateEntry,
        itemsInfo,
        layers,
        layersFeatures,
        mapLayers,
        addMapLayer,
        deleteMapLayer,
        updateMapLayer,
        getMapLayerById: (id: FeatureId) => state.mapLayerMap[id],
        getMapLayerIndex: (id: FeatureId) => state.mapLayers.indexOf(id),
        onMapLayerEvent: mapLayerEvent.on,
        onFeatureLayerEvent: featureLayerEvent.on,
        onUnitPositionEvent: unitPositionEvent.on,
        moveMapLayer,
        reorderFeature,
        addFeatureStateGeometry,
    };
}
