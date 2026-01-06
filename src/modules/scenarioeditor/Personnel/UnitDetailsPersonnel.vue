<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { injectStrict } from "@/utils";
import { activeScenarioKey } from "@/components/injects";
import type { NUnit } from "@/types/internalModels";
import { openPersonnelPopout } from "./openPersonnelPopout";
import { STATUS_GLYPH, STATUS_OPTIONS, type PersonnelRow, type PersonnelStatus } from "./personnelTypes";

const props = defineProps<{
  unit: NUnit;
  isLocked?: boolean;
}>();

const isLocked = computed(() => !!props.isLocked);

const activeScenario = injectStrict(activeScenarioKey);
const {
  unitActions: { updateUnit },
} = activeScenario;

const didLeaderAutoMerge = ref(false);

function makeId(): string {
  return "prs_" + Date.now() + "_" + Math.random().toString(16).slice(2);
}

function normStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normStatus(v: unknown): PersonnelStatus {
  const s = normStr(v);
  if ((STATUS_OPTIONS as string[]).includes(s)) return s as PersonnelStatus;
  const u = s.toUpperCase();
  if (u === "OK") return "Ok";
  if (u === "WIA") return "WIA";
  if (u === "KIA") return "KIA";
  if (u === "POW") return "POW";
  if (u === "MIA") return "MIA";
  return "Ok";
}

function gradeScore(g?: { gradeType?: string; gradeNumber?: number } | null): number {
  if (!g) return -1;
  const t = g.gradeType;
  const n = Number.isFinite(g.gradeNumber) ? (g.gradeNumber as number) : -1;

  // Officers > Warrant > Enlisted
  const w = t === "O" ? 3 : t === "W" ? 2 : t === "E" ? 1 : 0;

  // Higher gradeNumber = higher rank within the type
  return w * 100 + n;
}

const leaderById = computed(() => {
  const leaders = (props.unit as any).leaders;
  const m = new Map<string, any>();
  if (Array.isArray(leaders)) {
    for (const l of leaders) {
      if (l?.id != null) m.set(String(l.id), l);
    }
  }
  return m;
});


function normalizeRow(raw: any): PersonnelRow {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    id: normStr(r.id) || makeId(),
    status: normStatus(r.status),
    rank: normStr(r.rank),
    name: normStr(r.name),
    intakeDate: normStr(r.intakeDate || r.start || r.intake),
    outtakeDate: normStr(r.outtakeDate || r.end || r.outtake),
  };
}

function rosterFromUnit(): PersonnelRow[] {
  const raw = (props.unit as any).personnelRoster;
  return Array.isArray(raw) ? raw.map(normalizeRow) : [];
}

function gradeToRankString(g: any): string {
  if (!g || typeof g !== "object") return "";
  const t = typeof g.gradeType === "string" ? g.gradeType : "";
  const n = Number.isFinite(g.gradeNumber) ? g.gradeNumber : NaN;
  if (!t || !Number.isFinite(n)) return "";
  return `${t}-${n}`;
}

function leaderToRow(l: any): PersonnelRow {
  const rankOverride = normStr(l?.rankOverride);
  const legacyRank = normStr(l?.rank);
  const derived = gradeToRankString(l?.grade);

  return {
    id: normStr(l?.id) || makeId(),
    status: "Ok",
    rank: rankOverride || legacyRank || derived || "",
    name: normStr(l?.name),
    intakeDate: normStr(l?.start),
    outtakeDate: normStr(l?.end),
  };
}

const localRows = ref<PersonnelRow[]>([]);
const importedHint = ref(false);
const lastSavedAt = ref<number | null>(null);

watch(
  () => (props.unit as any)?.id,
  () => {
    localRows.value = rosterFromUnit();
    importedHint.value = false;
    lastSavedAt.value = null;
  },
  { immediate: true },
);

watch(
  () => [(props.unit as any).leaders, isLocked.value] as const,
  () => {
    if (isLocked.value) return;

    const leaders = (props.unit as any).leaders;
    if (!Array.isArray(leaders) || leaders.length === 0) return;

    // Build leader-derived rows
    const incoming = leaders.map(leaderToRow).map(normalizeRow);

    // Build indices for existing personnel
    const byId = new Map(localRows.value.map((r) => [r.id, r]));
    const byName = new Map(
      localRows.value
        .filter((r) => r.name)
        .map((r) => [r.name.trim().toLowerCase(), r]),
    );

    let added = 0;

    for (const inc of incoming) {
      const nameKey = (inc.name || "").trim().toLowerCase();

      // Try to match by id first, then by name (case-insensitive)
      const existing = (inc.id && byId.get(inc.id)) || (nameKey && byName.get(nameKey));

      if (!existing) {
        localRows.value.push(inc);
        added++;
        if (inc.id) byId.set(inc.id, inc);
        if (nameKey) byName.set(nameKey, inc);
        continue;
      }

      // Optional gentle merge (fills blanks only; never overwrites user-entered fields)
      if (!existing.rank && inc.rank) existing.rank = inc.rank;
      if (!existing.intakeDate && inc.intakeDate) existing.intakeDate = inc.intakeDate;
      if (!existing.outtakeDate && inc.outtakeDate) existing.outtakeDate = inc.outtakeDate;
    }

    if (added > 0) {
      importedHint.value = true; // reuse your existing banner text
      didLeaderAutoMerge.value = true;
    } else if (!didLeaderAutoMerge.value) {
      // Even if nothing was added, mark as processed so we don't treat the first run as "special"
      didLeaderAutoMerge.value = true;
    }
  },
  { immediate: true },
);


