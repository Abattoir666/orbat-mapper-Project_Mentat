<script setup lang="ts">
    import { computed, onMounted, ref, shallowRef, watch } from "vue";
    import type { EntityId } from "@/types/base";
    import type { DoctrinalUnitIndexRow } from "@/modules/scenarioeditor/doctrinalToe/targetPicker/doctrinalTargetTypes";
    import type { UnitPersonnel } from "@/types/scenarioModels";
    import { symbolGenerator } from "@/symbology/milsymbwrapper";

    const props = defineProps<{
        title: string;
        initialRows: UnitPersonnel[];
        isLocked: boolean;

        // Flat unit index for selection and icon rendering
        unitIndex: DoctrinalUnitIndexRow[];

        // Initial target unit ids
        initialTargetIds: EntityId[];

        // Optional subtree ids (future scoping)
        contextSubtreeIds?: EntityId[];
    }>();

    const emit = defineEmits<{
        (e: "apply", rows: UnitPersonnel[], targetUnitIds: EntityId[]): void;
        (e: "save", rows: UnitPersonnel[], targetUnitIds: EntityId[]): void;
        (e: "close"): void;
    }>();

    type Row = { id: string; name: string; count: number; description: string };

    function makeId(): string {
        return "dtoe_" + Date.now() + "_" + Math.random().toString(16).slice(2);
    }
    function normStr(v: unknown): string {
        return typeof v === "string" ? v.trim() : "";
    }
    function normNum(v: unknown): number {
        const n = Number(String(v ?? "").trim());
        return Number.isFinite(n) ? n : 0;
    }
    function normalizeRow(raw: any): Row {
        const r = raw && typeof raw === "object" ? raw : {};
        return {
            id: normStr(r.id) || makeId(),
            name: normStr(r.name),
            count: normNum(r.count),
            description: normStr(r.description),
        };
    }

    function toUnitPersonnel(r: Row): UnitPersonnel {
        // Persist rank in `name` and role in `description` for compatibility.
        return {
            name: normStr(r.name),
            count: normNum(r.count),
            description: normStr(r.description) || undefined,
            onHand: undefined,
        } as any;
    }

    const rows = ref<Row[]>(
        (props.initialRows ?? []).map((p) =>
            normalizeRow({
                id: makeId(),
                name: (p as any).name,
                count: (p as any).count,
                description: (p as any).description,
            }),
        ),
    );

    const isLocked = computed(() => !!props.isLocked);

    // --- Target selection (inline, same popout) ---
    const targetIds = ref<EntityId[]>(
        Array.isArray(props.initialTargetIds) ? [...props.initialTargetIds] : [],
    );
    const targetSet = computed(() => new Set(targetIds.value));
    const targetCount = computed(() => targetIds.value.length);

    const unitQ = ref("");
    const units = computed(() => props.unitIndex ?? []);

    const filteredUnits = computed(() => {
        const q = unitQ.value.trim().toLowerCase();
        if (!q) return units.value;

        return units.value.filter((u) => {
            const name = (u.name ?? "").toLowerCase();
            const shortName = (u.shortName ?? "").toLowerCase();
            const unitNumber = (u.unitNumber ?? "").toLowerCase();
            return name.includes(q) || shortName.includes(q) || unitNumber.includes(q);
        });
    });

    function clearTargets() {
        if (isLocked.value) return;
        targetIds.value = [];
    }

    function selectFiltered() {
        if (isLocked.value) return;
        targetIds.value = filteredUnits.value.map((u) => u.id);
    }

    // Shift-select support (range within current filtered list)
    const lastClickedFilteredIndex = ref<number | null>(null);

    watch(unitQ, () => {
        // When the filter changes, reset the anchor index so shift-selection behaves predictably.
        lastClickedFilteredIndex.value = null;
    });

    function toggleTargetByFilteredIndex(filteredIndex: number, shiftKey: boolean) {
        if (isLocked.value) return;

        const list = filteredUnits.value;
        const u = list[filteredIndex];
        if (!u) return;

        const currentlySelected = targetSet.value.has(u.id);
        const nextSelected = !currentlySelected;

        const next = new Set(targetIds.value);

        if (shiftKey && lastClickedFilteredIndex.value !== null) {
            const a = Math.min(lastClickedFilteredIndex.value, filteredIndex);
            const b = Math.max(lastClickedFilteredIndex.value, filteredIndex);

            for (let i = a; i <= b; i++) {
                const id = list[i]?.id;
                if (!id) continue;
                if (nextSelected) next.add(id);
                else next.delete(id);
            }
        } else {
            if (nextSelected) next.add(u.id);
            else next.delete(u.id);
        }

        targetIds.value = Array.from(next);
        lastClickedFilteredIndex.value = filteredIndex;
    }

    function onUnitRowClick(filteredIndex: number, e: MouseEvent) {
        // Clicking row toggles selection; supports shift range selection.
        toggleTargetByFilteredIndex(filteredIndex, !!e.shiftKey);
    }

    // --- Lightweight virtual list for thousands of units ---
    const listRowH = 68; // fixed height for 2-row layout (icon row + name row)
    const listViewportH = ref(520);
    const listScrollTop = ref(0);

    function onListScroll(e: Event) {
        const el = e.target as HTMLElement;
        listScrollTop.value = el.scrollTop;
    }

    const listStart = computed(() => Math.max(0, Math.floor(listScrollTop.value / listRowH) - 10));
    const listEnd = computed(() =>
        Math.min(filteredUnits.value.length, listStart.value + Math.ceil(listViewportH.value / listRowH) + 20),
    );
    const listSlice = computed(() => filteredUnits.value.slice(listStart.value, listEnd.value));
    const listPadTop = computed(() => listStart.value * listRowH);
    const listPadBottom = computed(() => Math.max(0, (filteredUnits.value.length - listEnd.value) * listRowH));

    onMounted(() => {
        listViewportH.value = Math.max(320, Math.min(720, window.innerHeight - 240));
    });

    // --- Icon rendering (white square behind icon only) ---
    const _svgCache = shallowRef(new Map<string, string>());

    function deriveFillColor(u: DoctrinalUnitIndexRow): string | undefined {
        const so: any = (u as any).symbolOptions ?? {};
        // Common override patterns used across Orbat/Map symbols
        return (
            so.fillColor ||
            so.color ||
            (u as any).fillColor ||
            (u as any).hexFill ||
            (u as any).hexColor ||
            (u as any).color
        );
    }

    function symbolSvg(u: DoctrinalUnitIndexRow): string {
        const sidc = (u as any).sidc as string | undefined;
        if (!sidc) return "";

        const so: any = (u as any).symbolOptions ?? {};
        const fill = deriveFillColor(u);

        const key = `${u.id}|${sidc}|${so.fillColor ?? ""}|${so.frameColor ?? ""}|${so.iconColor ?? ""}|${so.color ?? ""}|${fill ?? ""}`;
        const hit = _svgCache.value.get(key);
        if (hit) return hit;

        const opts: any = { size: 34 };

        if (so.fillColor) opts.fillColor = so.fillColor;
        if (so.frameColor) opts.frameColor = so.frameColor;
        if (so.iconColor) opts.iconColor = so.iconColor;

        if (!opts.fillColor && so.color) opts.fillColor = so.color;
        if (!opts.fillColor && fill) opts.fillColor = fill;

        const svg = symbolGenerator(sidc, opts).asSVG();
        _svgCache.value.set(key, svg);
        return svg;
    }

    // --- Grid editing helpers ---
    const focused = ref<{ row: number; col: number } | null>(null);

    function setFocus(row: number, col: number) {
        focused.value = { row, col };
    }

    function ensureRows(minRows: number) {
        while (rows.value.length < minRows) rows.value.push({ id: makeId(), name: "", count: 0, description: "" });
    }

    function setCellValue(rIdx: number, cIdx: number, value: string) {
        ensureRows(rIdx + 1);
        const r = rows.value[rIdx];
        if (!r) return;

        if (cIdx === 0) r.name = value;
        else if (cIdx === 1) r.count = normNum(value);
        else if (cIdx === 2) r.description = value;
    }

    function applyTSV(tsv: string, startRow: number, startCol: number) {
        const lines = tsv.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
        for (let r = 0; r < lines.length; r++) {
            const cols = lines[r].split("\t");
            for (let c = 0; c < cols.length; c++) {
                setCellValue(startRow + r, startCol + c, cols[c] ?? "");
            }
        }
    }

    function rowToTSV(r: Row): string {
        return [r.name ?? "", String(r.count ?? 0), r.description ?? ""].join("\t");
    }
    function allToTSV(): string {
        return rows.value.map(rowToTSV).join("\n");
    }

    function onGridCopy(e: ClipboardEvent) {
        if (!e.clipboardData) return;
        e.clipboardData.setData("text/plain", allToTSV());
        e.preventDefault();
    }

    function onGridPaste(e: ClipboardEvent) {
        if (isLocked.value) return;
        const text = e.clipboardData?.getData("text/plain");
        if (!text) return;

        const startRow = focused.value?.row ?? 0;
        const startCol = focused.value?.col ?? 0;
        applyTSV(text, startRow, startCol);
        e.preventDefault();
    }

    function onCellPaste(e: ClipboardEvent, rIdx: number, cIdx: number) {
        if (isLocked.value) return;
        const text = e.clipboardData?.getData("text/plain");
        if (!text) return;

        applyTSV(text, rIdx, cIdx);
        e.preventDefault();
    }

    // --- Rank dropdown (O/E/S-1..10) ---
    const rankTypes = ["O", "E", "S"] as const;
    const rankNumbers = Array.from({ length: 10 }, (_, i) => i + 1);
    const rankOptions = computed(() => rankTypes.flatMap((t) => rankNumbers.map((n) => `${t}-${n}`)));

    function addRow() {
        rows.value.push({ id: makeId(), name: "", count: 0, description: "" });
    }
    function removeRow(id: string) {
        if (isLocked.value) return;
        rows.value = rows.value.filter((r) => r.id !== id);
    }

    const canCommit = computed(() => !props.isLocked && targetIds.value.length > 0);

    function apply() {
        if (!canCommit.value) return;
        emit("apply", rows.value.map(toUnitPersonnel), targetIds.value);
    }
    function save() {
        if (!canCommit.value) return;
        emit("save", rows.value.map(toUnitPersonnel), targetIds.value);
    }
    function close() {
        emit("close");
    }
