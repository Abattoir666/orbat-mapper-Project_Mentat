// src/modules/scenarioeditor/ExtendedScenarioEvents/useInvolvedUnits.ts
import { computed } from "vue";
import type { EntityId } from "@/types/base";
import { injectStrict } from "@/utils";
import { activeScenarioKey } from "@/components/injects";
import { walkSide } from "@/stores/scenarioStore";

type UnitLike = any;

function toNumber(x: any): number | null {
    const n = typeof x === "number" ? x : typeof x === "string" ? Number(x) : NaN;
    return Number.isFinite(n) ? n : null;
}

function parseColorToRgb(c: string | null | undefined) {
    if (!c) return null;
    const s = c.trim();

    // #rgb / #rrggbb / #rrggbbaa
    const hex = s.startsWith("#") ? s.slice(1) : s;
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        return { r, g, b };
    }
    if (/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return { r, g, b };
    }

    // rgb()/rgba()
    const m = s.match(/rgba?\s*\(\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)/i);
    if (m) {
        const r = Number(m[1]), g = Number(m[2]), b = Number(m[3]);
        if ([r, g, b].every((v) => Number.isFinite(v) && v >= 0 && v <= 255)) return { r, g, b };
    }

    return null;
}

function rgbToHex(rgb: { r: number; g: number; b: number }) {
    const to2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
    return `#${to2(rgb.r)}${to2(rgb.g)}${to2(rgb.b)}`;
}

function pickUnitId(u: UnitLike): string {
    return String(u?.id ?? u?.unitId ?? u?.uuid ?? u?.uid ?? "");
}

function pickUnitLabel(u: UnitLike, fallbackId?: string): string {
    return (
        u?.name ??
        u?.title ??
        u?.displayName ??
        u?.callsign ??
        u?.shortName ??
        fallbackId ??
        "Unnamed unit"
    );
}

// Best-effort: you will likely tighten these once you confirm your Unit schema
function pickUnitColor(u: UnitLike): string | null {
    const c =
        u?.color ??
        u?.iconColor ??
        u?.style?.color ??
        u?.style?.iconColor ??
        u?.style?.stroke ??
        u?.symbolOptions?.color ??
        u?.symbolOptions?.fillColor ??
        u?.meta?.color ??
        u?.appearance?.color ??
        null;

    return typeof c === "string" && c.trim() ? c.trim() : null;
}

function pickUnitSidc(u: UnitLike): string | null {
    const s =
        u?.sidc ??
        u?.SIDC ??
        u?.symbolSidc ??
        u?.symbol?.sidc ??
        u?.symbol?.SIDC ??
        null;

    return typeof s === "string" && s.trim() ? s.trim() : null;
}

function pickUnitSymbolSvg(u: UnitLike): string | null {
    const s =
        u?.symbolSvg ??
        u?.svg ??
        u?.iconSvg ??
        u?.symbol?.svg ??
        u?.symbol?.svgString ??
        u?.icon?.svg ??
        null;

    if (typeof s === "string" && s.trim().startsWith("<svg")) return s.trim();
    return null;
}

function pickUnitSymbolUrl(u: UnitLike): string | null {
    const s =
        u?.symbolUrl ??
        u?.iconUrl ??
        u?.symbol?.url ??
        u?.icon?.url ??
        u?.symbol?.src ??
        u?.icon?.src ??
        null;

    return typeof s === "string" && s.trim() ? s.trim() : null;
}

// Locate scenario sides in a robust way
function getSidesFromState(state: any): any[] {
    const s = state ?? {};
    const scenario = s.scenario ?? s.activeScenario ?? s.data?.scenario ?? s;
    const sides = scenario?.sides ?? s.sides ?? scenario?.info?.sides ?? [];
    return Array.isArray(sides) ? sides : [];
}

