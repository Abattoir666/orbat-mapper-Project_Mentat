<script setup lang="ts">
    import { computed, ref, watch, onBeforeUnmount } from "vue";
    import { injectStrict } from "@/utils";
    import { activeScenarioKey } from "@/components/injects";
    import MilitarySymbol from "@/components/MilitarySymbol.vue";
    import { useSelectedItems } from "@/stores/selectedStore";

    type UnitRow = {
        id: string;
        label: string;
        sidc: string | null;
        colorHex: string | null;
        unit: any;
        sideName?: string;
        groupName?: string;
    };

    const props = defineProps<{
        open: boolean;
        selectedIds: string[];
        // Optional prebuilt list. If missing/empty we will build lazily from scenario on open.
        allUnits?: UnitRow[];
    }>();

    const emit = defineEmits<{
        (e: "update:open", v: boolean): void;
        (e: "apply", ids: string[]): void;
        (e: "cancel"): void;
    }>();

    const activeScenario = injectStrict(activeScenarioKey);
    const { store, unitActions, helpers } = activeScenario as any;

    const selectedStore = useSelectedItems();

    const getCombinedSymbolOptions =
        unitActions?.getCombinedSymbolOptions as ((u: any) => any) | undefined;

    // Dialog state
    const searchRaw = ref("");
    const search = ref("");
    let searchTimer: number | null = null;

    const working = ref<string[]>([]);
    const showLimit = ref(800);

    // Lazily built list to avoid startup cost and reduce crash surface
    const builtUnits = ref<UnitRow[]>([]);
    const builtOk = ref(false);

    watch(
        () => props.open,
        (isOpen) => {
            if (isOpen) {
                working.value = Array.isArray(props.selectedIds) ? [...props.selectedIds] : [];
                searchRaw.value = "";
                search.value = "";
                showLimit.value = 800;
                document.body.style.overflow = "hidden";

                // Build units only when opened. If caller passed a list, we do not rebuild.
                const passed = Array.isArray(props.allUnits) ? props.allUnits : [];
                if (passed.length) {
                    builtUnits.value = passed;
                    builtOk.value = true;
                } else {
                    buildUnitsSafely();
                }
            } else {
                document.body.style.overflow = "";
            }
        },
        { immediate: true },
    );

    watch(
        searchRaw,
        (v) => {
            if (searchTimer !== null) window.clearTimeout(searchTimer);
            searchTimer = window.setTimeout(() => {
                search.value = String(v ?? "").trim().toLowerCase();
                showLimit.value = search.value ? 5000 : 800;
            }, 120);
        },
        { immediate: true },
    );

    onBeforeUnmount(() => {
        document.body.style.overflow = "";
        if (searchTimer !== null) window.clearTimeout(searchTimer);
    });

    function close() {
        emit("update:open", false);
        emit("cancel");
    }

    function apply() {
        emit("apply", working.value);
        emit("update:open", false);
    }

    function toggle(id: string) {
        const next = new Set(working.value);
        next.has(id) ? next.delete(id) : next.add(id);
        working.value = Array.from(next);
    }

    function addIds(ids: string[]) {
        const next = new Set(working.value);
        for (const id of ids) next.add(String(id));
        working.value = Array.from(next);
    }

    function replaceIds(ids: string[]) {
        working.value = Array.from(new Set(ids.map((x) => String(x))));
    }

    function onKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") close();
    }

    // Selection store is not consistent across forks; do best-effort without crashing.
    const orbatSelectedUnitIds = computed<string[]>(() => {
        const s: any = selectedStore as any;

        // Common shapes:
        // - selectedUnitIds: string[]
        // - selectedIds: string[]
        // - selected: { units: string[] }
        // - selectedItems: ... (unknown)
        const candidates: any[] = [
            s?.selectedUnitIds,
            s?.selectedIds,
            s?.selected?.unitIds,
            s?.selected?.units,
            s?.unitsSelected,
        ];

        for (const c of candidates) {
            if (Array.isArray(c)) return c.map((x) => String(x)).filter(Boolean);
        }
        return [];
    });

    function pickUnitId(u: any): string {
        return String(u?.id ?? u?.unitId ?? u?.uuid ?? u?.uid ?? "");
    }

    function pickUnitLabel(u: any, fallbackId?: string): string {
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

    function pickUnitColor(u: any): string | null {
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

    function sidcForUnit(unit: any, fallback?: string | null): string | null {
        return (unit?.sidc ?? unit?.SIDC ?? unit?.symbolSidc ?? fallback ?? null) as string | null;
    }

    function symbolOptionsForUnit(unit: any, colorHex?: string | null) {
        const base = getCombinedSymbolOptions ? getCombinedSymbolOptions(unit) : {};
        if (!colorHex) return base;

        const DARK = "#111827"; // near-black (slate-900)

        return {
            ...base,

            // Keep frame/lines dark so echelon ticks are visible
            frameColor: base.frameColor ?? DARK,
            strokeColor: base.strokeColor ?? base.frameColor ?? DARK,
            outlineColor: (base as any).outlineColor ?? DARK,
            infoColor: (base as any).infoColor ?? DARK,
            textColor: (base as any).textColor ?? DARK,
            echelonColor: (base as any).echelonColor ?? DARK,

            // Tint interior/icon to unit color
            fillColor: colorHex,
            iconColor: colorHex,

            outlineWidth: Math.max(Number((base as any).outlineWidth ?? 2) || 2, 2),
        };
    }

    // Very defensive side traversal. Prefer your app's walkSide if it exists, but do not assume callback arity.
    function getSidesFromState(state: any): any[] {
        const s = state ?? {};
        const scenario = s?.scenario ?? s?.data?.scenario ?? s;
        const sides = scenario?.sides ?? s?.sides ?? scenario?.info?.sides ?? [];
        return Array.isArray(sides) ? sides : [];
    }

    function buildUnitsSafely() {
        try {
            const rows = buildUnitsFromScenario();
            builtUnits.value = rows;
            builtOk.value = true;
        } catch (e) {
            // Do not crash the app; just show an empty list.
            builtUnits.value = [];
            builtOk.value = false;
        }
    }

    function buildUnitsFromScenario(): UnitRow[] {
        const out: UnitRow[] = [];
        const seen = new Set<string>();

        // 1) Prefer unitActions.walkSide if present (likely keeps same ORBAT ordering)
        const sides = getSidesFromState(store?.state);

        if (typeof unitActions?.walkSide === "function") {
            for (const side of sides) {
                try {
                    unitActions.walkSide(side, (unit: any, level?: any, parent?: any, group?: any, sideObj?: any) => {
                        const id = pickUnitId(unit);
                        if (!id || seen.has(id)) return;
                        seen.add(id);

                        out.push({
                            id,
                            unit,
                            label: pickUnitLabel(unit, id),
                            sidc: sidcForUnit(unit, null),
                            colorHex: pickUnitColor(unit),
                            sideName: sideObj?.name ?? side?.name ?? undefined,
                            groupName: group?.name ?? undefined,
                        });
                    });
                } catch {
                    // fall through to manual traversal per side
                    manualWalkSide(side, out, seen);
                }
            }
            if (out.length) return out;
        }

        // 2) Manual traversal fallback
        for (const side of sides) {
            manualWalkSide(side, out, seen);
        }
        if (out.length) return out;

        // 3) Last resort: map-like stores
        const st: any = store?.state as any;
        const map = st?.unitMap ?? st?.unitsMap ?? st?.orbat?.unitMap ?? null;
        if (map && typeof map === "object") {
            for (const u of Object.values(map)) {
                const id = pickUnitId(u);
                if (!id || seen.has(id)) continue;
                seen.add(id);
                out.push({
                    id,
                    unit: u,
                    label: pickUnitLabel(u, id),
                    sidc: sidcForUnit(u, null),
                    colorHex: pickUnitColor(u),
                });
            }
        }

        return out;
    }

    function manualWalkSide(side: any, out: UnitRow[], seen: Set<string>) {
        const sideName = side?.name ?? undefined;

        // Common shapes: side.groups -> group.subUnits, or side.subUnits directly
        const groups = Array.isArray(side?.groups) ? side.groups : [];
        for (const g of groups) {
            const groupName = g?.name ?? undefined;
            const roots = Array.isArray(g?.subUnits) ? g.subUnits : Array.isArray(g?.units) ? g.units : [];
            for (const u of roots) manualWalkUnit(u, out, seen, sideName, groupName);
        }

        const roots2 = Array.isArray(side?.subUnits) ? side.subUnits : Array.isArray(side?.units) ? side.units : [];
        for (const u of roots2) manualWalkUnit(u, out, seen, sideName, undefined);
    }

    function manualWalkUnit(unit: any, out: UnitRow[], seen: Set<string>, sideName?: string, groupName?: string) {
        if (!unit) return;

        const id = pickUnitId(unit);
        if (id && !seen.has(id)) {
            seen.add(id);
            out.push({
                id,
                unit,
                label: pickUnitLabel(unit, id),
                sidc: sidcForUnit(unit, null),
                colorHex: pickUnitColor(unit),
                sideName,
                groupName,
            });
        }

        const kids = Array.isArray(unit?.subUnits) ? unit.subUnits : Array.isArray(unit?.units) ? unit.units : [];
        for (const k of kids) manualWalkUnit(k, out, seen, sideName, groupName);
    }

    const sourceUnits = computed<UnitRow[]>(() => {
        const passed = Array.isArray(props.allUnits) ? props.allUnits : [];
        if (passed.length) return passed;
        return builtUnits.value;
    });

    const filtered = computed<UnitRow[]>(() => {
        const q = search.value;
        const list = sourceUnits.value;
        if (!list.length) return [];

        if (!q) return list.slice(0, showLimit.value);

        const hits: UnitRow[] = [];
        for (const u of list) {
            const label = (u.label ?? "").toLowerCase();
            const id = (u.id ?? "").toLowerCase();
            const sidc = (u.sidc ?? "").toLowerCase();
            const sideName = (u.sideName ?? "").toLowerCase();
            const groupName = (u.groupName ?? "").toLowerCase();

            if (
                label.includes(q) ||
                id.includes(q) ||
                sidc.includes(q) ||
                sideName.includes(q) ||
                groupName.includes(q)
            ) {
                hits.push(u);
                if (hits.length >= showLimit.value) break;
            }
        }
        return hits;
    });

    const totalCount = computed(() => sourceUnits.value.length);

    function showMore() {
        showLimit.value = Math.min(showLimit.value + 800, 10000);
    }
</script>

<template>
    <Teleport to="body">
        <div v-if="open" class="fixed inset-0 z-[5000]" @keydown="onKeydown">
            <div class="absolute inset-0 bg-black/40" @click="close"></div>

            <!-- Smaller drawer -->
            <div class="absolute inset-y-0 right-0 w-full max-w-xs bg-background shadow-xl flex flex-col">
                <div class="border-b p-3">
                    <div class="flex items-start justify-between gap-2">
                        <div>
                            <div class="text-base font-semibold">Select involved units</div>
                            <div class="text-xs text-muted-foreground mt-1">
                                {{ working.length }} selected
                                <span v-if="totalCount"> - {{ totalCount }} available</span>
                            </div>
                            <div v-if="!builtOk && !(allUnits && allUnits.length)" class="text-[11px] text-muted-foreground mt-1">
                                Could not build ORBAT list from scenario store.
                            </div>
                        </div>

                        <button type="button" class="rounded border px-2 py-1 text-xs" @click="close">
                            Close
                        </button>
                    </div>

                    <input v-model="searchRaw"
                           class="mt-2 w-full rounded border px-2 py-1 text-xs"
                           placeholder="Search ORBAT..."
                           spellcheck="false" />

                    <div class="mt-2 flex items-center gap-2">
                        <button type="button"
                                class="rounded border px-2 py-1 text-xs"
                                :disabled="!orbatSelectedUnitIds.length"
                                @click="addIds(orbatSelectedUnitIds)"
                                title="Add units currently selected in the ORBAT sidebar">
                            Add ORBAT selected
                        </button>

                        <button type="button"
                                class="rounded border px-2 py-1 text-xs"
                                :disabled="!orbatSelectedUnitIds.length"
                                @click="replaceIds(orbatSelectedUnitIds)"
                                title="Replace with ORBAT sidebar selection">
                            Replace
                        </button>
                    </div>
                </div>

                <div class="flex-1 overflow-auto divide-y">
                    <label v-for="u in filtered"
                           :key="u.id"
                           class="flex items-center gap-2 p-2 text-sm cursor-pointer hover:bg-muted/40">
                        <input type="checkbox"
                               class="h-4 w-4"
                               :checked="working.includes(u.id)"
                               @change="toggle(u.id)" />

                        <!-- Larger box, no overflow clipping -->
                        <div class="h-7 w-7 rounded border flex items-center justify-center">
                            <MilitarySymbol v-if="u.unit && sidcForUnit(u.unit, u.sidc)"
                                            :sidc="sidcForUnit(u.unit, u.sidc)!"
                                            :size="26"
                                            :options="symbolOptionsForUnit(u.unit, u.colorHex)" />
                            <span v-else class="text-[9px] text-muted-foreground">SYM</span>
                        </div>

                        <div class="min-w-0 flex-1">
                            <div class="truncate">{{ u.label }}</div>
                            <div class="truncate text-[11px] text-muted-foreground">
                                {{ u.id }}
                                <span v-if="u.sideName"> - {{ u.sideName }}</span>
                                <span v-if="u.groupName"> - {{ u.groupName }}</span>
                            </div>
                        </div>
                    </label>

                    <div v-if="filtered.length >= showLimit && totalCount > showLimit" class="p-2">
                        <button type="button" class="w-full rounded border px-2 py-1 text-xs" @click="showMore">
                            Show more
                        </button>
                    </div>

                    <div v-if="!filtered.length" class="p-3 text-xs text-muted-foreground">
                        No matches.
                    </div>
                </div>

                <div class="border-t p-3 flex items-center justify-end gap-2">
                    <button type="button" class="rounded border px-2 py-1 text-xs" @click="close">Cancel</button>
                    <button type="button" class="rounded border px-2 py-1 text-xs" @click="apply">Apply</button>
                </div>
            </div>
        </div>
    </Teleport>
</template>