</script>

<template>
    <div class="h-full bg-slate-950 text-slate-100">
        <div class="h-full p-4">
            <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                    <h2 class="text-base font-semibold">{{ title }}</h2>
                    <p class="mt-0.5 text-xs text-slate-400">
                        Copy/paste is TSV-compatible with Excel. Rows represent authorized baseline personnel.
                    </p>
                </div>

                <div class="flex items-center gap-2">
                    <button type="button"
                            class="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                            :disabled="isLocked"
                            @click="addRow">
                        Add row
                    </button>

                    <button type="button"
                            class="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                            :disabled="!canCommit"
                            @click="apply">
                        Apply
                    </button>

                    <button type="button"
                            class="rounded-md bg-slate-100 px-3 py-1.5 text-sm text-slate-900 disabled:opacity-50"
                            :disabled="!canCommit"
                            @click="save">
                        Save
                    </button>

                    <button type="button"
                            class="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
                            @click="close">
                        Close
                    </button>
                </div>
            </div>

            <div class="grid h-[calc(100%-56px)] grid-cols-1 gap-3 lg:grid-cols-[380px_1fr]">
                <!-- Left: target selection (inline) -->
                <div class="flex min-h-0 flex-col overflow-hidden rounded-md border border-slate-800 bg-slate-950/40">
                    <div class="border-b border-slate-800 p-3">
                        <div class="flex items-center justify-between">
                            <div class="text-sm font-semibold">Targets</div>
                            <div class="text-xs text-slate-400">Selected: {{ targetCount }}</div>
                        </div>

                        <div class="mt-2 flex items-center gap-2">
                            <input v-model="unitQ"
                                   type="text"
                                   class="h-9 w-full rounded-md border border-slate-800 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-slate-600"
                                   placeholder="Search units..." />
                        </div>

                        <div class="mt-2 flex items-center gap-2">
                            <button type="button"
                                    class="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                                    :disabled="isLocked"
                                    @click="clearTargets">
                                Clear
                            </button>

                            <button type="button"
                                    class="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                                    :disabled="isLocked"
                                    @click="selectFiltered">
                                Select filtered ({{ filteredUnits.length }})
                            </button>
                        </div>

                        <div class="mt-2 text-[11px] text-slate-500">
                            Tip: click rows to toggle. Shift-click to select/deselect a range within the filtered list.
                        </div>
                    </div>

                    <div class="min-h-0 flex-1 overflow-hidden">
                        <div class="h-full overflow-y-auto"
                             :style="{ height: listViewportH + 'px' }"
                             @scroll="onListScroll">
                            <div :style="{ height: listPadTop + 'px' }"></div>

                            <div v-for="(u, i) in listSlice"
                                 :key="u.id"
                                 class="cursor-pointer border-b border-slate-900/60 px-3 hover:bg-slate-900/40"
                                 :class="targetSet.has(u.id) ? 'bg-slate-900/30' : ''"
                                 :style="{ height: listRowH + 'px' }"
                                 @click="onUnitRowClick(listStart + i, $event)">
                                <div class="flex h-full items-center gap-3">
                                    <!-- Checkbox (centered) -->
                                    <div class="flex h-full w-6 items-center justify-center">
                                        <input type="checkbox"
                                               class="h-4 w-4 accent-slate-300"
                                               :checked="targetSet.has(u.id)"
                                               :disabled="isLocked"
                                               @click.stop
                                               @change="toggleTargetByFilteredIndex(listStart + i, false)" />
                                    </div>

                                    <!-- Icon tile -->
                                    <div class="dtoe-icon-tile h-11 w-11 shrink-0 rounded border border-slate-700 bg-white p-0.5">
                                        <div class="dtoe-icon-inner h-full w-full" v-html="symbolSvg(u)"></div>
                                    </div>

                                    <!-- Text (to the right of icon) -->
                                    <div class="min-w-0 flex-1">
                                        <div class="truncate text-sm text-slate-100">
                                            {{ u.name }}
                                        </div>
                                        <div class="truncate text-[11px] text-slate-400">
                                            <span v-if="u.shortName">{{ u.shortName }}</span>
                                            <span v-if="u.shortName && u.unitNumber"> - </span>
                                            <span v-if="u.unitNumber">{{ u.unitNumber }}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>


                            <div :style="{ height: listPadBottom + 'px' }"></div>
                        </div>
                    </div>
                </div>

                <!-- Right: baseline table -->
                <div class="min-h-0 overflow-hidden rounded-md border border-slate-800 bg-slate-950/40"
                     tabindex="0"
                     @copy="onGridCopy"
                     @paste="onGridPaste">
                    <div class="border-b border-slate-800 p-3 text-xs text-slate-400">
                        Rank is stored in <span class="font-mono">name</span>. Role is stored in <span class="font-mono">description</span>.
                    </div>

                    <div class="min-h-0 overflow-x-auto">
                        <table class="min-w-full border-collapse text-sm">
                            <thead>
                                <tr class="bg-slate-900/70 text-left text-xs text-slate-300">
                                    <th class="border-b border-slate-800 px-2 py-2">Rank</th>
                                    <th class="border-b border-slate-800 px-2 py-2">Authorized</th>
                                    <th class="border-b border-slate-800 px-2 py-2">Role</th>
                                    <th class="border-b border-slate-800 px-2 py-2 text-right">&nbsp;</th>
                                </tr>
                            </thead>

                            <tbody>
                                <tr v-for="(r, rIdx) in rows"
                                    :key="r.id"
                                    class="odd:bg-slate-950/40 even:bg-slate-900/40">
                                    <td class="border-t border-slate-800 px-1 py-1">
                                        <select v-model="r.name"
                                                class="h-9 w-full rounded-md border border-slate-800 bg-slate-900 px-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-slate-600 disabled:opacity-60"
                                                :disabled="isLocked"
                                                @focus="setFocus(rIdx, 0)">
                                            <option value=""></option>
                                            <optgroup label="O (Officer)">
                                                <option v-for="opt in rankOptions.filter((o) => o.startsWith('O-'))" :key="opt" :value="opt">
                                                    {{ opt }}
                                                </option>
                                            </optgroup>
                                            <optgroup label="E (Enlisted)">
                                                <option v-for="opt in rankOptions.filter((o) => o.startsWith('E-'))" :key="opt" :value="opt">
                                                    {{ opt }}
                                                </option>
                                            </optgroup>
                                            <optgroup label="S (Specialist)">
                                                <option v-for="opt in rankOptions.filter((o) => o.startsWith('S-'))" :key="opt" :value="opt">
                                                    {{ opt }}
                                                </option>
                                            </optgroup>
                                        </select>
                                    </td>

                                    <td class="border-t border-slate-800 px-1 py-1">
                                        <input v-model.number="r.count"
                                               type="number"
                                               class="h-9 w-full rounded-md border border-slate-800 bg-slate-900 px-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-slate-600 disabled:opacity-60"
                                               :disabled="isLocked"
                                               @focus="setFocus(rIdx, 1)"
                                               @paste="onCellPaste($event as any, rIdx, 1)" />
                                    </td>

                                    <td class="border-t border-slate-800 px-1 py-1">
                                        <input v-model="r.description"
                                               type="text"
                                               class="h-9 w-full rounded-md border border-slate-800 bg-slate-900 px-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-slate-600 disabled:opacity-60"
                                               :disabled="isLocked"
                                               @focus="setFocus(rIdx, 2)"
                                               @paste="onCellPaste($event as any, rIdx, 2)" />
                                    </td>

                                    <td class="border-t border-slate-800 px-2 py-1 text-right">
                                        <button type="button"
                                                class="h-9 rounded-md px-2 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                                                :disabled="isLocked"
                                                @click="removeRow(r.id)"
                                                title="Remove row">
                                            Remove
                                        </button>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div class="mt-2 text-xs text-slate-500">
                Tip: You can paste a TSV block directly into any cell (Excel-style).
            </div>
        </div>
    </div>
</template>

<style scoped>
    /* Force injected milsymbol SVGs to fit the tile exactly */
    .dtoe-icon-inner :deep(svg) {
        width: 100%;
        height: 100%;
        display: block;
    }

    /* Prevent any overflow from the injected SVG */
    .dtoe-icon-tile {
        overflow: hidden;
    }
</style>
