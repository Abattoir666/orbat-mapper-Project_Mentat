import { createUnitFeatureAt, createUnitLayer } from "@/geo/layers";
// import Fade from "ol-ext/featureanimation/Fade";

import { computed, onMounted, onUnmounted, ref, type Ref, unref, watch } from "vue";

import { effectiveToeUnderbarEnabled } from "@/symbology/underbars/underbarSettings";
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
import { toePctToCssColor } from "@/symbology/underbars/toeUnderbarColor";

import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import { Icon, Style } from "ol/style";
import { useSettingsStore } from "@/stores/settingsStore";
import { normalizePersonnelRow, flagsAtTimeMs, statusFromFlags } from "@/modules/scenarioeditor/Personnel/personnelTypes";

export type Position = [number, number];

let zoomResolutions: number[] = [];

function toMs(v: any): number {
    if (v == null) return Date.now();
    if (typeof v === "number") return v;
    if (v instanceof Date) return v.getTime();
    const n = Date.parse(String(v));
    return Number.isFinite(n) ? n : Date.now();
}
type NormStatus = "Ok" | "WIA" | "KIA" | "POW" | "MIA" | "Unknown";

function normStatus(v: any): NormStatus {
    const t = String(v ?? "").trim().toUpperCase();
    if (!t) return "Unknown";

    // Accept a few common "OK known" spellings explicitly
    if (t === "OK" || t === "OK_KNOWN" || t === "KNOWN OK" || t === "KNOWN_OK") return "Ok";

    // If you use "PRESENT" to mean OK-known, keep this:
    if (t === "PRESENT") return "Ok";

    if (t === "WIA") return "WIA";
    if (t === "KIA") return "KIA";
    if (t === "POW") return "POW";
    if (t === "MIA") return "MIA";

    if (t.includes("WOUND")) return "WIA";
    if (t.includes("KILL")) return "KIA";
    if (t.includes("PRISON")) return "POW";
    if (t.includes("MISSING")) return "MIA";

    // IMPORTANT: unrecognized statuses are NOT known OK
    return "Unknown";
}
function parseDateMs(s: any): number | null {
    if (typeof s !== "string") return null;
    const t = s.trim();
    if (!t) return null;
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms : null;
}
function isActiveAtTimeMs(row: any, tMs: number): boolean {
    const start = parseDateMs(row?.intakeDate);
    const end = parseDateMs(row?.outtakeDate);
    if (start != null && tMs < start) return false;
    if (end != null && tMs > end) return false;
    return true;
}
function statusAtTimeFromRow(row: any, tMs: number): NormStatus {
    const segs = Array.isArray(row?.statusSegments) ? row.statusSegments : [];
    for (const seg of segs) {
        const sMs = parseDateMs(seg?.start);
        const eMs = parseDateMs(seg?.end);
        const afterStart = sMs == null ? true : tMs >= sMs;
        const beforeEnd = eMs == null ? true : tMs <= eMs;
        if (afterStart && beforeEnd) return normStatus(seg?.status);
    }
    return normStatus(row?.status);
}
function doctrinalBaselineCount(unitAny: any): number {
    // Prefer the doctrinal baseline (what the UI labels as "Doctrinal baseline") if available.
    const direct =
        (typeof unitAny?.doctrinalPersonnelBaselineTotal === "number" ? unitAny.doctrinalPersonnelBaselineTotal : undefined) ??
        (typeof unitAny?.doctrinalBaselineTotal === "number" ? unitAny.doctrinalBaselineTotal : undefined) ??
        (typeof unitAny?.doctrinalBaseline === "number" ? unitAny.doctrinalBaseline : undefined);
    if (typeof direct === "number" && Number.isFinite(direct) && direct >= 0) return direct;

    // Common shapes:
    // - doctrinalPersonnelBaseline.rows: [{ count: number|string, ... }, ...]
    // - doctrinalPersonnelBaseline: same as above
    const doctrinalRows =
        unitAny?.doctrinalPersonnelBaseline?.rows ||
        unitAny?.doctrinalPersonnelBaseline ||
        unitAny?.doctrinalBaselineRows ||
        [];
    if (Array.isArray(doctrinalRows) && doctrinalRows.length) {
        let sum = 0;
        for (const r of doctrinalRows) sum += Number((r as any)?.count) || 0;
        return sum;
    }

    // Fallback: if doctrinal baseline is not present on this unit, use the unit's own TO&E baseline rows.
    // (This matches how the TO&E/S UI rolls up baselines for subordinate scope in some modes.)
    const toeRows = unitAny?.toeBaseline?.personnel || unitAny?.toeBaseline?.personnelRows || [];
    if (Array.isArray(toeRows) && toeRows.length) {
        let sum = 0;
        for (const r of toeRows) sum += Number((r as any)?.count) || 0;
        return sum;
    }

    return 0;
}
function extractSubordinateIds(unitAny: any): string[] {
    const out: string[] = [];
    const push = (v: any) => {
        if (!v) return;
        if (typeof v === "string") out.push(v);
        else if (typeof v === "object") {
            if (typeof v.id === "string") out.push(v.id);
            else if (typeof v.unitId === "string") out.push(v.unitId);
        }
    };

    const candidates =
        unitAny?.subUnitIds ??
        unitAny?.subunitIds ??
        unitAny?.subordinates ??
        unitAny?.children ??
        unitAny?.childIds ??
        unitAny?.subUnits ??
        unitAny?.subunits ??
        [];

    if (Array.isArray(candidates)) {
        for (const c of candidates) push(c);
    }
    return out;
}

