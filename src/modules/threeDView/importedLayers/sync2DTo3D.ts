// src/modules/threeDView/importedLayers/sync2DTo3D.ts
import { watch, type WatchStopHandle } from "vue";
import { convertScenarioImportedLayers, type Imported2DLayer } from "./conversion";

export type OverlayApi = {
    addOverlayTemplate?: (
        id: string,
        url: string,
        opts?: {
            minLevel?: number;
            maxLevel?: number;
            attribution?: string;
            geographic?: boolean;
            subdomains?: string[] | string;
            alpha?: number;
        }
    ) => void;
    setOverlayAlpha?: (id: string, alpha: number) => void;
    setOverlayVisibility?: (id: string, show: boolean) => void;
    removeOverlay?: (id: string) => void;
    listOverlays?: () => Array<{ id: string; url?: string }>;
};

type MinimalScenarioLike = unknown;

/** Extract identity + render-relevant props we’ll diff on */
function keyOf(l: Imported2DLayer) {
    // Only imagery-like layers are supported in this first pass.
    // For future vector support, extend this key and the apply() switch below.
    switch (l.type) {
        case "XYZLayer":
            return `xyz:${l.id}:${l.url}:${l.geographic ? "g" : "m"}:${l.minLevel ?? ""}:${l.maxLevel ?? ""}`;
        case "TileJSONLayer":
            // conversion() should have resolved to .url if available
            return `tilejson:${l.id}:${l.url ?? ""}:${l.geographic ? "g" : "m"}:${l.minLevel ?? ""}:${l.maxLevel ?? ""}`;
        case "WMTSLayer":
            // If your converter emits a resolved template URL, this will track it
            return `wmts:${l.id}:${l.url}:${l.geographic ? "g" : "m"}:${l.minLevel ?? ""}:${l.maxLevel ?? ""}`;
        default:
            return `${l.type}:${l.id}`;
    }
}

function isImageryLike(l: Imported2DLayer): boolean {
    return l.type === "XYZLayer" || l.type === "TileJSONLayer" || l.type === "WMTSLayer" || l.type === "WMSLayer";
}

/** Apply (create or update) one imagery-like layer onto the globe */
function applyImageryLike(globe: OverlayApi, lIn: any) {
    // Accept UI rows (with .layer) or raw layers
    const layer = lIn?.layer ? { ...lIn.layer, id: lIn.id } : lIn;
    if (!layer) return;

    const alpha = typeof layer.opacity === "number" ? layer.opacity : 1;
    const show = !layer.isHidden;

    const isXYZ = layer.type === "XYZLayer";
    const opts = {
        minLevel: layer.minLevel as number | undefined,
        maxLevel: layer.maxLevel as number | undefined,
        attribution: layer.attribution as string | undefined,
        // Default XYZ to Web Mercator unless explicitly overridden
        geographic: layer.geographic ?? (isXYZ ? false : true),
        subdomains: layer.subdomains as string | string[] | undefined,
        alpha,
    };

    const url = layer.url as string | undefined;
    if (!url || !globe.addOverlayTemplate) return;

    globe.addOverlayTemplate(layer.id, url, opts);
    globe.setOverlayVisibility?.(layer.id, show);
    globe.setOverlayAlpha?.(layer.id, alpha);
}

/** Remove one overlay from the globe */
function removeOverlay(globe: OverlayApi, id: string) {
    if (globe.removeOverlay) globe.removeOverlay(id);
}

/** Ensure ordering by re-adding in the provided order when identities changed.
 *  This is conservative but reliable across adapters that don’t expose z-index setters. */
