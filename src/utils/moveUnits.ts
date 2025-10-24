type MoveTarget =
    | { type: "group"; groupId: string; sideId: string }
    | { type: "unit"; parentUnitId: string };

export function moveUnitsInScenario(state: any, unitIds: string[], target: MoveTarget) {
    const s = state;
    const uMap = s.unitMap ||= {};
    const gMap = s.groupMap ||= {};
    const sg = s.sideGroupMap ||= {};

    function detachFromOldParents(uid: string) {
        const u = uMap[uid]; if (!u) return;
        // remove from previous parent unit if any
        if (u._pid && uMap[u._pid]) {
            const p = uMap[u._pid];
            if (Array.isArray(p.subUnits)) p.subUnits = p.subUnits.filter((x: any) => (x?.id ?? x) !== uid);
        }
        // remove from any group node lists
        for (const gid of Object.keys(gMap)) {
            const g = gMap[gid];
            if (Array.isArray(g.subUnits)) g.subUnits = g.subUnits.filter((x: any) => (x?.id ?? x) !== uid);
        }
        for (const gid of Object.keys(sg)) {
            const node = sg[gid];
            if (Array.isArray(node?.subUnits)) node.subUnits = node.subUnits.filter((x: any) => (x?.id ?? x) !== uid);
        }
    }

    function attachToGroup(uid: string, groupId: string, sideId: string) {
        const g = gMap[groupId] ||= { id: groupId, type: "group", name: "Units", subUnits: [] };
        const gNode = sg[groupId] ||= { id: groupId, type: "group", name: g.name, subUnits: g.subUnits };
        const sideNode = sg[sideId] ||= { id: sideId, groups: [], subUnits: [] };

        if (!g.subUnits.includes(uid)) g.subUnits.push(uid);
        if (!gNode.subUnits.includes(uid)) gNode.subUnits.push(uid);

        // ensure side lists this group node object
        if (!sideNode.groups.some((x: any) => (x?.id ?? x) === groupId)) sideNode.groups.push(gNode);

        // set unit fields
        const u = uMap[uid]; if (!u) return;
        u._pid = groupId; u.groupId = groupId; u.sideId = sideId;
    }

    function attachToParentUnit(uid: string, parentId: string) {
        const p = uMap[parentId] ||= { id: parentId, type: "unit", name: parentId, subUnits: [], equipment: [], personnel: [] };
        if (!Array.isArray(p.subUnits)) p.subUnits = [];
        if (!p.subUnits.includes(uid)) p.subUnits.push(uid);
        const u = uMap[uid]; if (!u) return;
        u._pid = parentId;
        // preserve side/group fields as-is
    }

    for (const uid of unitIds) {
        detachFromOldParents(uid);
        if (target.type === "group") attachToGroup(uid, target.groupId, target.sideId);
        else attachToParentUnit(uid, target.parentUnitId);
    }

    s.unitStateCounter = (s.unitStateCounter ?? 0) + 1;
    s.featureStateCounter = (s.featureStateCounter ?? 0) + 1;
}