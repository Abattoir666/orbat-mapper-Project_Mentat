// src/modules/scenarioeditor/bulkEdit/quickBulkActions.ts

export type ScenarioStoreLike = {
    unitMap?: any;           // Map | Record | Array or a Ref to one
    state?: { unitMap?: any };
    history?: { push?: (entry: { undo: () => void; redo: () => void }) => void };
};

function getUnitMap(store: ScenarioStoreLike) {
    const um =
        (store as any)?.unitMap?.value ??
        (store as any)?.unitMap ??
        (store as any)?.state?.unitMap;
    return um;
}

function getUnit(store: ScenarioStoreLike, id: string): any | undefined {
    const um = getUnitMap(store);
    if (!um) return undefined;
    if (typeof um.get === "function") return um.get(id);             // Map
    if (Array.isArray(um)) return um.find((u: any) => u?.id === id); // Array
    if (typeof um === "object") return um[id];                        // Dict
    return undefined;
}

function setUnit(store: ScenarioStoreLike, u: any) {
    const um = getUnitMap(store);
    if (!um || !u) return;
    if (typeof um.set === "function") { um.set(u.id, u); return; }    // Map
    if (Array.isArray(um)) {
        const i = um.findIndex((x: any) => x?.id === u.id);
        if (i >= 0) um.splice(i, 1, u);
        return;
    }
    if (typeof um === "object") { um[u.id] = u; }
}

/** Minimal field snapshot so we don't clone reactive or circular data */
type SidcSnapshot = { id: string; prevSidc?: string };
type FillSnapshot = { id: string; prevFill?: string; hadSymbolOptions: boolean };

export function setSidcBulk(store: ScenarioStoreLike, ids: Iterable<string>, sidc: string) {
    const v = String(sidc || "").trim();
    if (!v) return;

    const list = Array.from(ids);
    if (!list.length) return;

    const before: SidcSnapshot[] = [];

    // compute next values and apply
    for (const id of list) {
        const cur = getUnit(store, id);
        if (!cur) continue;
        before.push({ id, prevSidc: cur.sidc });
        setUnit(store, { ...cur, sidc: v });
    }

    // undo/redo only touches sidc
    store?.history?.push?.({
        undo: () => {
            for (const snap of before) {
                const cur = getUnit(store, snap.id);
                if (!cur) continue;
                setUnit(store, { ...cur, sidc: snap.prevSidc });
            }
        },
        redo: () => {
            for (const id of list) {
                const cur = getUnit(store, id);
                if (!cur) continue;
                setUnit(store, { ...cur, sidc: v });
            }
        },
    });
}

export function setFillColorBulk(
    store: ScenarioStoreLike,
    ids: Iterable<string>,
    fillColor: string
) {
    const v = String(fillColor || "").trim();
    if (!v) return;

    const list = Array.from(ids);
    if (!list.length) return;

    const before: FillSnapshot[] = [];

    // compute next values and apply
    for (const id of list) {
        const cur = getUnit(store, id);
        if (!cur) continue;

        const hadSymbolOptions = !!cur.symbolOptions;
        const prevFill = cur.symbolOptions?.fillColor;

        before.push({ id, prevFill, hadSymbolOptions });

        const nextSO = { ...(cur.symbolOptions ?? {}), fillColor: v };
        setUnit(store, { ...cur, symbolOptions: nextSO });
    }

    // undo/redo only touches symbolOptions.fillColor (rest untouched)
    store?.history?.push?.({
        undo: () => {
            for (const snap of before) {
                const cur = getUnit(store, snap.id);
                if (!cur) continue;

                if (snap.hadSymbolOptions) {
                    const so = { ...(cur.symbolOptions ?? {}) };
                    if (typeof snap.prevFill === "undefined") {
                        // remove the key if it didn't exist before
                        if ("fillColor" in so) delete (so as any).fillColor;
                    } else {
                        (so as any).fillColor = snap.prevFill;
                    }
                    setUnit(store, { ...cur, symbolOptions: so });
                } else {
                    // previously no symbolOptions at all
                    const so = { ...(cur.symbolOptions ?? {}) };
                    if ("fillColor" in so) delete (so as any).fillColor;
                    // if SO becomes empty, you can remove it entirely if desired:
                    // const keys = Object.keys(so);
                    // setUnit(store, { ...cur, ...(keys.length ? { symbolOptions: so } : { symbolOptions: undefined }) });
                    setUnit(store, { ...cur, symbolOptions: so });
                }
            }
        },
        redo: () => {
            for (const id of list) {
                const cur = getUnit(store, id);
                if (!cur) continue;
                const so = { ...(cur.symbolOptions ?? {}), fillColor: v };
                setUnit(store, { ...cur, symbolOptions: so });
            }
        },
    });
}