function collectUnitAndDescendants(
    rootUnit: any,
    getUnitById: (id: string) => any,
): any[] {
    const out: any[] = [];
    const seen = new Set<string>();

    const visit = (u: any) => {
        if (!u) return;

        const id = typeof u?.id === "string" ? u.id : (typeof u?.unitId === "string" ? u.unitId : "");
        if (id) {
            if (seen.has(id)) return;
            seen.add(id);
        }

        out.push(u);

        for (const sid of extractSubordinateIds(u)) {
            const su = getUnitById?.(sid);
            if (su) visit(su);
        }
    };

    visit(rootUnit);
    return out;
}

function doctrinalBaselineCountAggregate(units: any[]): number {
    let sum = 0;
    for (const u of units) sum += doctrinalBaselineCount(u);
    return sum;
}

function okKnownCountAggregate(units: any[], tMs: number): number {
    let sum = 0;
    for (const u of units) sum += okKnownCount(u, tMs);
    return sum;
}

function okKnownCount(unitAny: any, tMs: number): number {
    const rosterRaw = Array.isArray(unitAny?.personnelRoster) ? unitAny.personnelRoster : [];
    let ok = 0;

    for (const r of rosterRaw) {
        const nr: any = normalizePersonnelRow(r);
        if (nr?.isLeader || nr?._isLeader) continue;

        // Mirror UnitDetailsToe.vue "knownRosterAtTime" inclusion:
        // a row is "known" if it's in rolls OR KIA at that time.
        const f: any = flagsAtTimeMs(nr, tMs);
        if (!(f?.InRolls || f?.KIA)) continue;

        const s = statusFromFlags(f);
        if (s === "Ok") ok += 1;
    }

    return ok;
}

function clamp(n: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, n));
}

function computeUnderbarGeometry(mapIconSize: number) {
    const icon = Number.isFinite(mapIconSize) && mapIconSize > 0 ? mapIconSize : 30;

    // Base geometry (keep your existing proportional rules)
    let w = Math.round(icon + 4);
    let h = clamp(Math.round(icon * 0.13) + 1, 4, 7);

    // If you already decided on +15% longer and +20% taller, apply here:
    w = Math.round(w * 1.40);
    h = clamp(Math.round(h * 2), 4, 10);

    const rx = 0;

    // NEW: top of bar is tethered to symbol bottom (not bottom of bar)
    const gap = 1; // set 0 for touching; 1–2 for "tasteful" spacing
    const displacementY = -(icon / 2 + gap);

    return { w, h, rx, displacementY };
}


