// src/symbology/underbars/toeUnderbarBillboard.ts
import { toePctToCssColor } from "@/symbology/underbars/toeUnderbarColor";
import {
    normalizePersonnelRow,
    flagsAtTimeMs,
    statusFromFlags,
} from "@/modules/scenarioeditor/Personnel/personnelTypes";

export const TOE_UNDERBAR_HIDE_AT_OR_ABOVE = 100;

function clamp(n: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, n));
}

function doctrinalBaselineCount(unitAny: any): number {
    const direct =
        (typeof unitAny?.doctrinalPersonnelBaselineTotal === "number" ? unitAny.doctrinalPersonnelBaselineTotal : undefined) ??
        (typeof unitAny?.doctrinalBaselineTotal === "number" ? unitAny.doctrinalBaselineTotal : undefined) ??
        (typeof unitAny?.doctrinalBaseline === "number" ? unitAny.doctrinalBaseline : undefined);

    if (typeof direct === "number" && Number.isFinite(direct) && direct >= 0) return direct;

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
        unitAny?.children ??
        unitAny?.childIds ??
        unitAny?.subordinateIds ??
        unitAny?.subordinates ??
        unitAny?.subUnits ??
        unitAny?.subunits ??
        [];

    if (Array.isArray(candidates)) {
        for (const c of candidates) push(c);
    }
    return out;
}

function collectUnitAndDescendants(rootUnit: any, getUnitById: (id: string) => any): any[] {
    const out: any[] = [];
    const seen = new Set<string>();

    const visit = (u: any) => {
        if (!u) return;

        const id =
            typeof u?.id === "string" ? u.id :
                (typeof u?.unitId === "string" ? u.unitId : "");

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

function okKnownCount(unitAny: any, tMs: number): number {
    const rosterRaw = Array.isArray(unitAny?.personnelRoster) ? unitAny.personnelRoster : [];
    let ok = 0;

    for (const r of rosterRaw) {
        const nr: any = normalizePersonnelRow(r);
        if (nr?.isLeader || nr?._isLeader) continue;

        // Same semantics as 2D: known if in rolls OR KIA at time.
        const f: any = flagsAtTimeMs(nr, tMs);
        if (!(f?.InRolls || f?.KIA)) continue;

        const s = statusFromFlags(f);
        if (s === "Ok") ok += 1;
    }
    return ok;
}

export function computeToePctForUnit(
    unitAny: any,
    tMs: number,
    includeSubs: boolean,
    getUnitById: (id: string) => any,
): number | null {
    if (!unitAny) return null;

    const units = includeSubs ? collectUnitAndDescendants(unitAny, getUnitById) : [unitAny];

    let baseline = 0;
    for (const u of units) baseline += doctrinalBaselineCount(u);
    if (!(baseline > 0)) return null;

    let ok = 0;
    for (const u of units) ok += okKnownCount(u, tMs);

    const pct = (ok / baseline) * 100;
    return Number.isFinite(pct) ? pct : null;
}

function computeUnderbarGeometry(iconPx: number) {
    const icon = Number.isFinite(iconPx) && iconPx > 0 ? iconPx : 30;

    // Match 2D map underbar intent:
    // w ≈ (icon + 4) * 1.40, h ≈ clamp(icon*0.13 + 1, 4..7) * 2
    let w = Math.round(icon + 4);
    let h = clamp(Math.round(icon * 0.13) + 1, 4, 7);

    w = Math.round(w * 1.40);
    h = clamp(Math.round(h * 2), 4, 10);

    const strokePx = 1;
    const gapPx = 1;

    // “Meter-ish” rounded ends (similar to UnderbarMeter)
    const rx = Math.round(h / 2);

    return { w, h, rx, strokePx, gapPx };
}

export function makeToeUnderbarSvgDataUrl(pct: number, iconPx: number) {
    const { w, h, rx, strokePx, gapPx } = computeUnderbarGeometry(iconPx);
    const color = toePctToCssColor(pct);

    const inset = strokePx / 2;

    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
        `<rect x="${inset}" y="${inset}" width="${w - strokePx}" height="${h - strokePx}" ` +
        `rx="${Math.max(0, rx - inset)}" ry="${Math.max(0, rx - inset)}" ` +
        `fill="${color}" stroke="rgb(0 0 0)" stroke-width="${strokePx}" vector-effect="non-scaling-stroke" />` +
        `</svg>`;

    const url = "data:image/svg+xml;utf8," + encodeURIComponent(svg);
    return { url, w, h, gapPx };
}
