import { onMounted, onBeforeUnmount } from "vue";

export type DragPayload = {
    kind: "orbat/units";
    unitIds: string[];          // selected IDs, IN THE ORDER you passed to beginDrag
    source: "sidebar" | "map";
    order?: string[];           // same as unitIds, explicit for clarity
    fromListId?: string;        // optional: parent/group id of the source list (if you have it)
};

/**
 * Helpers you can call in your drop handler to keep ordering stable.
 * - stableInsert: move a block of ids into a list at a given index (from another list)
 * - stableReorderWithinSameList: reorder a block inside the same list
 */
export function stableInsert(
    list: string[],
    movedIds: string[],
    insertAt: number
): string[] {
    const moveSet = new Set(movedIds);
    // Remove any moved ids from the destination list first
    const withoutMoved = list.filter((id) => !moveSet.has(id));
    const at = Math.max(0, Math.min(insertAt, withoutMoved.length));
    return [
        ...withoutMoved.slice(0, at),
        ...movedIds,                // insert in the order provided
        ...withoutMoved.slice(at),
    ];
}

export function stableReorderWithinSameList(
    list: string[],
    movedIds: string[],
    insertAt: number
): string[] {
    const moveSet = new Set(movedIds);

    // Filter out moved ids, preserving order of everything else
    const withoutMoved = list.filter((id) => !moveSet.has(id));

    // If the insertion point was inside the block we just removed,
    // clamp it to the start of where that block used to be.
    // Compute how many items before insertAt were *not* moved to adjust index.
    const notMovedBefore = list.slice(0, insertAt).filter((id) => !moveSet.has(id)).length;
    const at = Math.max(0, Math.min(notMovedBefore, withoutMoved.length));

    return [
        ...withoutMoved.slice(0, at),
        ...movedIds,                // keep the dragged selection order intact
        ...withoutMoved.slice(at),
    ];
}

export function useMultiDrag() {
    const MIME = "application/x-orbat-units";

    function beginDrag(
        e: DragEvent,
        unitIds: string[],
        opts?: { fromListId?: string }
    ) {
        if (!e.dataTransfer) return;

        // Ensure the order we send is exactly the order of the current selection
        const ordered = unitIds.slice();

        const payload: DragPayload = {
            kind: "orbat/units",
            unitIds: ordered,
            order: ordered,
            source: "sidebar",
            fromListId: opts?.fromListId,
        };

        e.dataTransfer.setData(MIME, JSON.stringify(payload));
        e.dataTransfer.effectAllowed = "move";

        // Ghost image showing count
        const ghost = document.createElement("div");
        ghost.style.cssText = `
      position: fixed; top:-1000px; left:-1000px; z-index:9999;
      padding:6px 10px; border-radius:8px; background:#111; color:#fff; font:500 12px/1.2 system-ui;
      box-shadow: 0 6px 20px rgba(0,0,0,.35);
    `;
        ghost.textContent = ordered.length === 1 ? "Move 1 unit" : `Move ${ordered.length} units`;
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 0, 0);

        // Cleanup the ghost
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
            return parsed?.kind === "orbat/units" ? (parsed as DragPayload) : null;
        } catch {
            return null;
        }
    }
    // --- helpers (module-local; no 'export' keywords here) ---
    function orderIdsAsInList(list: string[], ids: string[]): string[] {
        const pos = new Map<string, number>();
        list.forEach((id, i) => pos.set(id, i));
        return [...ids].sort((a, b) => (pos.get(a) ?? Infinity) - (pos.get(b) ?? Infinity));
    }

    function makeParentLookup(unitMap: Record<string, any>): (id: string) => string | undefined {
        return (id: string) => {
            const u = unitMap[id];
            return u?._pid ?? u?.parentId ?? u?.groupId ?? undefined;
        };
    }

    function topLevelSelection(ids: string[], parentOf: (s: string) => string | undefined): string[] {
        const set = new Set(ids);
        return ids.filter((id) => {
            let p = parentOf(id);
            while (p) {
                if (set.has(p)) return false;
                p = parentOf(p);
            }
            return true;
        });
    }

    function removeIds(list: string[], ids: string[]): string[] {
        const rm = new Set(ids);
        return list.filter((id) => !rm.has(id));
    }

    function insertBlock(listWithoutBlock: string[], block: string[], at: number): string[] {
        const res = listWithoutBlock.slice();
        res.splice(at, 0, ...block);
        return res;
    }

    const multiDragUtils = {
        orderIdsAsInList,
        makeParentLookup,
        topLevelSelection,
        removeIds,
        insertBlock,
    };

    return {
        beginDrag,
        readPayload,
        multiDragUtils,
    };
}