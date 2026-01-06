import { createUnitFeatureAt, createUnitLayer } from "@/geo/layers";
// import Fade from "ol-ext/featureanimation/Fade";

import { computed, onMounted, onUnmounted, ref, type Ref, unref, watch } from "vue";
import OLMap from "ol/Map";
import VectorLayer from "ol/layer/Vector";
import { fromLonLat, toLonLat } from "ol/proj";
import { Point } from "ol/geom";
import { DragBox, Modify, Select } from "ol/interaction";
import { ModifyEvent } from "ol/interaction/Modify";
import { Feature } from "ol";
import { type MaybeRef } from "@vueuse/core";

import {
    clearUnitStyleCache,
    createUnitStyle,
    unitStyleCache,
    selectedUnitStyleCache,
} from "@/geo/unitStyles";

import {
    altKeyOnly,
    click as clickCondition,
    platformModifierKeyOnly,
} from "ol/events/condition";

import { SelectEvent } from "ol/interaction/Select";
import { useSelectedItems } from "@/stores/selectedStore";

import { injectStrict } from "@/utils";
import { activeScenarioKey } from "@/components/injects";
import type { TScenario } from "@/types/internalModels";

import { useUiStore } from "@/stores/uiStore";
import { useGeoStore } from "@/stores/geoStore";

import { formatPosition } from "@/geo/utils";

import { centroid } from "@turf/centroid";

import View from "ol/View";
import type { FeatureLike } from "ol/Feature";

import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import type Style from "ol/style/Style";

export type Position = [number, number];

let zoomResolutions: number[] = [];

/** Local minimal drag payload typing/guards (avoids repo-specific types modules). */
type DragData = any;
function isUnitDragItem(d: any): d is { unit: any } {
    return !!d && typeof d === "object" && "unit" in d;
}
function isScenarioFeatureDragItem(d: any): d is { feature: any } {
    return !!d && typeof d === "object" && "feature" in d;
}

export function calculateZoomToResolution(view: View) {
    zoomResolutions = [];
    for (let i = 0; i <= 24; i++) {
        zoomResolutions.push(view.getResolutionForZoom(i));
    }
}
calculateZoomToResolution(new View());

/**
 * Apply label highlight styling to a Style or Style[] produced by createUnitStyle().
 * - Yellow fill + dark stroke for legibility.
 * - Boldens existing font while preserving size/family.
 */
function applySelectedLabelStyle(styleOrStyles: any) {
    const styles: Style[] = Array.isArray(styleOrStyles) ? styleOrStyles : [styleOrStyles];
    for (const s of styles) {
        const text = s?.getText?.();
        if (!text) continue;

        text.setFill(new Fill({ color: "rgba(255,255,0,1)" }));
        text.setStroke(new Stroke({ color: "rgba(0,0,0,0.90)", width: 4 }));

        const font = text.getFont?.();
        if (font && !/^\s*bold\b/i.test(font)) {
            text.setFont(`bold ${font}`);
        }
    }
}

