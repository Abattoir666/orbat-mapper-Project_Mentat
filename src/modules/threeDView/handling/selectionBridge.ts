import * as Cesium from "cesium";

export interface SelectionBridge {
    install(): void;
    uninstall(): void;
}

type LonLatAlt = [number, number, number?];

type SceneToWindow = (scene: any, world: any) => { x: number; y: number } | undefined;

function getSceneToWindowFn(): SceneToWindow | null {
    const ST: any = (Cesium as any).SceneTransforms;
    // Cesium versions differ: prefer the function that exists.
    if (typeof ST?.wgs84ToWindowCoordinates === "function") return ST.wgs84ToWindowCoordinates;
    if (typeof ST?.worldToWindowCoordinates === "function") return ST.worldToWindowCoordinates;
    return null;
}

function tryExtractUnitIdFromPicked(picked: any): string | null {
    const id = picked?.id;
    if (!id) return null;

    const ent = id as any;
    const props = ent?.properties;
    const v = props?.unitId?.getValue?.(Cesium.JulianDate.now());
    if (typeof v === "string") return v;

    if (typeof ent?.id === "string") return ent.id;
    if (typeof ent?.name === "string") return ent.name;

    return null;
}

function screenToLonLatAlt(viewer: Cesium.Viewer, screen: Cesium.Cartesian2): LonLatAlt | null {
    const cart =
        viewer.scene.pickPosition?.(screen) ??
        viewer.camera.pickEllipsoid(screen, viewer.scene.globe.ellipsoid);
    if (!cart) return null;

    const carto = Cesium.Cartographic.fromCartesian(cart);
    const lon = Cesium.Math.toDegrees(carto.longitude);
    const lat = Cesium.Math.toDegrees(carto.latitude);
    const alt = Number.isFinite(carto.height) ? carto.height : 0;
    return [lon, lat, alt];
}

function disableCamera(viewer: Cesium.Viewer) {
    const c = viewer.scene.screenSpaceCameraController;
    c.enableRotate = false;
    c.enableTranslate = false;
    c.enableZoom = false;
    c.enableTilt = false;
    c.enableLook = false;
}

function restoreCamera(viewer: Cesium.Viewer) {
    const c = viewer.scene.screenSpaceCameraController;
    c.enableRotate = true;
    c.enableTranslate = true;
    c.enableZoom = true;
    c.enableTilt = true;
    c.enableLook = false;
}

