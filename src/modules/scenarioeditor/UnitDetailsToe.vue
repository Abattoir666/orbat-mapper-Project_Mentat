<script setup lang="ts">
    import type {
        EUnitEquipment,
        EUnitPersonnel,
        NUnit,
        NUnitEquipment,
        NUnitPersonnel,
        NUnitSupply,
        ToeMode,
    } from "@/types/internalModels";
    import { computed, ref, shallowRef, triggerRef, watch } from "vue";
    import { injectStrict } from "@/utils";
    import { activeScenarioKey } from "@/components/injects";
    import { useSelectedItems } from "@/stores/selectedStore";
    import type { EntityId } from "@/types/base";
    import { useEquipmentEditStore, usePersonnelEditStore } from "@/stores/toeStore";
    import type { StateAdd } from "@/types/scenarioModels";
    import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
    import ToeGridHeader from "@/modules/scenarioeditor/ToeGridHeader.vue";
    import {
        useUnitEquipmentTableStore,
        useUnitPersonnelTableStore,
    } from "@/stores/tableStores";
    import { createToeTableColumns, useToeEditableItems } from "@/composables/toeUtils";
    import ToeGrid from "@/modules/grid/ToeGrid.vue";
    import InlineFormWrapper from "@/modules/scenarioeditor/InlineFormWrapper.vue";
    import ModifyUnitToeItemForm from "@/modules/scenarioeditor/ModifyUnitToeItemForm.vue";
    import AddUnitToeItemForm from "@/modules/scenarioeditor/AddUnitToeItemForm.vue";
    import { useUiStore } from "@/stores/uiStore";
    import { storeToRefs } from "pinia";
    import UnitDetailsSupplies from "@/modules/scenarioeditor/UnitDetailsSupplies.vue";
    import { useDoctrinalToe } from "@/modules/scenarioeditor/doctrinalToe/useDoctrinalToe";
    import type { UnitPersonnel } from "@/types/scenarioModels";
    import { openDoctrinalToePopout } from "@/modules/scenarioeditor/doctrinalToe/openDoctrinalToePopout";
    import {
        type PersonnelRow,
        normalizePersonnelRow,
        flagsAtTimeMs,
        statusFromFlags,
    } from "@/modules/scenarioeditor/Personnel/personnelTypes.ts";

    interface Props {
        unit: NUnit;
        isLocked?: boolean;
    }

    const props = defineProps<Props>();

    const {
        store: { state, onUndoRedo, groupUpdate },
        unitActions: {
            walkSubUnits,
            updateUnitEquipment,
            updateUnitPersonnel,
            updateUnitState,
            addUnitStateEntry,
            updateUnit,
        },
        time,
    } = injectStrict(activeScenarioKey);

    const { equipmentMap, personnelMap, unitMap } = state;

    const sideMap: Record<string, any> = (state as any).sideMap ?? {};
    const sideGroupMap: Record<string, any> =
        (state as any).sideGroupMap ?? (state as any).groupMap ?? {};

    const uiStore = useUiStore();


    const baselineRows = computed<UnitPersonnel[]>(
        () => props.unit.toeBaseline?.personnel ?? [],
    );

    

    // When include-subordinates or multi-mode is active, display a rolled-up baseline by concatenating
    // toeBaseline.personnel rows from every included unit. The baseline editor still edits the parent unit only.
    const baselineRowsForDisplay = computed<UnitPersonnel[]>(() => {
        if (!includeSubordinates.value && !isMultiMode.value) return baselineRows.value ?? [];

        const out: UnitPersonnel[] = [];
        for (const id of includedUnitIds.value) {
            const uAny = (unitMap as any)[id];
            const rows = uAny?.toeBaseline?.personnel;
            if (!Array.isArray(rows) || rows.length === 0) continue;
            for (const r of rows) out.push(r as UnitPersonnel);
        }
        return out;
    });