function reapplyInOrder(globe: OverlayApi, layers: Imported2DLayer[]) {
    // Remove only imagery-like layers we’re managing (leave other overlays alone).
    if (globe.listOverlays) {
        const managedIds = new Set(layers.filter(isImageryLike).map(l => l.id));
        for (const o of globe.listOverlays()) {
            if (managedIds.has(o.id)) removeOverlay(globe, o.id);
        }
    } else {
        // Fallback: blind-remove everything we know we manage
        for (const l of layers) if (isImageryLike(l)) removeOverlay(globe, l.id);
    }
    for (const l of layers) if (isImageryLike(l)) applyImageryLike(globe, l);
    console.log("[sync2DTo3D] reapply order:", layers.map(x => x.id));
}

export type SyncHandle = {
    stop: () => void;
    /** Force a full reconcile now (useful after base-layer changes) */
    reconcileNow: () => void;
};

/**
 * Mount 2D imported layers onto the globe as imagery overlays (labels/rasters),
 * keep them ordered above the base layer, and live-sync on scenario or store changes.
 */
export function syncImported2DTo3D(globe: OverlayApi, scenarioRef: { value: MinimalScenarioLike | null | undefined }): SyncHandle {
    let prevKeys: string[] = [];
    let prevById = new Map<string, Imported2DLayer>();
    let stopWatch: WatchStopHandle | null = null;

    let _runId = 0;
    const reconcile = async () => {
        const myRun = ++_runId;
        const scenario = scenarioRef.value;
        if (!scenario) return;

        // Converter can be async; normalize to an array
        // Converter returns UI rows: { id, title, type, alpha, on, layer }
        const raw = await Promise.resolve(convertScenarioImportedLayers(scenario as any));
        const uiRows = Array.isArray(raw) ? raw : [];
        // Unwrap to the actual imagery layer objects, and ensure id matches the UI row id
        const layers = uiRows
            .map((u: any) => (u && u.layer ? { ...u.layer, id: u.id } : null))
            .filter(Boolean) as Imported2DLayer[];
        if (_runId !== myRun) return; // drop stale runs if a newer reconcile started

        // Compute identity keys for diffing (URL/projection/zoom-range changes cause identity change)
        const keys = layers.map(keyOf);
        const byId = new Map(layers.map(l => [l.id, l]));

        // If identities changed (add/remove/retemplate/reorder), do a safe reapply to preserve order
        const identityChanged =
            keys.length !== prevKeys.length ||
            keys.some((k, i) => k !== prevKeys[i]);

        if (identityChanged) {
            reapplyInOrder(globe, layers);
            prevKeys = keys;
            prevById = byId;
            return;
        }

        // Otherwise, identities and order match: update alpha/visibility deltas only
        for (const l of layers) {
            const prev = prevById.get(l.id);
            if (!prev) continue;

            const nowHidden = (l as any).isHidden ? true : false;
            const prevHidden = (prev as any).isHidden ? true : false;

            const nowAlpha = typeof (l as any).opacity === "number" ? (l as any).opacity : 1;
            const prevAlpha = typeof (prev as any).opacity === "number" ? (prev as any).opacity : 1;

            if (nowHidden !== prevHidden && globe.setOverlayVisibility) {
                globe.setOverlayVisibility(l.id, !nowHidden);
            }
            if (nowAlpha !== prevAlpha && globe.setOverlayAlpha) {
                globe.setOverlayAlpha(l.id, nowAlpha);
            }
        }

        // Save snapshot
        prevById = byId;
    };

    // Initial run + reactive updates
    void reconcile();
    stopWatch = watch(
        () => scenarioRef.value,
        () => { void reconcile(); },
        { deep: true, immediate: true }
    );

    return {
        stop() {
            if (stopWatch) stopWatch(), (stopWatch = null);
            // Clean up managed overlays
            if (globe.listOverlays) {
                // Remove only overlays we previously managed
                const managedIds = new Set(prevById.keys());
                for (const o of globe.listOverlays() ?? []) {
                    if (managedIds.has(o.id)) removeOverlay(globe, o.id);
                }
            } else {
                // Fallback: remove last-known set
                for (const id of prevById.keys()) removeOverlay(globe, id);
            }
            prevById.clear();
            prevKeys = [];
        },
        reconcileNow: reconcile,
    };
}