const isDirty = computed(() => {
  const a = JSON.stringify(localRows.value.map((r) => ({ ...r, status: normStatus(r.status) })));
  const b = JSON.stringify(rosterFromUnit().map((r) => ({ ...r, status: normStatus(r.status) })));
  return a !== b;
});

const savedRecently = computed(() => {
  if (!lastSavedAt.value) return false;
  return Date.now() - lastSavedAt.value < 1200;
});

function commit(rows?: PersonnelRow[]) {
  const toSave = (rows ?? localRows.value).map(normalizeRow);
  localRows.value = toSave;

  updateUnit((props.unit as any).id, { personnelRoster: toSave } as any);

  lastSavedAt.value = Date.now();
  importedHint.value = false;
}

const summaryRowsSorted = computed(() => {
  const leadersMap = leaderById.value;

  const indexed = localRows.value.map((r, idx) => {
    const id = String((r as any).id ?? "");
    const leader = leadersMap.get(id);
    const isLeader = !!leader;

    const score = isLeader
      ? gradeScore(leader?.grade ?? (r as any).grade)
      : gradeScore((r as any).grade);

    return { r, idx, isLeader, score };
  });

  const leadersFirst = indexed
    .filter((x) => x.isLeader)
    .sort((a, b) => {
      // highest rank first
      const ds = (b.score - a.score);
      if (ds) return ds;

      // tie-break: name (stable-ish)
      const an = String((a.r as any).name ?? "");
      const bn = String((b.r as any).name ?? "");
      const dn = an.localeCompare(bn);
      if (dn) return dn;

      // final tie-break: original order
      return a.idx - b.idx;
    });

  const nonLeaders = indexed
    .filter((x) => !x.isLeader)
    // preserve original order for non-leaders to avoid surprising reorders
    .sort((a, b) => a.idx - b.idx);

  return [...leadersFirst, ...nonLeaders].map((x) => x.r);
});

function importFromLeaders() {
  if (isLocked.value) return;

  const leaders = (props.unit as any).leaders;
  if (!Array.isArray(leaders) || leaders.length === 0) return;

  const existingNames = new Set(localRows.value.map((r) => (r.name || "").trim().toLowerCase()));
  const incoming = leaders
    .map(leaderToRow)
    .map(normalizeRow)
    .filter((r) => {
      const key = (r.name || "").trim().toLowerCase();
      if (!key) return true;
      if (existingNames.has(key)) return false;
      existingNames.add(key);
      return true;
    });

  if (incoming.length === 0) return;

  localRows.value = [...localRows.value, ...incoming];
  importedHint.value = true;
}

function openEditor() {
  openPersonnelPopout({
    title: `Personnel - ${props.unit?.name ?? ""}`,
    initialRows: localRows.value.map(normalizeRow),
    isLocked: isLocked.value,
    onApply: (rows) => {
      localRows.value = rows.map(normalizeRow);
      importedHint.value = false;
    },
    onSave: (rows) => commit(rows),
  });
}
</script>

<template>
  <div class="mt-4 space-y-3">
    <div class="flex items-center justify-between gap-2">
      <div class="min-w-0">
        <h3 class="text-sm font-semibold text-slate-700 dark:text-slate-200">Personnel</h3>
        <div class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          <span v-if="isDirty">Unsaved changes</span>
          <span v-else-if="savedRecently">Saved</span>
          <span v-else>&nbsp;</span>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          :disabled="isLocked"
          @click="importFromLeaders"
          title="Import basic rows from Leaders (non-destructive; appends new names)"
        >
          Import
        </button>

        <button
          type="button"
          class="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          :disabled="isLocked"
          @click="openEditor"
        >
          Edit...
        </button>

        <button
          type="button"
          class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          :disabled="isLocked || !isDirty"
          @click="commit()"
        >
          Save
        </button>
      </div>
    </div>

    <div
      v-if="importedHint"
      class="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200"
    >
      Imported leaders into the list. Click Save to persist.
    </div>

    <div v-if="localRows.length === 0" class="text-sm text-slate-500 dark:text-slate-400">
      No personnel entries yet. Use Import or Edit...
    </div>

    <div v-else class="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
      <table class="min-w-full border-collapse text-sm">
        <thead>
          <tr class="bg-slate-50 text-left text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
            <th class="border-b border-slate-200 px-2 py-2 dark:border-slate-800">Status</th>
            <th class="border-b border-slate-200 px-2 py-2 dark:border-slate-800">Rank</th>
            <th class="border-b border-slate-200 px-2 py-2 dark:border-slate-800">Name</th>
            <th class="border-b border-slate-200 px-2 py-2 dark:border-slate-800">Intake</th>
            <th class="border-b border-slate-200 px-2 py-2 dark:border-slate-800">Outtake</th>
          </tr>
        </thead>

        <tbody>
          <tr
            v-for="r in summaryRowsSorted"
            :key="r.id"
            class="border-t border-slate-200 dark:border-slate-800"
          >
            <td class="px-2 py-2 text-center" :title="r.status">{{ STATUS_GLYPH[r.status] }}</td>
            <td class="px-2 py-2">{{ r.rank }}</td>
            <td class="px-2 py-2">{{ r.name }}</td>
            <td class="px-2 py-2">{{ r.intakeDate }}</td>
            <td class="px-2 py-2">{{ r.outtakeDate }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="text-xs text-slate-500 dark:text-slate-400">
      Edit is in a pop-out spreadsheet window to avoid space conflicts in the panel.
    </div>
  </div>
</template>