export function useInvolvedUnits(eventId: EntityId) {
    const activeScenario = injectStrict(activeScenarioKey);
    const { time, store } = activeScenario as any;
    const helpers = (activeScenario as any)?.helpers;

    const scenarioEvent = computed(() => time.getEventById(eventId));

    // Build a canonical unit index from scenario sides using walkSide()
    const unitIndex = computed<Record<string, any>>(() => {
        const out: Record<string, any> = {};
        const sides = getSidesFromState(store?.state);
        for (const side of sides) {
            try {
                walkSide(side, (unit) => {
                    const id = pickUnitId(unit);
                    if (id) out[id] = unit;
                });
            } catch {
                // If a side is malformed, skip it rather than breaking the app.
            }
        }
        return out;
    });

    function getUnitByIdAny(id: string): any | null {
        if (!id) return null;

        // Prefer helper (often includes caching / normalization)
        if (helpers?.getUnitById) {
            try {
                const u = helpers.getUnitById(id);
                if (u) return u;
            } catch {
                // ignore
            }
        }

        // Then canonical index from scenarioStore walk
        const idx = unitIndex.value;
        if (idx && idx[id]) return idx[id];

        // Finally fall back to common maps if they exist
        const st: any = store?.state as any;
        return st?.unitMap?.[id] ?? st?.unitsMap?.[id] ?? st?.orbat?.unitMap?.[id] ?? null;
    }

    const involvedUnitIds = computed<string[]>({
        get: () => {
            const raw = (scenarioEvent.value as any)?.involvedUnitIds;
            return Array.isArray(raw) ? raw.map((x: any) => String(x)) : [];
        },
        set: (ids) => {
            (activeScenario as any).time.updateScenarioEvent(eventId, { involvedUnitIds: ids } as any);
        },
    });

    const selectedUnits = computed(() => {
        const ids = involvedUnitIds.value;
        if (!ids.length) return [];

        return ids.map((id) => {
            const u = getUnitByIdAny(id);
            const rgb = parseColorToRgb(pickUnitColor(u));
            return {
                id,
                unit: u,
                label: pickUnitLabel(u, id),
                sidc: pickUnitSidc(u),
                symbolSvg: pickUnitSymbolSvg(u),
                symbolUrl: pickUnitSymbolUrl(u),
                colorHex: rgb ? rgbToHex(rgb) : null,
            };
        });
    });

    const averageColor = computed<string | null>(() => {
        const rgbs = selectedUnits.value
            .map((u) => parseColorToRgb(u.colorHex))
            .filter(Boolean) as Array<{ r: number; g: number; b: number }>;

        if (!rgbs.length) return null;

        const r = rgbs.reduce((a, c) => a + c.r, 0) / rgbs.length;
        const g = rgbs.reduce((a, c) => a + c.g, 0) / rgbs.length;
        const b = rgbs.reduce((a, c) => a + c.b, 0) / rgbs.length;
        return rgbToHex({ r, g, b });
    });

    function setUnits(ids: string[]) {
        involvedUnitIds.value = Array.from(new Set(ids.map(String)));
    }

    function clear() {
        involvedUnitIds.value = [];
    }

    // Picker list should come from the same source of truth as selectedUnits.
    const allUnits = computed(() => {
        const idx = unitIndex.value;
        const units = Object.values(idx);

        return units
            .map((u: any) => {
                const id = pickUnitId(u);
                if (!id) return null;
                const rgb = parseColorToRgb(pickUnitColor(u));
                return {
                    id,
                    unit: u,
                    label: pickUnitLabel(u, id),
                    sidc: pickUnitSidc(u),
                    symbolSvg: pickUnitSymbolSvg(u),
                    symbolUrl: pickUnitSymbolUrl(u),
                    colorHex: rgb ? rgbToHex(rgb) : null,
                };
            })
            .filter(Boolean);
    });

    return {
        scenarioEvent,
        involvedUnitIds,
        selectedUnits,
        averageColor,
        setUnits,
        clear,
        allUnits,
    };
}
