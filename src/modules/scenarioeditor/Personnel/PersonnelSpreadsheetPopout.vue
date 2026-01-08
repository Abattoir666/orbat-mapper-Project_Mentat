<script setup lang="ts">
    import { computed, nextTick, ref } from "vue";
    import {
        FLAG_LABEL,
        FLAG_OPTIONS,
        type PersonnelFlag,
        type PersonnelFlags,
        type PersonnelFlagsSegment,
        type PersonnelRow,
        normalizeFlags,
        normalizePersonnelRow,
        normStr,
        setFlagsAtDate,
        flagsAtTimeMs,
        statusFromFlags,
        sortRowsByGradeDescInPlace,
    } from "./personnelTypes";

    import { gradesByType, parseGradeKey } from "@/modules/scenarioeditor/Leaders/rankGrades";

    const props = defineProps<{
        title: string;
        initialRows: PersonnelRow[];
        isLocked: boolean;
        /** If false, hides the in-component Close button (useful when an outer panel already provides one). */
        showCloseButton?: boolean;
        /**
         * Current scenario time. In your app this may be a number (ms) OR a Dayjs-like object.
         * We normalize it to a finite ms timestamp.
         */
        scenarioTimeMs: number | { valueOf: () => number };
    }>();

    const emit = defineEmits<{
        (e: "apply", rows: PersonnelRow[]): void;
        (e: "save", rows: PersonnelRow[]): void;
        (e: "close"): void;
    }>();

    function makeId(): string {
        return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
    }

    function toMs(v: unknown): number {
        if (typeof v === "number" && Number.isFinite(v)) return v;
        if (v && typeof (v as any).valueOf === "function") {
            const n = (v as any).valueOf();
            if (typeof n === "number" && Number.isFinite(n)) return n;
        }
        return Date.now();
    }

    const scenarioMs = computed(() => toMs(props.scenarioTimeMs));

    const scenarioDate = computed(() => {
        const d = new Date(scenarioMs.value);
        // UTC YYYY-MM-DD (stable key for segment boundaries)
        return d.toISOString().slice(0, 10);
    });

    const rows = ref<PersonnelRow[]>(
        (props.initialRows ?? []).map((r) => {
            const n = normalizePersonnelRow(r);
            if (!n.id) n.id = makeId();
            return n;
        }),
    );

    // Default to rank/grade-desc ordering (stable within the same grade).
    sortRowsByGradeDescInPlace(rows.value);

    const isLocked = computed(() => !!props.isLocked);



    const showCloseButton = computed(() => props.showCloseButton !== false);

    // --- rank-range selection (shift-click) ---
    // --- flag-range selection (shift-click) ---
    // Shift-clicking a flag checkbox applies the same checked state to a contiguous range
    // (per-flag column), skipping rows that are terminally excepted (KIA) or otherwise locked.
    const flagSelAnchor = ref<Record<PersonnelFlag, number | null>>({
        InRolls: null,
        WIA: null,
        KIA: null,
        POW: null,
        MIA: null,
    });

    function flagToCol(flag: PersonnelFlag): ColIdx {
        const idx = FLAG_OPTIONS.indexOf(flag);
        // FLAG_OPTIONS is ["InRolls","WIA","KIA","POW","MIA"] so idx 0..4
        return (2 + idx) as ColIdx;
    }

    function isFlagEditBlocked(row: PersonnelRow, flag: PersonnelFlag, nextChecked: boolean): boolean {
        if (isLocked.value) return true;
        // Mirrors the template's :disabled rules.
        if (flag === "KIA") {
            // If KIA started before the current scenario date, it is terminal and cannot be undone.
            if (!nextChecked && kiaLockedAtScenario(row)) return true;
            return false;
        }
        // Non-KIA flags are blocked if the row is terminal (KIA true at scenario time).
        if (isTerminalAtScenario(row)) return true;
        return false;
    }

    function onFlagCheckboxClick(e: MouseEvent, rowIdx: number, flag: PersonnelFlag) {
        if (isLocked.value) return;

        // Non-shift click: let the normal @change handler do the single toggle,
        // but record the anchor for future shift-click ranges.
        if (!e.shiftKey) {
            flagSelAnchor.value[flag] = rowIdx;
            return;
        }

        // Shift-click: we own the edit; prevent the browser from toggling only this one box.
        e.preventDefault();

        const current = !!flagsAtScenario(rows.value[rowIdx])[flag];
        const nextChecked = !current;

        const col = flagToCol(flag);

        const anchor = flagSelAnchor.value[flag];
        const start = Math.min(anchor, rowIdx);
        const end = Math.max(anchor, rowIdx);

        withSortSuppressed(() => {
            for (let i = start; i <= end; i++) {
                const r = rows.value[i];
                if (!r) continue;
                if (isFlagEditBlocked(r, flag, nextChecked)) continue;
                setCellValue(i, col, nextChecked ? "1" : "0");
            }
        });

        flagSelAnchor.value[flag] = rowIdx;
    }

    const rankSelAnchor = ref<number | null>(null);
    const rankSelRange = ref<{ start: number; end: number } | null>(null);

    function setRankSelectionFromMouse(e: MouseEvent, rowIdx: number) {
        // Do not block default focus/open behavior for inputs/selects.
        if (isLocked.value) return;

        if (e.shiftKey && rankSelAnchor.value !== null) {
            const a = rankSelAnchor.value;
            rankSelRange.value = { start: Math.min(a, rowIdx), end: Math.max(a, rowIdx) };
        } else {
            rankSelAnchor.value = rowIdx;
            rankSelRange.value = { start: rowIdx, end: rowIdx };
        }
    }

    function isRankRowSelected(rowIdx: number): boolean {
        const r = rankSelRange.value;
        return !!r && rowIdx >= r.start && rowIdx <= r.end;
    }

    function selectedRankRowIndices(): number[] {
        const r = rankSelRange.value;
        if (!r) return [];
        const out: number[] = [];
        for (let i = r.start; i <= r.end; i++) out.push(i);
        return out;
    }

    // --- defer sorting during bulk operations (e.g., multi-row paste) ---
    let _suppressSort = 0;
    let _sortPending = false;

    function requestResort() {
        if (_suppressSort > 0) {
            _sortPending = true;
            return;
        }
        sortRowsByGradeDescInPlace(rows.value);
        _sortPending = false;
    }

    function withSortSuppressed<T>(fn: () => T): T {
        _suppressSort++;
        try {
            return fn();
        } finally {
            _suppressSort--;
            if (_suppressSort <= 0) {
                _suppressSort = 0;
                if (_sortPending) requestResort();
            }
        }
    }
    // --- helpers ---
    function normalizeRow(raw: any): PersonnelRow {
        const r = normalizePersonnelRow(raw);
        if (!r.id) r.id = makeId();
        return r;
    }

    function flagsAtScenario(row: PersonnelRow): PersonnelFlags {
        return flagsAtTimeMs(row, scenarioMs.value);
    }

    function isTerminalAtScenario(row: PersonnelRow): boolean {
        return !!flagsAtScenario(row).KIA;
    }

    function firstKiaStart(row: PersonnelRow): string | null {
        const segs = Array.isArray(row.flagsHistory) ? row.flagsHistory : [];
        const sorted = [...segs].sort((a, b) => (a.start || "").localeCompare(b.start || ""));
        for (const s of sorted) {
            if (s?.flags?.KIA) return normStr(s.start);
        }
        return null;
    }

    /**
     * If KIA started BEFORE the current scenario date, we treat it as terminal and
     * do not allow toggling it off at a later time. User must edit the history segment.
     * If KIA started ON the scenario date, allow unchecking (undo).
     */
    function kiaLockedAtScenario(row: PersonnelRow): boolean {
        const ks = firstKiaStart(row);
        if (!ks) return false;
        return ks < scenarioDate.value;
    }

    // --- parsing / paste helpers ---
    function parseBoolCell(v: string): boolean {
        const s = (v || "").trim().toLowerCase();
        if (!s) return false;
        if (s === "1" || s === "true" || s === "t" || s === "yes" || s === "y" || s === "x") return true;
        if (s === "0" || s === "false" || s === "f" || s === "no" || s === "n") return false;
        return true;
    }

    function boolToCell(v: boolean): string {
        return v ? "1" : "0";
    }

    // --- spreadsheet model ---
    // New column layout:
    // Rank | Name | In-Rolls | WIA | KIA | POW | MIA
    type ColIdx = 0 | 1 | 2 | 3 | 4 | 5 | 6;

    const headers = ["Rank", "Name", "In-Rolls", "WIA", "KIA", "POW", "MIA"] as const;

    const focused = ref<{ row: number; col: ColIdx } | null>(null);

    function setFocus(row: number, col: ColIdx) {
        focused.value = { row, col };
    }

    function colToFlag(col: ColIdx): PersonnelFlag | null {
        // flags are cols 2..6 and map to FLAG_OPTIONS order
        const flagIdx = (col as number) - 2;
        if (flagIdx < 0 || flagIdx > 4) return null;
        return FLAG_OPTIONS[flagIdx] as PersonnelFlag;
    }

    /**
     * KIA behavior:
     * - When checking KIA: automatically clears all other flags (normalizeFlags does this)
     * - When unchecking KIA (allowed only if KIA started today): restore In-Rolls true by default
     */
    function setFlagSnapshotAtScenario(row: PersonnelRow, patch: Partial<PersonnelFlags>): PersonnelRow {
        return setFlagsAtDate(row, scenarioDate.value, patch);
    }

    function setCellValue(rowIdx: number, col: ColIdx, value: string) {
        const r = rows.value[rowIdx];
        if (!r) return;

        const v = normStr(value);

        // Rank / Name
        if (col === 0) {
            r.rank = v;
            syncGradeFromRank(r);
            // Auto-maintain O/W/E grade-desc ordering as the user edits rank.
            requestResort();
            return;
        }
        if (col === 1) {
            r.name = v;
            return;
        }

        // Flags
        const flag = colToFlag(col);
        if (!flag) return;

        const checked = parseBoolCell(v);

        // Enforce "terminal" KIA started earlier: do not allow edits after-the-fact.
        if (flag === "KIA" && !checked && kiaLockedAtScenario(r)) return;
        if (flag !== "KIA" && isTerminalAtScenario(r)) return;

        if (flag === "KIA") {
            if (checked) {
                // set KIA true (normalizeFlags will clear others)
                const updated = setFlagSnapshotAtScenario(r, { KIA: true });
                rows.value[rowIdx] = normalizeRow(updated);
            } else {
                // undo KIA: restore In-Rolls true by default (unless user later sets it off)
                const updated = setFlagSnapshotAtScenario(r, { KIA: false, InRolls: true });
                rows.value[rowIdx] = normalizeRow(updated);
            }
            return;
        }

        // non-KIA flags: simple toggle at scenario date
        const patch: any = {};
        patch[flag] = checked;
        const updated = setFlagSnapshotAtScenario(r, patch);
        rows.value[rowIdx] = normalizeRow(updated);
    }

    function allToTSV(): string {
        return rows.value
            .map((r) => {
                const f = flagsAtScenario(r);
                const cols = [
                    normStr(r.rank),
                    normStr(r.name),
                    boolToCell(!!f.InRolls),
                    boolToCell(!!f.WIA),
                    boolToCell(!!f.KIA),
                    boolToCell(!!f.POW),
                    boolToCell(!!f.MIA),
                ];
                return cols.join("\t");
            })
            .join("\n");
    }


    function ensureRowCount(minCount: number) {
        if (isLocked.value) return;
        while (rows.value.length < minCount) {
            rows.value.push({
                id: makeId(),
                status: "Ok",
                rank: "",
                name: "",
                intakeDate: "",
                outtakeDate: "",
                statusHistory: [],
                flagsHistory: [],
            });
        }
    }

    function applyTSV(startRow: number, startCol: ColIdx, tsv: string) {
        const text = tsv.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        let rawLines = text.split("\n").filter((l) => l.length > 0);

        // Heuristic: allow pasting with header row like "rank<TAB>name".
        if (startCol === 0 && rawLines.length >= 1) {
            const head = rawLines[0].split("\t").map((s) => (s || "").trim().toLowerCase());
            if (head.length >= 2 && head[0] === "rank" && head[1] === "name") {
                rawLines = rawLines.slice(1);
            }
        }

        if (!rawLines.length) return;

        // If the paste extends beyond current length, auto-grow the roster.
        ensureRowCount(startRow + rawLines.length);

        withSortSuppressed(() => {
            for (let rOff = 0; rOff < rawLines.length; rOff++) {
                const cells = rawLines[rOff].split("\t");
                for (let cOff = 0; cOff < cells.length; cOff++) {
                    const cIdx = (startCol + cOff) as number;
                    if (cIdx > 6) continue;
                    setCellValue(startRow + rOff, cIdx as ColIdx, normStr(cells[cOff]));
                }
            }
        });

        // Resort once at end (prevents row reordering mid-paste).
        requestResort();
    }

    function onGridCopy(e: ClipboardEvent) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") return;

        e.preventDefault();
        e.clipboardData?.setData("text/plain", allToTSV());
    }

    function onGridPaste(e: ClipboardEvent) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea") return;

        const text = e.clipboardData?.getData("text/plain") ?? "";
        if (!text) return;

        e.preventDefault();
        const start = focused.value ?? { row: 0, col: 0 as ColIdx };
        applyTSV(start.row, start.col, text);
    }

    function onCellPaste(e: ClipboardEvent, row: number, col: ColIdx) {
        const text = e.clipboardData?.getData("text/plain") ?? "";
        if (!text) return;
        e.preventDefault();
        applyTSV(row, col, text);
    }

    // --- rank editing (dblclick) ---
    const editingRankId = ref<string | null>(null);

    const officerGrades = computed(() => gradesByType("O"));
    const warrantGrades = computed(() => gradesByType("W"));
    const enlistedGrades = computed(() => gradesByType("E"));

    function syncGradeFromRank(r: PersonnelRow) {
        const parsed = parseGradeKey(normStr(r.rank));
        r.grade = parsed ? { gradeType: parsed.gradeType, gradeNumber: parsed.gradeNumber } : undefined;
    }

    function beginRankEdit(id: string) {
        if (isLocked.value) return;
        editingRankId.value = id;
        nextTick(() => {
            const el = document.getElementById(`rankSel_${id}`) as HTMLSelectElement | null;
            el?.focus();
        });
    }

    function endRankEdit() {
        editingRankId.value = null;
    }

    function onRankPicked(rowIdx: number, key: string) {
        const value = normStr(key);

        const range = rankSelRange.value;
        const multi = !!range && (range.end - range.start) >= 1 && isRankRowSelected(rowIdx);
        const targets = multi ? selectedRankRowIndices() : [rowIdx];

        withSortSuppressed(() => {
            for (const idx of targets) {
                const r = rows.value[idx];
                if (!r) continue;
                r.rank = value;
                syncGradeFromRank(r);
            }
        });

        endRankEdit();
        requestResort();
    }

    const addCount = ref<number>(10);

    function resetAllToDefault() {
        if (isLocked.value) return;

        rows.value = rows.value.map((r) => {
            // Respect terminal KIA semantics (KIA started before today's scenario date)
            if (kiaLockedAtScenario(r)) return r;

            const updated = setFlagsAtDate(r, scenarioDate.value, {
                InRolls: true,
                WIA: false,
                KIA: false,
                POW: false,
                MIA: false,
            });

            return normalizeRow(updated);
        });
    }

    function deleteAllRows() {
        if (isLocked.value) return;

        // Optional: uncomment if you want a safety prompt.
        // if (!confirm("Delete all personnel rows? This cannot be undone.")) return;

        rows.value = [];
        closeHistory();
        endRankEdit();
    }

    function addXRows() {
        if (isLocked.value) return;

        const n = Math.max(1, Math.min(5000, Math.floor(Number(addCount.value) || 0)));
        for (let i = 0; i < n; i++) addRow();

        sortRowsByGradeDescInPlace(rows.value);
    }


    // --- history modal (flag segments) ---
    const historyRowId = ref<string | null>(null);

    const historyRow = computed(() => {
        const id = historyRowId.value;
        if (!id) return null;
        return rows.value.find((r) => r.id === id) ?? null;
    });

    function openHistory(id: string) {
        historyRowId.value = id;
    }

    function closeHistory() {
        historyRowId.value = null;
    }

    function ensureFlagsHistoryArray(r: PersonnelRow) {
        if (!Array.isArray(r.flagsHistory)) r.flagsHistory = [];
    }

    /**
     * IMPORTANT CHANGE:
     * Do NOT delete post-KIA segments (that made undo painful).
     * Instead we keep segments, but if a segment turns KIA on, later segments are clamped to terminal semantics.
     */
    function normalizeFlagsHistoryKeepAndClamp(segs: PersonnelFlagsSegment[]): PersonnelFlagsSegment[] {
        const cleaned = (Array.isArray(segs) ? segs : [])
            .map((s) => ({
                start: normStr((s as any).start),
                end: normStr((s as any).end),
                flags: normalizeFlags((s as any).flags),
            }))
            .sort((a, b) => (a.start || "").localeCompare(b.start || ""));

        // Find first KIA-on segment
        let kiaStart: string | null = null;
        for (const s of cleaned) {
            if (s.flags?.KIA) {
                kiaStart = s.start;
                break;
            }
        }

        if (!kiaStart) return cleaned;

        // Clamp all segments with start > kiaStart
        return cleaned.map((s) => {
            if (!s.start || s.start <= kiaStart) return s;
            return {
                ...s,
                flags: normalizeFlags({ KIA: true, InRolls: false }),
            };
        });
    }

    function addFlagsSegment() {
        const r = historyRow.value;
        if (!r || isLocked.value) return;
        ensureFlagsHistoryArray(r);

        const seg: PersonnelFlagsSegment = {
            start: scenarioDate.value,
            end: "",
            flags: normalizeFlags(flagsAtScenario(r)),
        };

        r.flagsHistory!.push(seg);
        r.flagsHistory = normalizeFlagsHistoryKeepAndClamp(r.flagsHistory!);
        r.status = statusFromFlags(flagsAtScenario(r));
    }

    function removeFlagsSegment(idx: number) {
        const r = historyRow.value;
        if (!r || isLocked.value) return;
        if (!Array.isArray(r.flagsHistory)) return;

        r.flagsHistory = r.flagsHistory.filter((_, i) => i !== idx);
        r.flagsHistory = r.flagsHistory.length ? normalizeFlagsHistoryKeepAndClamp(r.flagsHistory) : undefined;
        r.status = statusFromFlags(flagsAtScenario(r));
    }

    function updateFlagsSegment(
        idx: number,
        patch: Partial<{ start: string; end: string; flags: Partial<PersonnelFlags> }>,
    ) {
        const r = historyRow.value;
        if (!r || isLocked.value) return;
        ensureFlagsHistoryArray(r);

        const seg = r.flagsHistory![idx];
        if (!seg) return;

        seg.start = patch.start !== undefined ? normStr(patch.start) : seg.start;
        seg.end = patch.end !== undefined ? normStr(patch.end) : seg.end;

        if (patch.flags) {
            seg.flags = normalizeFlags({ ...seg.flags, ...patch.flags });
        } else {
            seg.flags = normalizeFlags(seg.flags);
        }

        r.flagsHistory = normalizeFlagsHistoryKeepAndClamp(r.flagsHistory!);
        r.status = statusFromFlags(flagsAtScenario(r));
    }

    // --- row CRUD ---
    function addRow() {
        if (isLocked.value) return;
        rows.value.push({
            id: makeId(),
            status: "Ok",
            rank: "",
            name: "",
            intakeDate: "",
            outtakeDate: "",
            statusHistory: [],
            flagsHistory: [],
        });
    }

    function resetRowToDefault(rowIdx: number) {
        if (isLocked.value) return;

        const r = rows.value[rowIdx];
        if (!r) return;

        // Respect terminal KIA semantics:
        // If KIA started before today's scenarioDate key, do not allow reset here.
        if (kiaLockedAtScenario(r)) return;

        const updated = setFlagsAtDate(r, scenarioDate.value, {
            InRolls: true,
            WIA: false,
            KIA: false,
            POW: false,
            MIA: false,
        });

        rows.value[rowIdx] = normalizeRow(updated);
    }


    function removeRow(id: string) {
        if (isLocked.value) return;
        rows.value = rows.value.filter((r) => r.id !== id);
        if (historyRowId.value === id) closeHistory();
        if (editingRankId.value === id) endRankEdit();
    }

    function apply() {
        emit("apply", rows.value.map(normalizeRow));
    }

    function save() {
        emit("save", rows.value.map(normalizeRow));
    }

    function close() {
        emit("close");
    }