function saveBaselinePersonnelForTargets(rows: UnitPersonnel[], targetIds: EntityId[]) {
        for (const id of targetIds) {
            const existing = (state.unitMap as any)[id]?.toeBaseline ?? {};
            updateUnit(id, {
                toeBaseline: {
                    ...existing,
                    personnel: rows,
                },
            });
        }
    }

    function openBaselineEditor() {
        openDoctrinalToePopout({
            title: `${props.unit.name} — Doctrinal Personnel Baseline`,
            initialRows: baselineRows.value,
            isLocked: !!props.isLocked,

            unitIndex: unitIndex.value,
            initialTargetIds: includedUnitIds.value,
            contextSubtreeIds: contextSubtreeIds.value,

            onApply: (rows, targetUnitIds) => saveBaselinePersonnelForTargets(rows, targetUnitIds),
            onSave: (rows, targetUnitIds) => saveBaselinePersonnelForTargets(rows, targetUnitIds),
        });
    }


    const includedUnitIds = computed<EntityId[]>(() => {
        const base = isMultiMode.value ? [...selectedUnitIds.value] : [props.unit.id];

        if (!includeSubordinates.value) return base;

        const out = new Set<EntityId>();
        for (const id of base) {
            // Include self + all descendants
            walkSubUnits(id, (u) => out.add(u.id), { includeParent: true });
        }
        return [...out];
    });

    const includedUnitNumbers = computed(() =>
        includedUnitIds.value
            .map((id) => state.unitMap[id]?.unitNumber)
            .filter((n): n is string => !!n && n.trim().length > 0),
    );

    const unitIndex = computed(() =>
        Object.values(unitMap).map((u) => ({
            id: u.id,
            name: u.name,
            shortName: u.shortName,
            unitNumber: (u as any).unitNumber, // until your Unit type includes it everywhere

            // Symbology (for pickers/popouts)
            sidc: (u as any).sidc ?? u.sidc,
            symbolOptions: (u as any).symbolOptions,
            fillColor: (u as any).fillColor ?? (u as any).hexFill ?? (u as any).hexColor ?? (u as any).color,

            sideId: u._sid,
            sideName: u._sid ? sideMap[u._sid]?.name : undefined,
            groupId: u._gid,
            groupName: u._gid ? sideGroupMap[u._gid]?.name : undefined,
            parentId: u._pid,
        })),
    );

    const contextSubtreeIds = computed(() => {
        const ids: EntityId[] = [];
        walkSubUnits(props.unit.id, (x) => ids.push(x.id), { includeParent: true });
        return ids;
    });

    const { toeIncludeSubordinates: includeSubordinates } = storeToRefs(uiStore);
    const unitEquipmentTableStore = useUnitEquipmentTableStore();
    const unitPersonnelTableStore = useUnitPersonnelTableStore();

    const { editedId: editedEquipmentId, selectedItems: selectedEquipment } =
        useToeEditableItems<EUnitEquipment>();

    const { editedId: editedPersonnelId, selectedItems: selectedPersonnel } =
        useToeEditableItems<EUnitPersonnel>();

    const equipmentEditStore = useEquipmentEditStore();
    const personnelEditStore = usePersonnelEditStore();

    const { isEditMode } = storeToRefs(equipmentEditStore);

    const { selectedUnitIds } = useSelectedItems();
    const isMultiMode = computed(() => selectedUnitIds.value.size > 1);

    const addFormData = ref<NUnitEquipment | NUnitPersonnel>({ id: "", count: 1 });
    const aggregatedEquipment = shallowRef<EUnitEquipment[]>([]);
    const aggregatedPersonnel = shallowRef<EUnitPersonnel[]>([]);
    const aggregatedPersonnelCount = computed(() =>
        aggregatedPersonnel.value.reduce((acc, e) => acc + (e.onHand ?? e.count ?? 0), 0),
    );

    function toMs(v: unknown): number {
        // Handles Date, number, or string-like timestamps.
        // Always returns a finite ms value (fallback 0) to avoid runtime crashes.
        if (typeof v === "number" && Number.isFinite(v)) return v;
        if (v instanceof Date) {
            const ms = +v;
            return Number.isFinite(ms) ? ms : 0;
        }
        const ms = +(v as any);
        return Number.isFinite(ms) ? ms : 0;
    }

    function parseDateMs(v: unknown): number | null {
        if (typeof v !== "string") return null;
        const s = v.trim();
        if (!s) return null;
        const d = new Date(s);
        const ms = +d;
        return Number.isFinite(ms) ? ms : null;
    }

    function isPresentAtTime(row: any, tMs: number): boolean {
        const inMs = parseDateMs(row?.intakeDate);
        const outMs = parseDateMs(row?.outtakeDate);

        if (inMs != null && tMs < inMs) return false;
        if (outMs != null && tMs > outMs) return false;
        return true;
    }

    function normStatus(v: unknown): "Ok" | "WIA" | "KIA" | "POW" | "MIA" {
        const s = (typeof v === "string" ? v.trim() : "").toUpperCase();
        if (s === "WIA") return "WIA";
        if (s === "KIA") return "KIA";
        if (s === "POW") return "POW";
        if (s === "MIA") return "MIA";
        return "Ok";
    }

    type PersonnelStatus = "Ok" | "WIA" | "KIA" | "POW" | "MIA";

    function parseYmdToUtcMs(ymd: unknown): number | null {
        const s = typeof ymd === "string" ? ymd.trim() : "";
        if (!s) return null;
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        if (!m) return null;
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const d = Number(m[3]);
        if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
        return Date.UTC(y, mo - 1, d, 0, 0, 0, 0);
    }

    /**
     * Time-sensitive status reader for roster rows.
     * Uses statusHistory segments if present; falls back to row.status.
     *
     * Segment rules:
     * - start inclusive
     * - end exclusive
     * - empty start => unbounded past
     * - empty end => open-ended
     */
    function statusAtTimeFromRosterRow(row: any, tMs: number): "Ok" | "WIA" | "KIA" | "POW" | "MIA" {
        // Align TO&E/S personnel math with the Personnel tab + spreadsheet popout:
        // derive effective status strictly from time-sensitive flags.
        const nr = normalizePersonnelRow(row);
        return statusFromFlags(flagsAtTimeMs(nr, tMs));
    }



    function gradeToRankString(g: any): string {
        if (!g || typeof g !== "object") return "";
        const t = typeof g.gradeType === "string" ? g.gradeType : "";
        const n = Number.isFinite(g.gradeNumber) ? g.gradeNumber : NaN;
        if (!t || !Number.isFinite(n)) return "";
        return `${t}-${n}`;
    }

    function leaderToRosterRow(l: any) {
        const rankOverride = typeof l?.rankOverride === "string" ? l.rankOverride.trim() : "";
        const legacyRank = typeof l?.rank === "string" ? l.rank.trim() : "";
        const derivedRank = gradeToRankString(l?.grade);

        return {
            id: String(l?.id ?? ""),
            status: "Ok",
            rank: rankOverride || legacyRank || derivedRank || "",
            name: typeof l?.name === "string" ? l.name.trim() : "",
            intakeDate: typeof l?.start === "string" ? l.start.trim() : "",
            outtakeDate: typeof l?.end === "string" ? l.end.trim() : "",
            _isLeader: true,
        };
    }

    /**
     * Display-only merged roster: personnelRoster + missing leaders.
     * Does not mutate unit state; safe for TO&E calculations.
     */
    const derivedRosterAll = computed<PersonnelRow[]>(() => {
        const out: PersonnelRow[] = [];
        // Use a composite key so we don't accidentally de-dupe the same person ID across different units.
        const seen = new Set<string>();

        const scopeIds = includedUnitIds.value?.length ? includedUnitIds.value : [props.unit.id];

        for (const unitId of scopeIds) {
            const unitAny = (unitMap as any)[unitId] ?? (unitId === props.unit.id ? (props.unit as any) : undefined);
            if (!unitAny) continue;

            const rosterRaw = Array.isArray(unitAny?.personnelRoster) ? unitAny.personnelRoster : [];
            const leadersRaw = Array.isArray(unitAny?.leaders) ? unitAny.leaders : [];

            for (const r of rosterRaw) {
                const nr = normalizePersonnelRow(r);
                if (!nr.id) continue;
                const key = `${unitId}|${nr.id}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push(nr);
            }

            for (const l of leadersRaw) {
                const id = typeof l?.id === "string" ? l.id : "";
                const name = typeof l?.name === "string" ? l.name : "";
                if (!id || !name) continue;

                // If this leader already exists in the roster for this unit, skip.
                const key = `${unitId}|${id}`;
                if (seen.has(key)) continue;

                const leaderRow = normalizePersonnelRow({
                    id,
                    name,
                    rank: "",
                    status: "Ok",
                    statusHistory: [],
                    flagsHistory: [],
                    intakeDate: typeof l?.start === "string" ? l.start : "",
                    outtakeDate: typeof l?.end === "string" ? l.end : "",
                    isLeader: true,
                });

                if (!leaderRow.id) continue;
                seen.add(key);
                out.push(leaderRow);
            }
        }

        return out;
    });

const knownRosterAtTime = computed(() => {
        const tMs = toMs(time?.scenarioTime?.value);

        return derivedRosterAll.value.filter((r) => {
            if (r.isLeader) return false; // do not mix leaders into personnel casualty math
            const f = flagsAtTimeMs(r, tMs);
            return !!(f.InRolls || f.KIA);
        });
    });


    function parseYmdUtcMs(v: unknown): number | null {
        if (typeof v !== "string") return null;
        const s = v.trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
        const ms = Date.parse(`${s}T00:00:00Z`);
        return Number.isFinite(ms) ? ms : null;
    }

    function statusAtTimeFromHistory(row: any, tMs: number): "Ok" | "WIA" | "KIA" | "POW" | "MIA" {
        // Prefer statusHistory segments if present; otherwise fall back to row.status
        const segs = Array.isArray(row?.statusHistory) ? row.statusHistory : [];
        if (!segs.length) return normStatus(row?.status);

        // Sort so “last matching segment wins”
        const sorted = [...segs].sort((a, b) => (parseYmdUtcMs(a?.start) ?? -9e15) - (parseYmdUtcMs(b?.start) ?? -9e15));
        for (let i = sorted.length - 1; i >= 0; i--) {
            const seg = sorted[i];
            const startMs = parseYmdUtcMs(seg?.start);
            const endMs = parseYmdUtcMs(seg?.end);

            const afterStart = startMs == null ? true : tMs >= startMs; // inclusive start
            const beforeEnd = endMs == null ? true : tMs < endMs;       // exclusive end
            if (afterStart && beforeEnd) return normStatus(seg?.status);
        }

        return normStatus(row?.status);
    }


    const knownStatusCountsAtTime = computed(() => {
        const counts = { Ok: 0, WIA: 0, KIA: 0, POW: 0, MIA: 0 };
        const tMs = toMs(time?.scenarioTime?.value);

        for (const r of knownRosterAtTime.value) {
            const s = statusAtTimeFromRosterRow(r, tMs);
            counts[s] = (counts[s] ?? 0) + 1;
        }

        return counts;
    });


    const toePersonnelTotals = computed(() => {
        let count = 0;
        let onHand = 0;

        for (const p of aggregatedPersonnel.value) {
            const c = Number((p as any)?.count ?? 0) || 0;
            const oh = Number((p as any)?.onHand ?? c) || 0;
            count += c;
            onHand += oh;
        }

        return { count, onHand };
    });

    const unaccountedAtTime = computed(() => {
        const toe = toePersonnelTotals.value.onHand || toePersonnelTotals.value.count || 0;
        const known = knownRosterAtTime.value.length;
        return Math.max(0, toe - known);
    });

    // ---- Summary expansion toggles ----
    const expandKnownSummary = ref(false);
    const expandBaselineSummary = ref(false);

    // ---- Rank sorting (O/E/S-# preferred) ----
    const rankGroupOrder: Record<string, number> = { O: 0, W: 1, E: 2, S: 3 };
    function rankSortKey(rankRaw: unknown): [number, number, string] {
        const r = (typeof rankRaw === "string" ? rankRaw : "").trim().toUpperCase();
        const m = /^([OWES])\s*-\s*(\d+)$/.exec(r);
        if (m) {
            const g = rankGroupOrder[m[1]] ?? 99;
            const n = Number(m[2]) || 999;
            // Descending within group (e.g., O-12 before O-1).
            const nKey = -n;
            return [g, nKey, r];
        }
        // Unknown/blank ranks go last, but stable by string
        return [98, 999, r || "(UNK)"];
    }

    const statusCols = ["Ok", "WIA", "KIA", "POW", "MIA"] as const;
    type StatusKey = (typeof statusCols)[number];

    // ---- Coverage summary: Known OK / doctrinal baseline ----
    const knownOkAtTime = computed(() => Number(knownStatusCountsAtTime.value?.Ok ?? 0));
    const doctrinalBaselineTotal = computed(() => Number(baselineTotal.value ?? 0));

    const okCoverageRatio = computed(() => {
        const denom = doctrinalBaselineTotal.value;
        if (!denom) return null;
        return knownOkAtTime.value / denom;
    });

    const okCoveragePct = computed(() => {
        const r = okCoverageRatio.value;
        return r == null ? null : Math.round(r * 1000) / 10; // 0.1% precision
    });

    // ---- Personnel at current time: rank x status pivot ----
    type KnownRankStatusRow = {
        rank: string;
        total: number;
    } & Record<StatusKey, number>;

    const knownRankStatusRowsAll = computed<KnownRankStatusRow[]>(() => {
         const tMs = toMs(time?.scenarioTime?.value);
        const map = new Map<string, KnownRankStatusRow>();

        for (const r of knownRosterAtTime.value) {
            const rank = (typeof (r as any)?.rank === "string" ? (r as any).rank.trim() : "") || "(Unk)";
            const status = statusAtTimeFromRosterRow(r, tMs) as StatusKey;

            let row = map.get(rank);
            if (!row) {
                row = { rank, total: 0, Ok: 0, WIA: 0, KIA: 0, POW: 0, MIA: 0 };
                map.set(rank, row);
            }

            row[status] += 1;
            row.total += 1;
        }

        const out = Array.from(map.values());
        out.sort((a, b) => {
            const ka = rankSortKey(a.rank);
            const kb = rankSortKey(b.rank);
            return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
        });
        return out;
    });

    // Compact view shows the most relevant ranks (by total), but still stable
    const knownRankStatusRowsCompact = computed(() => {
        const out = [...knownRankStatusRowsAll.value];
        out.sort((a, b) => b.total - a.total);
        return out.slice(0, 8);
    });

    // ---- Doctrinal baseline: rank summary + expanded rank/role breakdown ----
    type BaselineRankSummaryRow = { rank: string; authorized: number; roles: string };
    type BaselineRankRoleRow = { rank: string; role: string; authorized: number };

    const baselineRankSummaryRowsAll = computed<BaselineRankSummaryRow[]>(() => {
        const agg = new Map<string, { authorized: number; roles: Set<string> }>();

        for (const r of baselineRowsForDisplay.value ?? []) {
            const rank = (typeof (r as any)?.name === "string" ? (r as any).name.trim() : "") || "(Unk)";
            const role = (typeof (r as any)?.description === "string" ? (r as any).description.trim() : "");
            const n = Number((r as any)?.count ?? 0) || 0;

            let cur = agg.get(rank);
            if (!cur) {
                cur = { authorized: 0, roles: new Set<string>() };
                agg.set(rank, cur);
            }

            cur.authorized += n;
            if (role) cur.roles.add(role);
        }

        const out = Array.from(agg.entries()).map(([rank, v]) => ({
            rank,
            authorized: v.authorized,
            roles: Array.from(v.roles).sort().join(", "),
        }));

        out.sort((a, b) => {
            const ka = rankSortKey(a.rank);
            const kb = rankSortKey(b.rank);
            return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
        });

        return out;
    });

    const baselineRankSummaryRowsCompact = computed(() => baselineRankSummaryRowsAll.value.slice(0, 10));

    const baselineRankRoleRowsAll = computed<BaselineRankRoleRow[]>(() => {
        const agg = new Map<string, number>();

        for (const r of baselineRowsForDisplay.value ?? []) {
            const rank = (typeof (r as any)?.name === "string" ? (r as any).name.trim() : "") || "(Unk)";
            const role = (typeof (r as any)?.description === "string" ? (r as any).description.trim() : "") || "(No role)";
            const n = Number((r as any)?.count ?? 0) || 0;

            const key = `${rank}||${role}`;
            agg.set(key, (agg.get(key) ?? 0) + n);
        }

        const out = Array.from(agg.entries()).map(([key, authorized]) => {
            const [rank, role] = key.split("||");
            return { rank, role, authorized };
        });

        out.sort((a, b) => {
            const ka = rankSortKey(a.rank);
            const kb = rankSortKey(b.rank);
            return ka[0] - kb[0] || ka[1] - kb[1] || a.role.localeCompare(b.role);
        });

        return out;
    });


    const equipmentColumns = createToeTableColumns();
    const personnelColumns = createToeTableColumns();

    const { baselineTotal: baselineTotalSingle, templateKey } = useDoctrinalToe(props.unit);

    function baselineTotalFromToeBaseline(unitAny: any): number {
        const rows = unitAny?.toeBaseline?.personnel;
        if (!Array.isArray(rows) || rows.length === 0) return 0;
        let acc = 0;
        for (const r of rows) acc += Number((r as any)?.count) || 0;
        return acc;
    }

    const baselineTotal = computed(() => {
        // If we're scoped to exactly this one unit, preserve the existing computed (may include template defaults).
        if (!includeSubordinates.value && !isMultiMode.value) return Number(baselineTotalSingle.value) || 0;

        // Otherwise, sum the per-unit doctrinal baseline across the scoped units.
        // (Matches the baseline editor's toeBaseline rows.)
        let sum = 0;
        for (const id of includedUnitIds.value) {
            const uAny = (unitMap as any)[id];
            if (!uAny) continue;
            sum += baselineTotalFromToeBaseline(uAny);
        }
        return sum;
    });

    const toeAuthorizedTotal = computed(() =>
        aggregatedPersonnel.value.reduce((acc, p) => acc + (Number(p.count) || 0), 0),
    );

    const toeOnHandTotal = computed(() =>
        aggregatedPersonnel.value.reduce((acc, p) => acc + (Number(p.onHand ?? p.count) || 0), 0),
    );



    onUndoRedo((param) => {
        // Update the current state of the selected units in case equipment or personnel have changed
        selectedUnitIds.value.forEach((unitId) => updateUnitState(unitId));
        triggerRef(selectedUnitIds);
    });

    watch(isEditMode, (value) => {
        if (value) {
            uiStore.prevToeIncludeSubordinates = includeSubordinates.value;
            includeSubordinates.value = false;
        } else {
            if (uiStore.prevToeIncludeSubordinates !== undefined) {
                includeSubordinates.value = uiStore.prevToeIncludeSubordinates;
            }
        }
    });

    watch(
        [
            includedUnitIds,
            time.scenarioTime,
            () => state.settingsStateCounter,
        ],
        () => {
            const aggEquipment: Record<string, { count: number; onHand: number }> = {};
            const aggPersonnel: Record<string, { count: number; onHand: number }> = {};
            const allUnitIds = new Set<EntityId>(includedUnitIds.value);
allUnitIds.forEach((unitId) => {
                const unit = unitMap[unitId];
                const equipment = unit._state?.equipment ?? unit.equipment ?? [];
                const personnel = unit._state?.personnel ?? unit.personnel ?? [];
                equipment?.forEach((e) => {
                    const count = (aggEquipment[e.id]?.count ?? 0) + e.count;
                    const onHand = (aggEquipment[e.id]?.onHand ?? 0) + (e?.onHand ?? e.count);
                    aggEquipment[e.id] = { count, onHand };
                });
                personnel?.forEach((p) => {
                    const count = (aggPersonnel[p.id]?.count ?? 0) + p.count;
                    const onHand = (aggPersonnel[p.id]?.onHand ?? 0) + (p?.onHand ?? p.count);
                    aggPersonnel[p.id] = { count, onHand };
                });
            });

            aggregatedEquipment.value = Object.entries(aggEquipment).map(
                ([id, { count, onHand }]) => ({
                    id,
                    name: equipmentMap[id]?.name ?? id,
                    description: equipmentMap[id]?.description ?? "",
                    count,
                    onHand,
                }),
            );
            aggregatedPersonnel.value = Object.entries(aggPersonnel).map(
                ([id, { count, onHand }]) => ({
                    id,
                    name: personnelMap[id]?.name ?? id,
                    description: personnelMap[id]?.description ?? "",
                    count,
                    onHand,
                }),
            );
        },
        { immediate: true, deep: true },
    );

    function onAddSubmit(toeMode: ToeMode, formData: NUnitSupply) {
        const { id, count, onHand } = formData;
        groupUpdate(() => {
            selectedUnitIds.value.forEach((unitId) => {
                if (toeMode === "equipment") {
                    updateUnitEquipment(unitId, id, { count, onHand });
                } else if (toeMode === "personnel") {
                    updateUnitPersonnel(unitId, id, { count, onHand });
                }
            });
        });
        triggerRef(selectedUnitIds);

        addFormData.value = { ...formData, id: "" };
    }

    function updateItemCount(
        toeMode: ToeMode,
        { id: itemId, count }: NUnitEquipment | NUnitPersonnel,
    ) {
        groupUpdate(() => {
            selectedUnitIds.value.forEach((unitId) => {
                if (toeMode === "equipment") {
                    updateUnitEquipment(unitId, itemId, { count });
                } else if (toeMode === "personnel") {
                    updateUnitPersonnel(unitId, itemId, { count });
                }
            });
        });
        triggerRef(selectedUnitIds);
        handleNextEditedId(toeMode, itemId);
    }

    function updateItemOnHand(
        toeMode: ToeMode,
        { id: itemId, onHand }: NUnitEquipment | NUnitPersonnel,
    ) {
        groupUpdate(() => {
            selectedUnitIds.value.forEach((unitId) => {
                if (toeMode === "equipment") {
                    const unit = unitMap[unitId];
                    if (!unit.equipment?.find((e) => e.id === itemId)) return;
                    const newState: StateAdd = {
                        t: +time.scenarioTime.value,
                        update: { equipment: [{ id: itemId, onHand }] },
                    };
                    addUnitStateEntry(unitId, newState, true);
                } else if (toeMode === "personnel") {
                    const unit = unitMap[unitId];
                    if (!unit.personnel?.find((p) => p.id === itemId)) return;
                    const newState: StateAdd = {
                        t: +time.scenarioTime.value,
                        update: { personnel: [{ id: itemId, onHand }] },
                    };
                    addUnitStateEntry(unitId, newState, true);
                }
            });
        });
        triggerRef(selectedUnitIds);
        handleNextEditedId(toeMode, itemId);
    }

    function diffItemOnHand(
        toeMode: ToeMode,
        { id: itemId, onHand }: NUnitEquipment | NUnitPersonnel,
    ) {
        groupUpdate(() => {
            selectedUnitIds.value.forEach((unitId) => {
                if (toeMode === "equipment") {
                    const unit = unitMap[unitId];
                    if (!unit.equipment?.find((e) => e.id === itemId)) return;
                    const newState: StateAdd = {
                        t: +time.scenarioTime.value,
                        diff: { equipment: [{ id: itemId, onHand }] },
                    };
                    addUnitStateEntry(unitId, newState, true);
                } else if (toeMode === "personnel") {
                    const unit = unitMap[unitId];
                    if (!unit.personnel?.find((p) => p.id === itemId)) return;
                    const newState: StateAdd = {
                        t: +time.scenarioTime.value,
                        diff: { personnel: [{ id: itemId, onHand }] },
                    };
                    addUnitStateEntry(unitId, newState, true);
                }
            });
        });
        triggerRef(selectedUnitIds);
        handleNextEditedId(toeMode, itemId);
    }

    function onDeleteItems(toeMode: ToeMode) {
        groupUpdate(() => {
            selectedUnitIds.value.forEach((unitId) => {
                if (toeMode === "equipment") {
                    selectedEquipment.value.forEach(({ id: itemId }) => {
                        updateUnitEquipment(unitId, itemId, { count: -1 });
                    });
                    selectedEquipment.value = [];
                } else if (toeMode === "personnel") {
                    selectedPersonnel.value.forEach(({ id: itemId }) => {
                        updateUnitPersonnel(unitId, itemId, { count: -1 });
                    });
                    selectedPersonnel.value = [];
                }
            });
        });
        triggerRef(selectedUnitIds);
    }

    function handleNextEditedId(mode: ToeMode, itemId: string) {
        if (!uiStore.goToNextOnSubmit) {
            if (mode === "equipment") {
                editedEquipmentId.value = null;
            } else if (mode === "personnel") {
                editedPersonnelId.value = null;
            }
            return;
        }
        if (mode === "equipment") {
            const currentIndex = aggregatedEquipment.value.findIndex((e) => e.id === itemId);
            if (currentIndex < aggregatedEquipment.value.length - 1) {
                editedEquipmentId.value = aggregatedEquipment.value[currentIndex + 1].id;
            } else {
                editedEquipmentId.value = null;
            }
        } else if (mode === "personnel") {
            const currentIndex = aggregatedPersonnel.value.findIndex((p) => p.id === itemId);
            if (currentIndex < aggregatedPersonnel.value.length - 1) {
                editedPersonnelId.value = aggregatedPersonnel.value[currentIndex + 1].id;
            } else {
                editedPersonnelId.value = null;
            }
        }
    }
</script>

<template>
    <Tabs v-model="uiStore.toeTabIndex" class="w-full gap-0" :unmountOnHide="false">
        <div class="-mx-4">
            <TabsList class="border-border h-12 w-full rounded-none border-b px-4 py-1">
                <TabsTrigger v-for="(lbl, k) in ['Equipment', 'Personnel', 'Supplies']" :key="lbl" :value="k">
                    {{ lbl }}
                </TabsTrigger>
            </TabsList>
        </div>

        <!-- Equipment -->
        <TabsContent :value="0">
            <ToeGridHeader v-model:editMode="isEditMode"
                           v-model:addMode="equipmentEditStore.showAddForm"
                           v-model:includeSubordinates="includeSubordinates"
                           :selectedCount="selectedEquipment.length"
                           @delete="onDeleteItems('equipment')"
                           :isLocked="isLocked" />

            <AddUnitToeItemForm v-if="equipmentEditStore.showAddForm"
                                mode="equipment"
                                :usedItems="isMultiMode ? [] : aggregatedEquipment"
                                @cancel="equipmentEditStore.showAddForm = false"
                                @submit="onAddSubmit('equipment', $event)" />

            <ToeGrid v-if="aggregatedEquipment.length"
                     :columns="equipmentColumns"
                     :data="aggregatedEquipment"
                     :tableStore="unitEquipmentTableStore"
                     v-model:editMode="isEditMode"
                     v-model:editedId="editedEquipmentId"
                     :select="isEditMode"
                     v-model:selected="selectedEquipment"
                     :isLocked="isLocked">
                <template #inline-form="{ row }">
                    <InlineFormWrapper class="pr-6" details-panel>
                        <ModifyUnitToeItemForm :itemData="row"
                                               :heading="row.name"
                                               :editStore="equipmentEditStore"
                                               @cancel="isEditMode = false"
                                               @updateCount="updateItemCount('equipment', $event)"
                                               @updateOnHand="updateItemOnHand('equipment', $event)"
                                               @diffOnHand="diffItemOnHand('equipment', $event)" />
                    </InlineFormWrapper>
                </template>
            </ToeGrid>
        </TabsContent>

        <!-- Personnel -->
        <TabsContent :value="1">
            <ToeGridHeader v-model:editMode="isEditMode"
                           v-model:addMode="personnelEditStore.showAddForm"
                           v-model:includeSubordinates="includeSubordinates"
                           :selectedCount="selectedPersonnel.length"
                           @delete="onDeleteItems('personnel')"
                           :isLocked="isLocked" />

            <!-- Coverage summary: known OK / doctrinal baseline -->
            <div class="mt-3 mb-3 rounded-md border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-950">
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div class="min-w-0">
                        <div class="text-xs text-slate-500 dark:text-slate-400">TO&amp;E/S coverage</div>
                        <div class="font-medium text-slate-800 dark:text-slate-100">
                            Known OK / doctrinal baseline:
                            <span v-if="okCoveragePct != null">{{ okCoveragePct }}%</span>
                            <span v-else class="text-slate-500 dark:text-slate-400">—</span>
                        </div>
                        <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            OK known: {{ knownOkAtTime }} • Doctrinal baseline: {{ doctrinalBaselineTotal || 0 }}
                        </div>
                    </div>
                </div>
            </div>

            <!-- Personnel roster (known) at current scenario time -->
            <div class="mt-3 mb-3 rounded-md border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-950">
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div class="min-w-0">
                        <div class="text-xs text-slate-500 dark:text-slate-400">Personnel at current scenario time</div>
                        <div class="font-medium text-slate-800 dark:text-slate-100">
                            Known: {{ knownRosterAtTime.length }}
                            <span class="text-slate-500 dark:text-slate-400"> | </span>
                            TO&amp;E on-hand: {{ toePersonnelTotals.onHand || toePersonnelTotals.count }}
                            <span class="text-slate-500 dark:text-slate-400"> | </span>
                            Unaccounted: {{ unaccountedAtTime }}
                        </div>
                    </div>

                    <div class="flex items-center gap-3">
                        <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                            <span>Ok: {{ knownStatusCountsAtTime.Ok }}</span>
                            <span>WIA: {{ knownStatusCountsAtTime.WIA }}</span>
                            <span>KIA: {{ knownStatusCountsAtTime.KIA }}</span>
                            <span>POW: {{ knownStatusCountsAtTime.POW }}</span>
                            <span>MIA: {{ knownStatusCountsAtTime.MIA }}</span>
                        </div>

                        <button type="button"
                                class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                                :disabled="isLocked"
                                @click="expandKnownSummary = !expandKnownSummary"
                                title="Toggle expanded personnel summary">
                            {{ expandKnownSummary ? "Collapse" : "Expand" }}
                        </button>
                    </div>
                </div>

                <!-- Only show table when expanded -->
                <div v-if="expandKnownSummary" class="mt-3 overflow-x-auto">
                    <table class="min-w-full border-collapse text-xs">
                        <thead>
                            <tr class="text-left text-slate-500 dark:text-slate-400">
                                <th class="border-b border-slate-200 py-1 pr-4 dark:border-slate-800">Rank</th>
                                <th class="border-b border-slate-200 py-1 pr-3 text-right dark:border-slate-800">OK</th>
                                <th class="border-b border-slate-200 py-1 pr-3 text-right dark:border-slate-800">WIA</th>
                                <th class="border-b border-slate-200 py-1 pr-3 text-right dark:border-slate-800">KIA</th>
                                <th class="border-b border-slate-200 py-1 pr-3 text-right dark:border-slate-800">POW</th>
                                <th class="border-b border-slate-200 py-1 pr-3 text-right dark:border-slate-800">MIA</th>
                                <th class="border-b border-slate-200 py-1 text-right dark:border-slate-800">Total</th>
                            </tr>
                        </thead>

                        <tbody>
                            <tr v-for="r in knownRankStatusRowsAll" :key="r.rank" class="text-slate-800 dark:text-slate-100">
                                <td class="border-b border-slate-100 py-1 pr-4 dark:border-slate-900">{{ r.rank }}</td>
                                <td class="border-b border-slate-100 py-1 pr-3 text-right dark:border-slate-900">{{ r.Ok }}</td>
                                <td class="border-b border-slate-100 py-1 pr-3 text-right dark:border-slate-900">{{ r.WIA }}</td>
                                <td class="border-b border-slate-100 py-1 pr-3 text-right dark:border-slate-900">{{ r.KIA }}</td>
                                <td class="border-b border-slate-100 py-1 pr-3 text-right dark:border-slate-900">{{ r.POW }}</td>
                                <td class="border-b border-slate-100 py-1 pr-3 text-right dark:border-slate-900">{{ r.MIA }}</td>
                                <td class="border-b border-slate-100 py-1 text-right dark:border-slate-900">{{ r.total }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <AddUnitToeItemForm v-if="personnelEditStore.showAddForm"
                                mode="personnel"
                                :usedItems="isMultiMode ? [] : aggregatedPersonnel"
                                @cancel="personnelEditStore.showAddForm = false"
                                @submit="onAddSubmit('personnel', $event)"
                                @delete="onDeleteItems('personnel')" />

            <!-- Doctrinal (authorized) baseline -->
            <div class="mt-3 mb-3 rounded-md border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-950">
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div class="min-w-0">
                        <div class="text-xs text-slate-500 dark:text-slate-400">Doctrinal personnel baseline</div>
                        <div class="font-medium text-slate-800 dark:text-slate-100">
                            Authorized (baseline): {{ baselineTotal }}
                        </div>
                        <div v-if="templateKey" class="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Template: {{ templateKey }}
                        </div>
                    </div>

                    <div class="flex shrink-0 items-center gap-2">
                        <button type="button"
                                class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                                :disabled="isLocked || isMultiMode"
                                @click="openBaselineEditor()"
                                title="Edit doctrinal authorized baseline personnel">
                            Edit baseline…
                        </button>

                        <button type="button"
                                class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                                :disabled="isLocked"
                                @click="expandBaselineSummary = !expandBaselineSummary"
                                title="Toggle expanded doctrinal baseline summary">
                            {{ expandBaselineSummary ? "Collapse" : "Expand" }}
                        </button>
                    </div>
                </div>

                <!-- Only show table(s) when expanded -->
                <div v-if="expandBaselineSummary" class="mt-3 overflow-x-auto">
                    <!-- Larger baseline summary: rank + role breakdown -->
                    <table class="min-w-full border-collapse text-xs">
                        <thead>
                            <tr class="text-left text-slate-500 dark:text-slate-400">
                                <th class="border-b border-slate-200 py-1 pr-4 dark:border-slate-800">Rank</th>
                                <th class="border-b border-slate-200 py-1 pr-4 text-right dark:border-slate-800">Authorized</th>
                                <th class="border-b border-slate-200 py-1 dark:border-slate-800">Role</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="r in baselineRankRoleRowsAll"
                                :key="r.rank + '|' + r.role"
                                class="text-slate-800 dark:text-slate-100">
                                <td class="border-b border-slate-100 py-1 pr-4 dark:border-slate-900">{{ r.rank }}</td>
                                <td class="border-b border-slate-100 py-1 pr-4 text-right dark:border-slate-900">
                                    {{ r.authorized }}
                                </td>
                                <td class="border-b border-slate-100 py-1 dark:border-slate-900">{{ r.role }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <ToeGrid v-if="aggregatedPersonnel.length"
                     :columns="personnelColumns"
                     :data="aggregatedPersonnel"
                     :tableStore="unitPersonnelTableStore"
                     :select="isEditMode"
                     v-model:editMode="isEditMode"
                     v-model:editedId="editedPersonnelId"
                     v-model:selected="selectedPersonnel"
                     :isLocked="isLocked">
                <template #inline-form="{ row }">
                    <InlineFormWrapper class="pr-6" details-panel>
                        <ModifyUnitToeItemForm :itemData="row"
                                               :heading="row.name"
                                               @cancel="isEditMode = false"
                                               :editStore="personnelEditStore"
                                               @updateCount="updateItemCount('personnel', $event)"
                                               @updateOnHand="updateItemOnHand('personnel', $event)"
                                               @diffOnHand="diffItemOnHand('personnel', $event)" />
                    </InlineFormWrapper>
                </template>
            </ToeGrid>
        </TabsContent>

        <!-- Supplies -->
        <TabsContent :value="2">
            <UnitDetailsSupplies :unit="unit" :isLocked="isLocked"></UnitDetailsSupplies>
        </TabsContent>
    </Tabs>

    <!-- "No data" message: only if all three personnel summary cards are effectively blank AND there are no TOE rows -->
    <div class="prose dark:prose-invert p-1">
        <p v-if="
        !aggregatedEquipment.length &&
        !aggregatedPersonnel.length &&
        (!knownRosterAtTime.length && !(toePersonnelTotals.onHand || toePersonnelTotals.count) && !unaccountedAtTime) &&
        (!(doctrinalBaselineTotal || 0) && !(toeAuthorizedTotal || 0) && !(toeOnHandTotal || 0))
      ">
            <span v-if="includeSubordinates">No data about equipment or personnel available</span><span v-else>This unit does not have any equipment or personnel</span>.
        </p>
    </div>
</template>