function makeUnderbarIconStyle(pct: number, mapIconSize: number): Style {
    const color = toePctToCssColor(pct);
    const { w, h, rx, displacementY } = computeUnderbarGeometry(mapIconSize);

    // Outline (black), inset so stroke doesn't clip at the edges.
    const sw = 1;
    const inset = sw / 2;

    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
        `<rect x="${inset}" y="${inset}" width="${w - sw}" height="${h - sw}" ` +
        `rx="${Math.max(0, rx - inset)}" ry="${Math.max(0, rx - inset)}" ` +
        `fill="${color}" stroke="rgb(0 0 0)" stroke-width="${sw}" vector-effect="non-scaling-stroke" />` +
        `</svg>`;

    const src = "data:image/svg+xml;utf8," + encodeURIComponent(svg);

    return new Style({
        image: new Icon({
            src,
            anchor: [0.5, 0],
            anchorXUnits: "fraction",
            anchorYUnits: "fraction",
            displacement: [0, displacementY],
            scale: 1,
        }),
        zIndex: 0,
    });
}

function buildToeUnderbarForUnit(
    unitAny: any,
    tMs: number,
    mapIconSize: number,
    includeSubs: boolean,
    getUnitById: (id: string) => any,
): Style | null {
    if (!effectiveToeUnderbarEnabled.value) return null;
    if (!unitAny) return null;

    const units = includeSubs ? collectUnitAndDescendants(unitAny, getUnitById) : [unitAny];

    const baseline = doctrinalBaselineCountAggregate(units);
    if (!(baseline > 0)) return null;

    const ok = okKnownCountAggregate(units, tMs);

    const pct = (ok / baseline) * 100;
    if (!Number.isFinite(pct)) return null;

    return makeUnderbarIconStyle(pct, mapIconSize);
}
// --- end TOES underbar helpers ---


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
        time,
        unitActions: { getCombinedSymbolOptions },
        helpers: { getUnitById },
    } = activeScenario || injectStrict(activeScenarioKey);

    const { selectedUnitIds } = useSelectedItems();

    const unitLayer = createUnitLayer();
    const settingsStore = useSettingsStore();
    const uiStore = useUiStore();

    /**
     * Wire this to whatever your UI checkbox toggles.
     * This is defensive: it supports several plausible property names.
     */
    const toeIncludeSubordinates = computed<boolean>(() => {
        const u: any = uiStore as any;
        return Boolean(
            u?.includeSubordinates ??
            u?.includeSubordinatesInToe ??
            u?.includeSubordinatesInToeSummary ??
            u?.toeIncludeSubordinates ??
            false,
        );
    });

    /**
     * Map icon size in pixels, used to tether underbars to the symbol bottom edge.
     * Pinia may unwrap refs depending on store implementation, so be defensive.
     */
    const getMapIconSizePx = () => {
        const raw: any = unref((settingsStore as any).mapIconSize);
        const n = typeof raw === "number" ? raw : Number(raw);
        return Number.isFinite(n) && n > 0 ? n : 30;
    };


    /**
     * Keep features stable and update geometry in-place.
     * This avoids expensive source.clear() + re-add cycles on every redraw/time tick.
     */
    const featureByUnitId = new Map<string, Feature<Point>>();

    function unitStyleFunction(feature: FeatureLike, resolution: number) {
        try {
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
            const bar = buildToeUnderbarForUnit(
                unit as any,
                toMs(time?.scenarioTime?.value),
                getMapIconSizePx(),
                toeIncludeSubordinates.value,
                getUnitById,
            );

            return bar ? [sel, bar] : sel;
        }

        // Normal variant (cached)
        let base = unitStyleCache.get(unitId);
        if (!base && unit) {
            const symbolOptions = getCombinedSymbolOptions(unit);
            base = createUnitStyle(unit, symbolOptions);
            unitStyleCache.set(unitId, base);
        }
            const bar = buildToeUnderbarForUnit(
                unit as any,
                toMs(time?.scenarioTime?.value),
                getMapIconSizePx(),
                toeIncludeSubordinates.value,
                getUnitById,
            );

        return bar ? [base, bar] : base;
    
        } catch (err) {
            console.error("[toeUnderbar] unitStyleFunction failed", err);
            return;
        }
}

    unitLayer.setStyle(unitStyleFunction);

    // Re-render styles when time changes (units may not move, but coverage can).
    watch(() => time?.scenarioTime?.value, () => {
        try { unitLayer.changed(); } catch { /* ignore */ }
    });

    // Re-render when toggle flips.
    watch(effectiveToeUnderbarEnabled, () => {
        try { unitLayer.changed(); } catch { /* ignore */ }
    });

    watch(toeIncludeSubordinates, () => {
        try { unitLayer.changed(); } catch { /* ignore */ }
    });

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