export function createCesiumSelectionBridge(opts: {
    getViewer: () => Cesium.Viewer | undefined;

    /** Return true when other tools are consuming clicks (location-pick, etc.) */
    isSuppressed?: () => boolean;

    /** Return true when move tool is enabled */
    isMoveMode?: () => boolean;

    /** Called when a unit is clicked */
    onUnitClick: (unitId: string, addToMulti: boolean) => void;

    /** Called when user clicks empty space (optional) */
    onEmptyClick?: () => void;

    /** Called when multi selection is requested (box select). addToMulti is almost always true for shift-drag. */
    onBoxSelect?: (unitIds: string[], addToMulti: boolean) => void;

    /** Called when move-mode click hits globe terrain */
    onMoveTarget?: (pos: LonLatAlt) => void;

    /** Called when user wants to deselect (right click in move mode) */
    onDeselect?: () => void;
}): SelectionBridge {
    let installed = false;
    let canvas: HTMLCanvasElement | null = null;

    // Modifier state (fallback for focus quirks)
    let shiftDown = false;
    let ctrlDown = false;
    let metaDown = false;

    // Drag state
    let dragging = false;
    let dragPointerId: number | null = null;
    let dragStart: Cesium.Cartesian2 | null = null;
    let dragNow: Cesium.Cartesian2 | null = null;

    // Visual rectangle
    let boxEl: HTMLDivElement | null = null;

    function isSuppressed(): boolean {
        try {
            return !!opts.isSuppressed?.();
        } catch {
            return false;
        }
    }

    function isMoveMode(): boolean {
        try {
            return !!opts.isMoveMode?.();
        } catch {
            return false;
        }
    }

    function isDragBoxArmed(e: PointerEvent): boolean {
        // Shift-drag box-select gesture.
        return e.shiftKey || shiftDown;
    }

    function addToMulti(e: PointerEvent): boolean {
        return e.shiftKey || e.ctrlKey || e.metaKey || shiftDown || ctrlDown || metaDown;
    }

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === "Shift") shiftDown = true;
        if (e.key === "Control") ctrlDown = true;
        if (e.key === "Meta") metaDown = true;
    }

    function onKeyUp(e: KeyboardEvent) {
        if (e.key === "Shift") shiftDown = false;
        if (e.key === "Control") ctrlDown = false;
        if (e.key === "Meta") metaDown = false;
    }

    function onBlur() {
        shiftDown = ctrlDown = metaDown = false;
        stopDrag();
    }

    function getCanvasPos(e: PointerEvent): Cesium.Cartesian2 | null {
        if (!canvas) return null;
        const r = canvas.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return new Cesium.Cartesian2(x, y);
    }

    function ensureBoxEl() {
        if (!canvas) return;
        if (boxEl) return;

        const parent = canvas.parentElement;
        if (!parent) return;

        // Ensure parent can position absolutely.
        const cs = window.getComputedStyle(parent);
        if (cs.position === "static") {
            parent.style.position = "relative";
        }

        const el = document.createElement("div");
        el.style.position = "absolute";
        el.style.left = "0px";
        el.style.top = "0px";
        el.style.width = "0px";
        el.style.height = "0px";
        el.style.border = "3px solid rgba(229,231,235,0.95)";  // thicker "side grey" (gray-200)
        el.style.background = "transparent";                   // hollow
        el.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.25)";     // optional: improves contrast on bright imagery
        el.style.pointerEvents = "none";
        el.style.zIndex = "999";
        el.style.display = "none";

        parent.appendChild(el);
        boxEl = el;
    }

    function updateBoxEl() {
        if (!boxEl || !dragStart || !dragNow) return;

        const minX = Math.min(dragStart.x, dragNow.x);
        const minY = Math.min(dragStart.y, dragNow.y);
        const maxX = Math.max(dragStart.x, dragNow.x);
        const maxY = Math.max(dragStart.y, dragNow.y);

        boxEl.style.display = "block";
        boxEl.style.left = `${minX}px`;
        boxEl.style.top = `${minY}px`;
        boxEl.style.width = `${Math.max(0, maxX - minX)}px`;
        boxEl.style.height = `${Math.max(0, maxY - minY)}px`;
    }

    function hideBoxEl() {
        if (boxEl) boxEl.style.display = "none";
    }

    function stopDrag() {
        const viewer = opts.getViewer();
        if (viewer && dragging) restoreCamera(viewer);

        dragging = false;
        dragPointerId = null;
        dragStart = null;
        dragNow = null;
        hideBoxEl();
    }

    function pickUnitsInRect(viewer: Cesium.Viewer, a: Cesium.Cartesian2, b: Cesium.Cartesian2): string[] {
        const out = new Set<string>();

        const toWin = getSceneToWindowFn();
        if (!toWin) return out;

        const minX = Math.min(a.x, b.x);
        const maxX = Math.max(a.x, b.x);
        const minY = Math.min(a.y, b.y);
        const maxY = Math.max(a.y, b.y);

        const t = viewer.clock.currentTime;

        for (const ent of viewer.entities.values) {
            const props = (ent as any)?.properties;
            const uid = props?.unitId?.getValue?.(t);
            const id = typeof uid === "string" ? uid : ((ent as any)?.id as string | undefined);
            if (typeof id !== "string") continue;

            const pos = (ent as any)?.position?.getValue?.(t);
            if (!pos) continue;

            const win = toWin(viewer.scene, pos);
            if (!win) continue;

            if (win.x >= minX && win.x <= maxX && win.y >= minY && win.y <= maxY) {
                out.add(id);
            }
        }

        return Array.from(out);
    }

    function onContextMenu(e: MouseEvent) {
        if (isMoveMode()) e.preventDefault();
    }

    function onPointerDown(e: PointerEvent) {
        if (isSuppressed()) return;

        // Right click = deselect in move mode
        if (e.button === 2) {
            if (isMoveMode()) {
                e.preventDefault();
                opts.onDeselect?.();
            }
            return;
        }

        if (e.button !== 0) return;

        const viewer = opts.getViewer();
        const p = getCanvasPos(e);
        if (!viewer || !p) return;

        // Shift-drag box select only when starting on empty terrain.
        if (isDragBoxArmed(e)) {
            const picked = viewer.scene.pick(p);
            const unitId = tryExtractUnitIdFromPicked(picked);
            if (!unitId) {
                ensureBoxEl();
                dragging = true;
                dragPointerId = e.pointerId;
                dragStart = new Cesium.Cartesian2(p.x, p.y);
                dragNow = new Cesium.Cartesian2(p.x, p.y);

                try {
                    canvas?.setPointerCapture(e.pointerId);
                } catch {
                    // ignore
                }

                disableCamera(viewer);
                updateBoxEl();
                e.preventDefault();
                return;
            }
        }
    }

    function onPointerMove(e: PointerEvent) {
        if (!dragging) return;
        if (dragPointerId !== e.pointerId) return;

        const p = getCanvasPos(e);
        if (!p) return;

        dragNow = new Cesium.Cartesian2(p.x, p.y);
        updateBoxEl();
        e.preventDefault();
    }

    function onPointerUp(e: PointerEvent) {
        if (isSuppressed()) {
            stopDrag();
            return;
        }

        const viewer = opts.getViewer();

        // Finish drag-box
        if (e.button === 0 && dragging && dragPointerId === e.pointerId && viewer && dragStart) {
            const end = getCanvasPos(e);
            const start = dragStart;

            // Restore camera regardless
            restoreCamera(viewer);

            if (end) {
                const dx = Math.abs(end.x - start.x);
                const dy = Math.abs(end.y - start.y);
                const wasDrag = dx > 6 || dy > 6;

                if (wasDrag) {
                    const ids = pickUnitsInRect(viewer, start, end);
                    // Shift-drag is always additive in practice.
                    opts.onBoxSelect?.(ids, true);
                    viewer.scene.requestRender();
                }
            }

            stopDrag();
            e.preventDefault();
            return;
        }

        // Not a drag-box: treat as click.
        if (e.button !== 0) {
            stopDrag();
            return;
        }

        if (!viewer) return;
        const p = getCanvasPos(e);
        if (!p) return;

        // Move mode: click unit selects; click empty moves.
        if (isMoveMode()) {
            const picked = viewer.scene.pick(p);
            const unitId = tryExtractUnitIdFromPicked(picked);
            if (unitId) {
                opts.onUnitClick(unitId, addToMulti(e));
                return;
            }

            const llh = screenToLonLatAlt(viewer, p);
            if (llh) opts.onMoveTarget?.(llh);
            else opts.onEmptyClick?.();
            return;
        }

        // Normal selection
        const picked = viewer.scene.pick(p);
        const unitId = tryExtractUnitIdFromPicked(picked);

        if (!unitId) {
            opts.onEmptyClick?.();
            return;
        }

        opts.onUnitClick(unitId, addToMulti(e));
    }

    function onPointerCancel(e: PointerEvent) {
        if (dragging && dragPointerId === e.pointerId) stopDrag();
    }

    function install() {
        if (installed) return;

        const viewer = opts.getViewer();
        if (!viewer) return;

        canvas = viewer.scene.canvas as HTMLCanvasElement;
        if (!canvas) return;

        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("keyup", onKeyUp, true);
        window.addEventListener("blur", onBlur, true);

        canvas.addEventListener("contextmenu", onContextMenu, true);

        // Capture phase + non-passive so we can preventDefault for selection.
        canvas.addEventListener("pointerdown", onPointerDown, { capture: true, passive: false });
        canvas.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
        canvas.addEventListener("pointerup", onPointerUp, { capture: true, passive: false });
        canvas.addEventListener("pointercancel", onPointerCancel, { capture: true, passive: false });

        installed = true;
    }

    function uninstall() {
        if (!installed) return;

        stopDrag();

        window.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("keyup", onKeyUp, true);
        window.removeEventListener("blur", onBlur, true);

        if (canvas) {
            canvas.removeEventListener("contextmenu", onContextMenu, true);
            canvas.removeEventListener("pointerdown", onPointerDown as any, true);
            canvas.removeEventListener("pointermove", onPointerMove as any, true);
            canvas.removeEventListener("pointerup", onPointerUp as any, true);
            canvas.removeEventListener("pointercancel", onPointerCancel as any, true);
        }

        // We leave boxEl in DOM (harmless), but hide it.
        hideBoxEl();

        installed = false;
        canvas = null;
    }

    return { install, uninstall };
}