export function useUnitLayer({ activeScenario }: { activeScenario?: TScenario } = {}) {
    const {
        store: { state, onUndoRedo },
        geo,
        unitActions: { getCombinedSymbolOptions },
        helpers: { getUnitById },
    } = activeScenario || injectStrict(activeScenarioKey);

    const { selectedUnitIds } = useSelectedItems();

    const unitLayer = createUnitLayer();

    /**
     * Keep features stable and update geometry in-place.
     * This avoids expensive source.clear() + re-add cycles on every redraw/time tick.
     */
    const featureByUnitId = new Map<string, Feature<Point>>();

    function unitStyleFunction(feature: FeatureLike, resolution: number) {
        const unitId = feature?.getId() as string;
        if (!unitId) return;

        const unit = getUnitById(unitId);

        // Zoom gating (applies to both selected and unselected)
        const { limitVisibility, minZoom = 0, maxZoom = 24 } = unit?.style ?? {};
        if (
            limitVisibility &&
            (resolution > zoomResolutions[minZoom ?? 0] ||
                resolution < zoomResolutions[maxZoom ?? 24])
        ) {
            return;
        }

        // Selected variant: MilSymbol outline stroke + label highlight (cached)
        if (selectedUnitIds.value?.has(unitId) && unit) {
            let sel = selectedUnitStyleCache.get(unitId);
            if (!sel) {
                const symbolOptions = getCombinedSymbolOptions(unit);

                sel = createUnitStyle(unit, {
                    ...symbolOptions,
                    outlineColor: "yellow",
                    outlineWidth: 14,
                } as any);

                // Highlight the label (fill/stroke/bold) on the selected style.
                applySelectedLabelStyle(sel);

                selectedUnitStyleCache.set(unitId, sel);
            }
            return sel;
        }

        // Normal variant (cached)
        let base = unitStyleCache.get(unitId);
        if (!base && unit) {
            const symbolOptions = getCombinedSymbolOptions(unit);
            base = createUnitStyle(unit, symbolOptions);
            unitStyleCache.set(unitId, base);
        }
        return base;
    }

    unitLayer.setStyle(unitStyleFunction);

    onUndoRedo(() => {
        clearUnitStyleCache();
        state.unitStateCounter++;
    });

    function setFeaturePosition(feature: Feature<Point>, lonLat: [number, number]) {
        const geom = feature.getGeometry();
        if (!geom) return;

        const newCoord = fromLonLat(lonLat);
        const cur = geom.getCoordinates();

        // Avoid OL change churn if coord identical
        if (cur && cur[0] === newCoord[0] && cur[1] === newCoord[1]) return;

        geom.setCoordinates(newCoord);
    }

    /**
     * Full sync: create/update features for the current visible unit set,
     * and remove features that are no longer visible.
     *
     * Call this when visibility membership changes (filters/toggles).
     */
    const drawUnits = () => {
        const source = unitLayer.getSource();
        if (!source) return;

        const visible = geo.everyVisibleUnit.value;
        const seen = new Set<string>();

        for (const unit of visible) {
            const unitId = unit?.id as string;
            if (!unitId) continue;

            const lonLat = (unit._state?.location ?? unit.location) as [number, number] | undefined;

            if (!lonLat) {
                const existing = featureByUnitId.get(unitId);
                if (existing) {
                    source.removeFeature(existing);
                    featureByUnitId.delete(unitId);
                    unitStyleCache.delete(unitId);
                    selectedUnitStyleCache.delete(unitId);
                }
                continue;
            }

            seen.add(unitId);

            let f = featureByUnitId.get(unitId);
            if (!f) {
                f = createUnitFeatureAt(lonLat, unit) as Feature<Point>;
                if (!f.getId()) f.setId(unitId);
                featureByUnitId.set(unitId, f);
                source.addFeature(f);
            } else {
                if (!f.getId()) f.setId(unitId);
                setFeaturePosition(f, lonLat);
            }
        }

        // Prune features that are no longer visible
        for (const [unitId, f] of featureByUnitId) {
            if (!seen.has(unitId)) {
                source.removeFeature(f);
                featureByUnitId.delete(unitId);
                unitStyleCache.delete(unitId);
                selectedUnitStyleCache.delete(unitId);
            }
        }
    };

    /**
     * Fast path: update positions only.
     * Intended for every time tick (scrub/playback).
     *
     * Does not prune non-visible features; use drawUnits() for membership changes.
     */
    const updateUnitPositions = () => {
        const source = unitLayer.getSource();
        if (!source) return;

        const visible = geo.everyVisibleUnit.value;

        for (const unit of visible) {
            const unitId = unit?.id as string;
            if (!unitId) continue;

            const lonLat = (unit._state?.location ?? unit.location) as [number, number] | undefined;
            if (!lonLat) continue;

            let f = featureByUnitId.get(unitId);
            if (!f) {
                // Lazily create if drawUnits() hasn't run yet.
                f = createUnitFeatureAt(lonLat, unit) as Feature<Point>;
                if (!f.getId()) f.setId(unitId);
                featureByUnitId.set(unitId, f);
                source.addFeature(f);
            } else {
                if (!f.getId()) f.setId(unitId);
                setFeaturePosition(f, lonLat);
            }
        }
    };

    const animateUnits = () => {
        // Keep existing call sites working; animations can be reintroduced later.
        drawUnits();
    };

    return { unitLayer, drawUnits, animateUnits, updateUnitPositions };
}

