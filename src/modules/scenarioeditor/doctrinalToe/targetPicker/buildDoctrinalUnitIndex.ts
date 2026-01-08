// src/modules/scenarioeditor/doctrinalToe/targetPicker/buildDoctrinalUnitIndex.ts

import type { EntityId } from "@/types/base";
import type { NScenario, NUnit } from "@/types/internalModels";
import type { DoctrinalUnitIndexRow } from "./doctrinalTargetTypes";

// Safely read a string
function s(v: unknown): string | undefined {
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    return t ? t : undefined;
}

function pushRow(out: DoctrinalUnitIndexRow[], u: any, meta: Partial<DoctrinalUnitIndexRow>) {
    out.push({
        id: u.id as EntityId,
        name: s(u.name) ?? "(unnamed)",
        shortName: s(u.shortName),
        unitNumber: s(u.unitNumber),

        sidc: (u.sidc ?? "") as string,
        symbolOptions: (u.symbolOptions ?? undefined) as any,

        sideId: meta.sideId,
        sideName: meta.sideName,
        groupId: meta.groupId,
        groupName: meta.groupName,
        parentId: meta.parentId,

        depth: meta.depth,
        path: meta.path,
        tags: meta.tags,
    });
}

/**
 * Build a flat, searchable index of units for the Doctrinal TO&E target picker.
 *
 * This intentionally includes helper fields (depth/path/tags) to support
 * fast filtering and “include subordinates” UX.
 */
export function buildDoctrinalUnitIndexFromUnitMap(args: {
    scenario: NScenario;
    unitMap: Map<EntityId, NUnit>;
}): DoctrinalUnitIndexRow[] {
    const { scenario, unitMap } = args;

    // Build side/group name maps for quick labels
    const sideNameById = new Map<EntityId, string>();
    const groupNameById = new Map<EntityId, string>();

    for (const side of scenario.sides ?? []) {
        sideNameById.set(side.id as EntityId, s(side.name) ?? "Side");
        for (const g of side.groups ?? []) {
            groupNameById.set(g.id as EntityId, s(g.name) ?? "Group");
        }
    }

    const out: DoctrinalUnitIndexRow[] = [];

    // Pass 1: push all units flat, with side/group labels if present on unit
    for (const u of unitMap.values()) {
        const sideId = (u as any).sideId as EntityId | undefined;
        const groupId = (u as any).groupId as EntityId | undefined;

        pushRow(out, u, {
            sideId,
            sideName: sideId ? sideNameById.get(sideId) : undefined,
            groupId,
            groupName: groupId ? groupNameById.get(groupId) : undefined,
            parentId: (u as any).parentId as EntityId | undefined,
        });
    }

    return out;
}

/**
 * Optional helper: build an index restricted to a subtree, but still includes
 * side/group labels when available.
 */
export function buildDoctrinalUnitIndexForSubtree(args: {
    scenario: NScenario;
    unitMap: Map<EntityId, NUnit>;
    subtreeIds: EntityId[];
}): DoctrinalUnitIndexRow[] {
    const { scenario, unitMap, subtreeIds } = args;

    const sideNameById = new Map<EntityId, string>();
    const groupNameById = new Map<EntityId, string>();

    for (const side of scenario.sides ?? []) {
        sideNameById.set(side.id as EntityId, s(side.name) ?? "Side");
        for (const g of side.groups ?? []) {
            groupNameById.set(g.id as EntityId, s(g.name) ?? "Group");
        }
    }

    const out: DoctrinalUnitIndexRow[] = [];

    for (const id of subtreeIds) {
        const u = unitMap.get(id);
        if (!u) continue;

        const sideId = (u as any).sideId as EntityId | undefined;
        const groupId = (u as any).groupId as EntityId | undefined;

        pushRow(out, u, {
            sideId,
            sideName: sideId ? sideNameById.get(sideId) : undefined,
            groupId,
            groupName: groupId ? groupNameById.get(groupId) : undefined,
            parentId: (u as any).parentId as EntityId | undefined,
        });
    }

    return out;
}
