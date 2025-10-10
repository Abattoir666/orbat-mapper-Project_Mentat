// src/importexport/common/importUnits.ts
import { stableId, makeUnitSeed, ensureUniqueId, newId } from "@/utils/ids";

export type ImportRow = {
    id?: string;             // external id, preserve if present
    name: string;
    sidc?: string;
    side: string;            // key to resolve -> sideId
    group: string;           // key to resolve -> groupId
    parent_id?: string;      // external parent id (same space as id)
    fillColor?: string;
    t?: number;
    lat?: number;
    lon?: number;
};

type UnitLike = {
    id: string;
    name: string;
    sidc?: string;
    subUnits: UnitLike[];
    symbolOptions?: { fillColor?: string };
    _sid: string;
    _gid: string;
    _pid?: string;
    state: Array<{ id: string; t: number; location: [number, number] }>;
};

export function importRows(
    rows: ImportRow[],
    ctx: {
        resolveSideId: (sideKey: string) => string;
        resolveGroupId: (groupKey: string, sideId: string) => string;
        existsId: (id: string) => boolean;          // check against scenario ids
        findUnitById: (id: string) => UnitLike | undefined;   // from store
        findGroupById: (id: string) => { subUnits: UnitLike[] } | undefined; // from store
    }
): UnitLike[] {
    // 1) Assign ids (preserve if present)
    const idMap = new Map<string, string>(); // external -> final
    const staged: Array<{ row: ImportRow; unit: UnitLike }> = [];

    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];

        const sideId = ctx.resolveSideId(r.side);
        const groupId = ctx.resolveGroupId(r.group, sideId);

        // decide id
        let id = (r.id || "").trim();
        if (!id) {
            const seed = makeUnitSeed({
                source: "csv",
                sideKey: r.side,
                groupKey: r.group,
                parentChain: [],        // optional: supply if you have parent name-path data
                sidc: r.sidc,
                name: r.name,
                ordinal: i
            });
            id = stableId(seed);
            id = ensureUniqueId(id, ctx.existsId);
        } else {
            id = ensureUniqueId(id, ctx.existsId);  // preserve, but guard against clash
            idMap.set(r.id!, id);
        }

        const unit: UnitLike = {
            id,
            name: r.name,
            sidc: r.sidc,
            subUnits: [],
            symbolOptions: r.fillColor ? { fillColor: r.fillColor } : {},
            _sid: sideId,
            _gid: groupId,
            state: []
        };

        if (r.t != null && r.lat != null && r.lon != null) {
            unit.state.push({ id: newId(), t: r.t, location: [r.lon, r.lat] });
        }

        staged.push({ row: r, unit });
    }

    // 2) Parent wiring
    const byId = new Map(staged.map(s => [s.unit.id, s.unit]));
    for (const s of staged) {
        const parentExt = s.row.parent_id?.trim();
        if (!parentExt) continue;
        const parentId = idMap.get(parentExt) || (ctx.existsId(parentExt) ? parentExt : undefined);
        if (parentId) s.unit._pid = parentId;
    }

    // 3) Attach to tree
    const created: UnitLike[] = [];
    for (const s of staged) {
        const u = s.unit;
        if (u._pid) {
            const parent = byId.get(u._pid) || ctx.findUnitById(u._pid);
            if (!parent) continue;
            parent.subUnits.push(u);
        } else {
            const group = ctx.findGroupById(u._gid);
            if (!group) continue;
            group.subUnits.push(u);
        }
        created.push(u);
    }

    return created;
}