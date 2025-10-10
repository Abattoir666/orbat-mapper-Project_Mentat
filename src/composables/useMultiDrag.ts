import { onMounted, onBeforeUnmount } from "vue";

export type DragPayload = {
    kind: "orbat/units";
    unitIds: string[];
    source: "sidebar" | "map";
};

export function useMultiDrag() {
    const MIME = "application/x-orbat-units";

    function beginDrag(e: DragEvent, unitIds: string[]) {
        if (!e.dataTransfer) return;

        const payload: DragPayload = { kind: "orbat/units", unitIds, source: "sidebar" };
        e.dataTransfer.setData(MIME, JSON.stringify(payload));
        e.dataTransfer.effectAllowed = "move";

        // Ghost image showing count
        const ghost = document.createElement("div");
        ghost.style.cssText = `
      position: fixed; top:-1000px; left:-1000px; z-index:9999;
      padding:6px 10px; border-radius:8px; background:#111; color:#fff; font:500 12px/1.2 system-ui;
      box-shadow: 0 6px 20px rgba(0,0,0,.35);
    `;
        ghost.textContent = unitIds.length === 1 ? "Move 1 unit" : `Move ${unitIds.length} units`;
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 0, 0);

        // Cleanup
        const cleanup = () => ghost.remove();
        onMounted(() => document.addEventListener("dragend", cleanup, { once: true }));
        onBeforeUnmount(() => cleanup());
    }

    function readPayload(e: DragEvent): DragPayload | null {
        const dt = e.dataTransfer;
        if (!dt) return null;
        try {
            const raw = dt.getData(MIME);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return (parsed?.kind === "orbat/units") ? parsed as DragPayload : null;
        } catch { return null; }
    }

    return { beginDrag, readPayload, MIME };
}