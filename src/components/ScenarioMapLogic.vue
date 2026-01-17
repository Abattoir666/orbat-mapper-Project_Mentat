<script setup lang="ts">
    import OLMap from "ol/Map";
    import { computed, onUnmounted, shallowRef, watch } from "vue";
    import Select from "ol/interaction/Select";
    import { injectStrict } from "@/utils";
    import { activeScenarioKey } from "@/components/injects";
    import { useUiStore } from "@/stores/uiStore";
    import {
        useGeoStore,
        useMeasurementsStore,
        useUnitSettingsStore,
    } from "@/stores/geoStore";
    import { useSettingsStore, useSymbolSettingsStore } from "@/stores/settingsStore";
    import { storeToRefs } from "pinia";
    import {
        calculateZoomToResolution,
        useMapDrop,
        useMoveInteraction,
        useUnitLayer,
        useUnitSelectInteraction,
    } from "@/symbology/underbars/geoUnitLayers_toeUnderbar";
    import LayerGroup from "ol/layer/Group";
    import { useScenarioMapLayers } from "@/modules/scenarioeditor/scenarioMapLayers";
    import { useScenarioFeatureSelect } from "@/modules/scenarioeditor/featureLayerUtils";
    import { useMapSelectStore } from "@/stores/mapSelectStore";
    import { useMapHover } from "@/composables/geoHover";
    import { saveMapAsPng, useOlEvent } from "@/composables/openlayersHelpers";
    import { useMapSettingsStore } from "@/stores/mapSettingsStore";
    import { useShowLocationControl } from "@/composables/geoShowLocation";
    import { useShowScaleLine } from "@/composables/geoScaleLine";
    import { ObjectEvent } from "ol/Object";
    import { clearUnitStyleCache } from "@/geo/unitStyles";
    import { useRangeRingsLayer } from "@/composables/geoRangeRings";
    import { useUnitHistory } from "@/composables/geoUnitHistory";
    import { useDayNightLayer } from "@/composables/geoDayNight";
    import { useScenarioEvents } from "@/modules/scenarioeditor/scenarioEvents";
    import { useSearchActions } from "@/composables/searchActions";
    import { useScenarioFeatureLayers } from "@/modules/scenarioeditor/scenarioFeatureLayers";
    import { useSelectedItems } from "@/stores/selectedStore";
    import { useThrottleFn } from "@vueuse/core";
    import { ScenarioCollab } from "@/net/scenarioCollab";
    import { useCollabPresenceStore } from "@/stores/collabPresenceStore";

    const props = defineProps<{ olMap: OLMap }>();
    const emit = defineEmits<{
        (
            e: "map-ready",
            value: {
                olMap: OLMap;
                featureSelectInteraction: Select;
                unitSelectInteraction: Select;
            },
        ): void;
    }>();

    const {
        geo,
        store: { state },
    } = injectStrict(activeScenarioKey);

    const mapRef = shallowRef<OLMap>();

    const uiStore = useUiStore();
    const doNotFilterLayers = computed(() => uiStore.layersPanelActive);
    const unitSettingsStore = useUnitSettingsStore();
    const geoStore = useGeoStore();
    const settingsStore = useSettingsStore();
    const symbolSettings = useSymbolSettingsStore();
    const { moveUnitEnabled } = storeToRefs(useUnitSettingsStore());
    const { measurementUnit } = storeToRefs(useMeasurementsStore());

    // NOTE: geoUnitLayers.ts patch will add updateUnitPositions(). Until then we fall back safely.
    const unitLayerApi = useUnitLayer();
    const { unitLayer, drawUnits } = unitLayerApi as any;
    const updateUnitPositions: undefined | (() => void) = (unitLayerApi as any).updateUnitPositions;

    const { onScenarioAction } = useSearchActions();

    const { isDragging, formattedPosition } = useMapDrop(mapRef, unitLayer);

    const olMap = props.olMap;
    mapRef.value = olMap;
    geoStore.olMap = olMap;

    calculateZoomToResolution(olMap.getView());

    const unitLayerGroup = new LayerGroup({
        layers: [unitLayer],
    });

    unitLayerGroup.set("title", "Units");

    const { showHistory, editHistory, showWaypointTimestamps } =
        storeToRefs(unitSettingsStore);
    const { unitSelectEnabled, featureSelectEnabled, hoverEnabled } =
        storeToRefs(useMapSelectStore());

    const dayNightLayer = useDayNightLayer();
    olMap.addLayer(dayNightLayer);

    const { initializeFromStore: loadMapLayers } = useScenarioMapLayers(olMap);
    const { initializeFeatureLayersFromStore } = useScenarioFeatureLayers(olMap);
    const { rangeLayer, drawRangeRings } = useRangeRingsLayer();
    // Disable temporarily
    const { } = useScenarioEvents(olMap);

    olMap.addLayer(rangeLayer);

    const {
        historyLayer,
        drawHistory,
        historyModify,
        waypointSelect,
        ctrlClickInteraction,
    } = useUnitHistory(olMap, {
        showHistory,
        editHistory,
        showWaypointTimestamps,
    });

    useMapHover(olMap, { enable: hoverEnabled });

    olMap.addLayer(historyLayer);
    olMap.addLayer(unitLayerGroup);

    const {
        unitSelectInteraction,
        boxSelectInteraction,
        redraw: redrawSelectedUnits,
    } = useUnitSelectInteraction([unitLayer], olMap, {
        enable: unitSelectEnabled,
    });

    const { selectedFeatureIds } = useSelectedItems();

    // Order of select interactions is important. The interaction that is added last
    // will be the one that receives the select event first and can stop the propagation.
    olMap.addInteraction(unitSelectInteraction);
    olMap.addInteraction(boxSelectInteraction);
    olMap.addInteraction(waypointSelect);

    olMap.addInteraction(historyModify);
    olMap.addInteraction(ctrlClickInteraction);

    const { selectInteraction: featureSelectInteraction } = useScenarioFeatureSelect(olMap, {
        enable: featureSelectEnabled,
    });

    const { moveInteraction: moveUnitInteraction } = useMoveInteraction(
        olMap,
        unitLayer,
        moveUnitEnabled,
    );

    useOlEvent(unitLayerGroup.on("change:visible", toggleMoveUnitInteraction));
    olMap.addInteraction(moveUnitInteraction);

    const { showLocation, coordinateFormat, showScaleLine } =
        storeToRefs(useMapSettingsStore());

    useShowLocationControl(olMap, {
        coordinateFormat,
        enable: showLocation,
    });

    useShowScaleLine(olMap, {
        enabled: showScaleLine,
        measurementUnits: measurementUnit,
    });

    // Initial draw
    drawRangeRings();
    drawUnits();
    drawHistory();

    loadMapLayers();
    initializeFeatureLayersFromStore();
    //loadScenarioLayers();

    const extent = unitLayer.getSource()?.getExtent();
    if (extent && !unitLayer.getSource()?.isEmpty())
        olMap.getView().fit(extent, { padding: [100, 100, 150, 100], maxZoom: 16 });

    function toggleMoveUnitInteraction(event: ObjectEvent) {
        const isUnitLayerVisible = !event.oldValue;
        moveUnitInteraction.setActive(isUnitLayerVisible && moveUnitEnabled.value);
    }

    emit("map-ready", { olMap, featureSelectInteraction, unitSelectInteraction });

    function redrawUnits() {
        // Full sync redraw (use when visibility membership changes)
        drawUnits();
        drawHistory();
        redrawSelectedUnits();
        drawRangeRings();
    }

    /**
     * IMPORTANT:
     * geo.everyVisibleUnit is expensive to deep-watch because unit._state changes during scrubbing,
     * which retriggers full redraw loops. We watch only membership (IDs) instead.
     */
    const visibleUnitKey = computed(() => {
        const list = geo.everyVisibleUnit.value;
        if (!Array.isArray(list) || list.length === 0) return "";
        // This is intentionally ID-only, so time/location mutations do not retrigger.
        return list.map((u: any) => u?.id).filter(Boolean).join("|");
    });

    watch(visibleUnitKey, () => redrawUnits());

    /**
     * Time-change fast path:
     * - update unit feature geometry each tick (cheap if updateUnitPositions exists)
     * - update time-dependent overlays at a controlled rate
     */
    const updateTimeDependentOverlays = useThrottleFn(() => {
        drawHistory();
        redrawSelectedUnits();
        drawRangeRings();
    }, 50);

    // --- Multiplayer (SignalR) wiring ---
    // Enable by setting VITE_COLLAB_SERVER_URL, e.g. http://192.168.1.164:7077
    const collabServerUrl = (import.meta.env.VITE_COLLAB_SERVER_URL || "").trim();
    let collab: ScenarioCollab | null = null;
    let stopUnitPosHook: null | (() => void) = null;

    async function initCollab() {
        if (!collabServerUrl) return;

        // state.id is your stable scenario room id
        collab = new ScenarioCollab({
            serverBaseUrl: collabServerUrl,
            scenarioId: state.id,
            forceWebSockets: true,
        });

        collab.onMoveUnitApplied((m) => {
            // Ignore our own echo
            if (!collab) return;
            if (m.clientId === collab.clientId) return;
            if (collab.isRecentLocalOp(m.opId)) return;

            geo.applyRemoteUnitPosition(m.unitId, m.location, m.t);

            // If the move is in the currently viewed time-slice, update unit geometry immediately
            if (m.t === state.currentTime) {
                if (typeof updateUnitPositions === "function") updateUnitPositions();
                else drawUnits();
            }

            updateTimeDependentOverlays();
        });

        try {
            await collab.startAndJoin();
        } catch (err) {
            console.error("[collab] failed to connect", err);
            collab = null;
            return;
        }

        collab.onPresenceSnapshot((snap) => presenceStore.applySnapshot(snap));
        collab.onPresenceChanged((chg) => presenceStore.applyChanged(chg));

        // announce ourselves
        await collab.setPresence(getDisplayName(), getColor(), navigator.userAgent);


        // Any local position change that flows through geo.addUnitPosition will be broadcast.
        stopUnitPosHook = geo.onUnitPositionEvent(({ unitId, t, location }) => {
            collab?.sendMoveUnit(unitId, t, location).catch((e) =>
                console.error("[collab] sendMoveUnit failed", e),
            );
        });
    }

    const presenceStore = useCollabPresenceStore();

    function getDisplayName(): string {
        const key = "mentat_display_name";
        const existing = window.localStorage.getItem(key);
        if (existing) return existing;
        const fallback = `Operator ${collab?.clientId.slice(-4) ?? ""}`;
        window.localStorage.setItem(key, fallback);
        return fallback;
    }

    function getColor(): string | null {
        return window.localStorage.getItem("mentat_display_color");
    }


    initCollab();

    watch(
        () => state.currentTime,
        () => {
            if (typeof updateUnitPositions === "function") {
                updateUnitPositions();
            } else {
                // Until geoUnitLayers.ts is patched, ensure units still move.
                drawUnits();
            }
            updateTimeDependentOverlays();
        },
        { flush: "post" },
    );

    watch([settingsStore, symbolSettings], () => {
        clearUnitStyleCache();
        drawUnits();
    });

    /**
     * Feature layers are currently re-initialized on every time tick, which is expensive.
     * Throttle to avoid rebuilding them dozens of times per second during scrubbing/playback.
     */
    const refreshFeatureLayers = useThrottleFn(() => {
        initializeFeatureLayersFromStore({
            doClearCache: false,
            filterVisible: !doNotFilterLayers.value,
        });

        // trigger redraw of selected features
        if (selectedFeatureIds.value.size > 0) {
            const ids = Array.from(selectedFeatureIds.value);
            selectedFeatureIds.value.clear();
            for (const id of ids) {
                selectedFeatureIds.value.add(id);
            }
        }
    }, 100);

    watch(
        [() => state.currentTime, doNotFilterLayers, () => state.featureStateCounter],
        refreshFeatureLayers,
    );

    onUnmounted(() => {
        stopUnitPosHook?.();
        stopUnitPosHook = null;
        collab?.stop().catch(() => undefined);
        collab = null;
        presenceStore.clear();

        geoStore.olMap = undefined;
        clearUnitStyleCache();
    });

    onScenarioAction(async (e) => {
        if (e.action === "exportToImage") {
            await saveMapAsPng(olMap);
        }
    });
</script>

<template>
    <div v-if="isDragging"
         class="pointer-events-none absolute inset-0 border-4 border-dashed border-blue-700">
        <p class="absolute bottom-1 left-2 rounded bg-white px-1 text-base tracking-tighter text-gray-800 tabular-nums">
            {{ formattedPosition }}
        </p>
    </div>
</template>
