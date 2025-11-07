// src/modules/threeDView/graphics/unitparser.ts

/** ───────────────────────── Types ───────────────────────── */
export type UnitLike = {
    id?: string | number;
    name?: string;

    // Any one of these may contain the group id
    group?: string | number;
    groupId?: string | number;
    _gid?: string | number;

    parent_id?: string | number;
    _pid?: string | number;

    symbolOptions?: {
        fillColor?: string;     // we will overwrite this (group-only)
        iconFillColor?: string; // optional mirror target
        [k: string]: any;
    };

    [k: string]: any;
};

export type GroupLike = {
    id: string | number;
    name?: string;

    // Your probe shows color often at symbolOptions.fillColor
    fillColor?: string;                 // fallback #1 if present
    color?: string;                     // fallback #2
    symbolOptions?: { fillColor?: string }; // preferred source in your data
    style?: { fill?: string };          // other shapes we've seen in repos
    meta?: { color?: string };          // last-ditch fallback
    [k: string]: any;
};

export type GroupColorIndex = Map<string | number, string>;

export type ApplyOptions = {
    defaultColor?: string;  // default "#888888"
    mirrorToIcon?: boolean; // default true
};

/** ─────────────────── Internal helpers ─────────────────── */
function resolveUnitGroupId(u: UnitLike): string | number | undefined {
    return u.group ?? u.groupId ?? u._gid ?? undefined;
}

function pickCssColorFromGroup(g?: GroupLike | null): string | undefined {
    if (!g) return undefined;
    return (
        (typeof g.symbolOptions?.fillColor === "string" && g.symbolOptions.fillColor.trim()) ||
        (typeof g.fillColor === "string" && g.fillColor.trim()) ||
        (typeof g.color === "string" && g.color.trim()) ||
        (typeof g.style?.fill === "string" && g.style.fill.trim()) ||
        (typeof g.meta?.color === "string" && g.meta.color.trim()) ||
        undefined
    );
}

function optsOrDefault(o?: ApplyOptions) {
    return {
        defaultColor: o?.defaultColor ?? "#888888",
        mirrorToIcon: o?.mirrorToIcon ?? true,
    };
}

/** ───────────── Build index from various containers ───────────── */
export function buildGroupColorIndex(
    groups: Array<GroupLike> | Record<string | number, GroupLike> | Map<any, any>
): GroupColorIndex {
    const idx: GroupColorIndex = new Map();
    if (!groups) return idx;

    if (groups instanceof Map) {
        for (const g of groups.values()) {
            const id = (g?.id ?? (g as any)?.groupId) as any;
            if (id == null) continue;
            const c = pickCssColorFromGroup(g);
            if (c) idx.set(id, c);
        }
        return idx;
    }

    if (Array.isArray(groups)) {
        for (const g of groups) {
            if (!g || g.id == null) continue;
            const c = pickCssColorFromGroup(g);
            if (c) idx.set(g.id, c);
        }
        return idx;
    }

    if (typeof groups === "object") {
        for (const [k, gAny] of Object.entries(groups)) {
            const g = gAny as GroupLike;
            const gid = (g?.id ?? (isFinite(+k) ? +k : k)) as any;
            if (gid == null) continue;
            const c = pickCssColorFromGroup(g);
            if (c) idx.set(gid, c);
        }
    }

    return idx;
}

/** Build specifically from your scenario store (top-level state.sideGroupMap object). */
export function buildIndexFromScenarioStore(storeLike: any): GroupColorIndex {
    const s = storeLike?.state ?? storeLike ?? {};
    const idx: GroupColorIndex = new Map();

    // Primary: sideGroupMap is a plain object with group objects as values
    if (s.sideGroupMap && typeof s.sideGroupMap === "object") {
        const i = buildGroupColorIndex(s.sideGroupMap as Record<string, GroupLike>);
        for (const [k, v] of i) idx.set(k, v);
    }

    // Optional future fallbacks—harmless if absent
    if (s.groupMap) {
        const i = buildGroupColorIndex(s.groupMap as any);
        for (const [k, v] of i) idx.set(k, v);
    }
    if (s.groups) {
        const i = buildGroupColorIndex(s.groups as any);
        for (const [k, v] of i) idx.set(k, v);
    }

    return idx;
}

/** ───────────── Apply color to a unit / units ───────────── */
export function getGroupFillColorForUnit(
    unit: UnitLike,
    groupColorIdx: GroupColorIndex,
    o?: ApplyOptions
): string {
    const opts = optsOrDefault(o);
    const gid = resolveUnitGroupId(unit);
    return (gid != null ? groupColorIdx.get(gid) : undefined) ?? opts.defaultColor;
}

export function applyGroupFillColorToUnit(
    unit: UnitLike,
    groupColorIdx: GroupColorIndex,
    o?: ApplyOptions
): UnitLike {
    if (!unit) return unit;
    const css = getGroupFillColorForUnit(unit, groupColorIdx, o);
    unit.symbolOptions = unit.symbolOptions ?? {};
    unit.symbolOptions.fillColor = css;
    if (o?.mirrorToIcon ?? true) {
        unit.symbolOptions.iconFillColor = css;
    }
    return unit;
}

export function applyGroupFillColors<T extends UnitLike>(
    units: Iterable<T>,
    groupColorIdx: GroupColorIndex,
    o?: ApplyOptions
): Iterable<T> {
    for (const u of units) applyGroupFillColorToUnit(u, groupColorIdx, o);
    return units;
}

/** Convenience: one-shot build + apply */
export function colorizeUnitsFromGroups<T extends UnitLike>(
    units: Iterable<T>,
    groups: Array<GroupLike> | Record<string | number, GroupLike> | Map<any, any>,
    o?: ApplyOptions
): { index: GroupColorIndex; units: Iterable<T> } {
    const idx = buildGroupColorIndex(groups);
    applyGroupFillColors(units, idx, o);
    return { index: idx, units };
}