export function useMapDrop(
    mapRef: MaybeRef<OLMap | null | undefined>,
    unitLayer: MaybeRef<VectorLayer<any>>,
) {
    const { geo } = injectStrict(activeScenarioKey);

    let dndCleanup = () => { };
    const isDragging = ref(false);
    const dropPosition = ref<Position>([0, 0]);

    const formattedPosition = computed(() =>
        isDragging.value ? formatPosition(dropPosition.value) : "",
    );

    function onDragOver(event: DragEvent) {
        event.preventDefault();
        isDragging.value = true;

        const coordinates = unref(mapRef)
            ?.getEventCoordinate(event as any)
            ?.map((v) => +v);

        if (!coordinates) return;
        dropPosition.value = toLonLat(coordinates) as Position;
    }

    function onDragLeave(event: DragEvent) {
        event.preventDefault();
        isDragging.value = false;
    }

    function onDrop(event: DragEvent) {
        event.preventDefault();
        isDragging.value = false;

        const data = event.dataTransfer?.getData("application/orbatmapper");
        if (!data) return;

        const dragData: DragData = JSON.parse(data);

        if (isUnitDragItem(dragData)) {
            const pos = dropPosition.value;
            const unitSource = unref(unitLayer).getSource();
            const existingUnitFeature = unitSource?.getFeatureById(dragData.unit.id);

            geo.addUnitPosition(dragData.unit.id, pos);

            if (existingUnitFeature) {
                existingUnitFeature.setGeometry(new Point(fromLonLat(pos)));
            } else {
                unitSource?.addFeature(createUnitFeatureAt(pos, dragData.unit));
            }
        } else if (isScenarioFeatureDragItem(dragData)) {
            const geometryCenter = centroid(dragData.feature).geometry.coordinates;
            const to = dropPosition.value;
            const diff = [to[0] - geometryCenter[0], to[1] - geometryCenter[1]];

            geo.addFeaturePosition(dragData.feature.id, diff);
        }
    }

    onMounted(() => {
        document.addEventListener("dragover", onDragOver);
        document.addEventListener("dragleave", onDragLeave);
        document.addEventListener("drop", onDrop);

        dndCleanup = () => {
            document.removeEventListener("dragover", onDragOver);
            document.removeEventListener("dragleave", onDragLeave);
            document.removeEventListener("drop", onDrop);
        };
    });

    onUnmounted(() => {
        dndCleanup();
    });

    return { isDragging, formattedPosition };
}

export function useUnitSelectInteraction(
    layers: VectorLayer<any>[],
    _map: OLMap,
    { enable }: { enable: Ref<boolean> },
) {
    const { selectedUnitIds } = useSelectedItems();

    /**
     * IMPORTANT:
     * style: null => Select will NOT override the feature style.
     * This prevents selected units from disappearing.
     *
     * Highlighting is handled in the unit layer style function (selectedUnitStyleCache).
     */
    const unitSelectInteraction = new Select({
        condition: clickCondition,
        layers,
        style: null,
    });

    const boxSelectInteraction = new DragBox({
        condition: platformModifierKeyOnly,
    });

    unitSelectInteraction.on("select", (e: SelectEvent) => {
        const set = selectedUnitIds.value;

        for (const f of e.deselected) {
            const id = f.getId() as string;
            if (id) set.delete(id);
        }
        for (const f of e.selected) {
            const id = f.getId() as string;
            if (id) set.add(id);
        }

        // Force immediate style re-evaluation so highlights appear/disappear now.
        for (const layer of layers) layer.changed();
    });

    boxSelectInteraction.on("boxend", () => {
        const extent = boxSelectInteraction.getGeometry().getExtent();
        const set = selectedUnitIds.value;

        for (const layer of layers) {
            const source = layer.getSource();
            if (!source) continue;

            source.forEachFeatureIntersectingExtent(extent, (feature) => {
                const id = feature.getId() as string;
                if (id) set.add(id);
            });
        }

        for (const layer of layers) layer.changed();
    });

    function setActive(active: boolean) {
        unitSelectInteraction.setActive(active);
        boxSelectInteraction.setActive(active);
    }

    watch(enable, (v) => setActive(!!v), { immediate: true });

    function redraw() {
        for (const layer of layers) layer.changed();
    }

    return { unitSelectInteraction, boxSelectInteraction, redraw };
}

export function useMoveInteraction(
    _map: OLMap,
    unitLayer: VectorLayer<any>,
    enable: Ref<boolean>,
) {
    const geoStore = useGeoStore();
    const uiStore = useUiStore();

    const moveInteraction = new Modify({
        source: unitLayer.getSource()!,
        condition: altKeyOnly,
    });

    moveInteraction.on("modifyend", (e: ModifyEvent) => {
        const features = e.features.getArray();
        for (const f of features) {
            const id = f.getId() as string;
            const geom = f.getGeometry() as Point;
            const coords = toLonLat(geom.getCoordinates()) as Position;

            // Update scenario geo state
            geoStore.activeScenario?.geo?.addUnitPosition(id, coords);

            // Disable drag mode when modification ends
            uiStore.setMoveUnitMode(false);
        }
    });

    watch(enable, (v) => moveInteraction.setActive(!!v), { immediate: true });

    return { moveInteraction };
}