</script>

<template>
    <div class="min-h-screen bg-white p-3 space-y-3 text-slate-900 dark:bg-slate-950 dark:text-slate-100"
         @copy="onGridCopy"
         @paste="onGridPaste">
        <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
                <div class="text-sm font-medium">
                    {{ title }}
                </div>
                <div class="text-xs text-slate-500 dark:text-slate-400">
                    Spreadsheet editor (copy/paste TSV). Scenario date key: {{ scenarioDate }} (UTC)
                </div>
                <div class="text-xs text-slate-500 dark:text-slate-400">
                    KIA is terminal if it started before today. If you just clicked it today, you can undo it.
                </div>
                <div class="text-xs text-slate-500 dark:text-slate-400">
                    Tip: Double-click Rank to pick from O/W/E lists.
                    <div class="text-xs text-slate-500 dark:text-slate-400">
                        Tip: Shift-click Rank cells to select a range; choosing a rank applies to the whole selection.
                    </div>
                </div>
            </div>

            <div class="flex flex-wrap items-center gap-2">
                <!-- New: Reset all / Delete all / Add X -->
                <button type="button"
                        class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                        :disabled="isLocked"
                        @click="resetAllToDefault"
                        title="Reset all rows at current scenario date to default (In-Rolls). Rows with terminal KIA (started earlier) will not be changed.">
                    Reset all
                </button>

                <button type="button"
                        class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                        :disabled="isLocked || rows.length === 0"
                        @click="deleteAllRows"
                        title="Delete all rows">
                    Delete all rows
                </button>

                <div class="flex items-center gap-2">
                    <input v-model.number="addCount"
                           type="number"
                           min="1"
                           max="5000"
                           step="1"
                           class="h-9 w-20 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-slate-800"
                           :disabled="isLocked"
                           title="How many rows to add" />
                    <button type="button"
                            class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                            :disabled="isLocked"
                            @click="addXRows"
                            title="Add N blank rows">
                        Add X rows
                    </button>
                </div>

                <!-- Existing -->
                <button type="button"
                        class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                        :disabled="isLocked"
                        @click="addRow">
                    Add row
                </button>

                <button type="button"
                        class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                        :disabled="isLocked"
                        @click="apply">
                    Apply
                </button>

                <button type="button"
                        class="h-9 rounded-md bg-slate-900 px-3 text-sm text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                        :disabled="isLocked"
                        @click="save">
                    Save
                </button>

                <button v-if="showCloseButton"
                        type="button"
                        class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                        @click="close">
                    Close
                </button>
            </div>

        </div>

        <div class="rounded-md border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div class="overflow-auto">
                <table class="min-w-[1100px] w-full border-separate border-spacing-0 text-sm">
                    <thead class="bg-slate-50 dark:bg-slate-900 sticky top-0 z-10">
                        <tr>
                            <th v-for="h in headers"
                                :key="h"
                                class="border-b border-slate-200 px-2 py-2 text-left font-medium text-slate-700 dark:border-slate-800 dark:text-slate-200">
                                {{ h }}
                            </th>
                            <th class="border-b border-slate-200 px-2 py-2 text-left font-medium text-slate-700 dark:border-slate-800 dark:text-slate-200 w-[160px]">
                                Actions
                            </th>
                        </tr>
                    </thead>

                    <tbody>
                        <tr v-for="(r, rIdx) in rows" :key="r.id">
                            <!-- Rank -->
                            <td :class="['border-t border-slate-200 px-1 py-1 dark:border-slate-800 w-[160px]', isRankRowSelected(rIdx) ? 'bg-slate-100 dark:bg-slate-900' : '']">
                                <input v-if="editingRankId !== r.id"
                                       v-model="r.rank"
                                       type="text"
                                       class="h-9 w-full rounded-md border border-transparent px-2 text-slate-900 outline-none focus:border-slate-200 focus:bg-white focus:ring-2 focus:ring-slate-200 dark:bg-transparent dark:text-slate-100 dark:focus:border-slate-800 dark:focus:bg-slate-950 dark:focus:ring-slate-800"
                                       :disabled="isLocked"
                                       @mousedown="setRankSelectionFromMouse($event, rIdx)"
                                       @focus="setFocus(rIdx, 0)"
                                       @dblclick="beginRankEdit(r.id)"
                                       @input="syncGradeFromRank(r)"
                                       @blur="syncGradeFromRank(r)"
                                       @paste="onCellPaste($event as any, rIdx, 0)" />

                                <select v-else
                                        :id="`rankSel_${r.id}`"
                                        class="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-slate-800"
                                        :disabled="isLocked"
                                        @mousedown="setRankSelectionFromMouse($event, rIdx)"
                                        :value="r.rank"
                                        @change="(e) => onRankPicked(rIdx, (e.target as HTMLSelectElement).value)"
                                        @blur="endRankEdit"
                                        @keydown.enter.prevent="endRankEdit">
                                    <option value=""></option>
                                    <optgroup label="Officers">
                                        <option v-for="g in officerGrades" :key="g.key" :value="g.key">{{ g.key }}</option>
                                    </optgroup>
                                    <optgroup label="Warrant">
                                        <option v-for="g in warrantGrades" :key="g.key" :value="g.key">{{ g.key }}</option>
                                    </optgroup>
                                    <optgroup label="Enlisted">
                                        <option v-for="g in enlistedGrades" :key="g.key" :value="g.key">{{ g.key }}</option>
                                    </optgroup>
                                </select>
                            </td>

                            <!-- Name -->
                            <td class="border-t border-slate-200 px-1 py-1 dark:border-slate-800 w-[260px]">
                                <input v-model="r.name"
                                       type="text"
                                       class="h-9 w-full rounded-md border border-transparent px-2 text-slate-900 outline-none focus:border-slate-200 focus:bg-white focus:ring-2 focus:ring-slate-200 dark:bg-transparent dark:text-slate-100 dark:focus:border-slate-800 dark:focus:bg-slate-950 dark:focus:ring-slate-800"
                                       :disabled="isLocked"
                                       @focus="setFocus(rIdx, 1)"
                                       @paste="onCellPaste($event as any, rIdx, 1)" />
                            </td>

                            <!-- Flag columns (right side) -->
                            <td v-for="(flag, fIdx) in FLAG_OPTIONS"
                                :key="flag"
                                class="border-t border-slate-200 px-1 py-1 dark:border-slate-800">
                                <div class="flex h-9 items-center justify-center">
                                    <input type="checkbox"
                                           class="h-4 w-4 accent-slate-900 dark:accent-slate-100"
                                           :checked="flagsAtScenario(r)[flag]"
                                           :disabled="
                                            isLocked ||
                                            (flag === 'KIA' && kiaLockedAtScenario(r)) ||
                                            (flag !== 'KIA' && isTerminalAtScenario(r))
                                        "
                                           @focus="setFocus(rIdx, (2 + fIdx) as any)"
                                           @click="(e) => onFlagCheckboxClick(e as any, rIdx, flag)"
                                           @change="(e) => setCellValue(rIdx, (2 + fIdx) as any, ((e.target as HTMLInputElement).checked ? '1' : '0'))"
                                           @paste="onCellPaste($event as any, rIdx, (2 + fIdx) as any)"
                                           :title="FLAG_LABEL[flag]" />
                                </div>
                            </td>

                            <!-- Actions -->
                            <td class="border-t border-slate-200 px-2 py-1 dark:border-slate-800">
                                <div class="flex items-center gap-2 justify-end">
                                    <button type="button"
                                            class="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                                            @click="openHistory(r.id)"
                                            title="Edit time-sensitive flag history">
                                        History
                                    </button>

                                    <button type="button"
                                            class="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                                            :disabled="isLocked"
                                            @click="removeRow(r.id)"
                                            title="Remove row">
                                        Remove
                                    </button>

                                    <button type="button"
                                            class="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                                            :disabled="isLocked || kiaLockedAtScenario(r)"
                                            @click="resetRowToDefault(rIdx)"
                                            :title="kiaLockedAtScenario(r) ? 'Cannot reset: KIA is terminal from an earlier date. Use History to change the KIA segment.' : 'Reset flags at current scenario date to default (In-Rolls).'">
                                        Reset
                                    </button>

                                </div>
                            </td>
                        </tr>

                        <tr v-if="rows.length === 0">
                            <td colspan="8" class="px-3 py-6 text-center text-slate-500 dark:text-slate-400">
                                No personnel rows yet.
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- History modal -->
        <div v-if="historyRow"
             class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4"
             @click.self="closeHistory">
            <div class="w-full max-w-3xl rounded-lg bg-white p-4 shadow-lg dark:bg-slate-950">
                <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                        <div class="text-sm font-medium text-slate-900 dark:text-slate-100">
                            Flag history: {{ historyRow.rank }} {{ historyRow.name }}
                        </div>
                        <div class="text-xs text-slate-500 dark:text-slate-400">
                            Segments use YYYY-MM-DD. Start is inclusive. End is exclusive. Empty end = open-ended.
                        </div>
                        <div class="text-xs text-slate-500 dark:text-slate-400">
                            If any segment turns KIA on, later segments are clamped to terminal semantics (not deleted).
                        </div>
                    </div>

                    <div class="flex items-center gap-2">
                        <button type="button"
                                class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                                :disabled="isLocked"
                                @click="addFlagsSegment">
                            Add segment
                        </button>

                        <button type="button"
                                class="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                                @click="closeHistory">
                            Close
                        </button>
                    </div>
                </div>

                <div class="mt-3 rounded-md border border-slate-200 dark:border-slate-800 overflow-hidden">
                    <div class="overflow-auto">
                        <table class="min-w-[860px] w-full text-sm">
                            <thead class="bg-slate-50 dark:bg-slate-900">
                                <tr>
                                    <th class="px-2 py-2 text-left font-medium text-slate-700 dark:text-slate-200 w-[120px]">
                                        Start
                                    </th>
                                    <th class="px-2 py-2 text-left font-medium text-slate-700 dark:text-slate-200 w-[120px]">
                                        End
                                    </th>
                                    <th v-for="f in FLAG_OPTIONS"
                                        :key="f"
                                        class="px-2 py-2 text-center font-medium text-slate-700 dark:text-slate-200">
                                        {{ FLAG_LABEL[f] }}
                                    </th>
                                    <th class="px-2 py-2 text-right font-medium text-slate-700 dark:text-slate-200 w-[90px]"></th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="(seg, idx) in (historyRow.flagsHistory || [])"
                                    :key="idx"
                                    class="border-t border-slate-200 dark:border-slate-800">
                                    <td class="px-2 py-1">
                                        <input class="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-slate-800"
                                               :disabled="isLocked"
                                               type="date"
                                               :value="seg.start"
                                               @input="(e) => updateFlagsSegment(idx, { start: (e.target as HTMLInputElement).value })" />
                                    </td>
                                    <td class="px-2 py-1">
                                        <input class="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-200 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-slate-800"
                                               :disabled="isLocked"
                                               type="date"
                                               :value="seg.end"
                                               @input="(e) => updateFlagsSegment(idx, { end: (e.target as HTMLInputElement).value })" />
                                    </td>

                                    <td v-for="f in FLAG_OPTIONS" :key="f" class="px-2 py-1">
                                        <div class="flex h-9 items-center justify-center">
                                            <input type="checkbox"
                                                   class="h-4 w-4 accent-slate-900 dark:accent-slate-100"
                                                   :disabled="isLocked"
                                                   :checked="!!seg.flags[f]"
                                                   @change="(e) => updateFlagsSegment(idx, { flags: { [f]: (e.target as HTMLInputElement).checked } as any })" />
                                        </div>
                                    </td>

                                    <td class="px-2 py-1 text-right">
                                        <button type="button"
                                                class="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                                                :disabled="isLocked"
                                                @click="removeFlagsSegment(idx)">
                                            Remove
                                        </button>
                                    </td>
                                </tr>

                                <tr v-if="!(historyRow.flagsHistory && historyRow.flagsHistory.length)">
                                    <td colspan="8" class="px-3 py-4 text-center text-slate-500 dark:text-slate-400">
                                        No flag history segments yet. Add a segment to make flags time-sensitive.
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="mt-3 text-xs text-slate-600 dark:text-slate-300">
                    Scenario date key: {{ scenarioDate }} (UTC). Effective status now:
                    <span class="font-medium">{{ statusFromFlags(flagsAtScenario(historyRow)) }}</span>
                </div>
            </div>
        </div>
    </div>
</template>