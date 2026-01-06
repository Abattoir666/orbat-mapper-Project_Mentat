<script setup lang="ts">
import { computed, ref } from "vue";
import { STATUS_OPTIONS, STATUS_GLYPH, type PersonnelRow, type PersonnelStatus } from "./personnelTypes";

const props = defineProps<{
  title: string;
  initialRows: PersonnelRow[];
  isLocked: boolean;
}>();

const emit = defineEmits<{
  (e: "apply", rows: PersonnelRow[]): void;
  (e: "save", rows: PersonnelRow[]): void;
  (e: "close"): void;
}>();

function makeId(): string {
  return "prs_" + Date.now() + "_" + Math.random().toString(16).slice(2);
}

function normStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normStatus(v: unknown): PersonnelStatus {
  const s = normStr(v);
  if ((STATUS_OPTIONS as string[]).includes(s)) return s as PersonnelStatus;

  // accept glyphs on paste (optional)
  for (const k of STATUS_OPTIONS) {
    if (STATUS_GLYPH[k] === s) return k;
  }

  const u = s.toUpperCase();
  if (u === "OK") return "Ok";
  if (u === "WIA") return "WIA";
  if (u === "KIA") return "KIA";
  if (u === "POW") return "POW";
  if (u === "MIA") return "MIA";

  return "Ok";
}

function normalizeRow(raw: any): PersonnelRow {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    id: normStr(r.id) || makeId(),
    status: normStatus(r.status),
    rank: normStr(r.rank),
    name: normStr(r.name),
    intakeDate: normStr(r.intakeDate),
    outtakeDate: normStr(r.outtakeDate),
  };
}

const rows = ref<PersonnelRow[]>(props.initialRows.map(normalizeRow));
const editingStatusId = ref<string | null>(null);
const focused = ref<{ row: number; col: number } | null>(null); // col: 0..4

const isLocked = computed(() => !!props.isLocked);

function addRow() {
  rows.value.push({
    id: makeId(),
    status: "Ok",
    rank: "",
    name: "",
    intakeDate: "",
    outtakeDate: "",
  });
}

function removeRow(id: string) {
  rows.value = rows.value.filter((r) => r.id !== id);
}

function setFocus(row: number, col: number) {
  focused.value = { row, col };
}

function rowToTSV(r: PersonnelRow): string {
  return [r.status, r.rank ?? "", r.name ?? "", r.intakeDate ?? "", r.outtakeDate ?? ""].join("\t");
}

function allToTSV(): string {
  return rows.value.map(rowToTSV).join("\n");
}

function ensureRows(count: number) {
  while (rows.value.length < count) addRow();
}

function setCellValue(rIdx: number, cIdx: number, v: string) {
  ensureRows(rIdx + 1);
  const r = rows.value[rIdx];
  if (cIdx === 0) r.status = normStatus(v);
  else if (cIdx === 1) r.rank = v;
  else if (cIdx === 2) r.name = v;
  else if (cIdx === 3) r.intakeDate = v;
  else if (cIdx === 4) r.outtakeDate = v;
}

function applyTSV(startRow: number, startCol: number, tsv: string) {
  const text = (tsv || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n").filter((l) => l.length > 0);

  for (let rOff = 0; rOff < lines.length; rOff++) {
    const cells = lines[rOff].split("\t");
    for (let cOff = 0; cOff < cells.length; cOff++) {
      const cIdx = startCol + cOff;
      if (cIdx > 4) continue;
      setCellValue(startRow + rOff, cIdx, normStr(cells[cOff]));
    }
  }
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
  const start = focused.value ?? { row: 0, col: 0 };
  applyTSV(start.row, start.col, text);
}

function onCellPaste(e: ClipboardEvent, row: number, col: number) {
  const text = e.clipboardData?.getData("text/plain") ?? "";
  if (!text) return;
  e.preventDefault();
  applyTSV(row, col, text);
}

function beginStatusEdit(id: string) {
  if (isLocked.value) return;
  editingStatusId.value = id;
}

function endStatusEdit() {
  editingStatusId.value = null;
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
    <div class="p-3 space-y-3">
        <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
                <h2 class="text-base font-semibold text-slate-800 dark:text-slate-100">{{ title }}</h2>
                <p class="text-xs text-slate-500 dark:text-slate-400">
                    Copy/Paste is TSV-compatible with Excel. Status dropdown appears on double-click.
                </p>
            </div>

            <div class="flex items-center gap-2">
                <button class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                        :disabled="isLocked"
                        @click="addRow">
                    Add row
                </button>

                <button class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                        :disabled="isLocked"
                        @click="apply">
                    Apply
                </button>

                <button class="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                        :disabled="isLocked"
                        @click="save">
                    Save
                </button>

                <button class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                        @click="close">
                    Close
                </button>
            </div>
        </div>

        <div class="overflow-x-auto rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950"
             tabindex="0"
             @copy="onGridCopy"
             @paste="onGridPaste">
            <table class="min-w-full border-collapse text-sm">
                <thead>
                    <tr class="bg-slate-50 text-left text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                        <th class="border-b border-slate-200 px-2 py-2 dark:border-slate-800">Status</th>
                        <th class="border-b border-slate-200 px-2 py-2 dark:border-slate-800">Rank</th>
                        <th class="border-b border-slate-200 px-2 py-2 dark:border-slate-800">Name</th>
                        <th class="border-b border-slate-200 px-2 py-2 dark:border-slate-800">Intake</th>
                        <th class="border-b border-slate-200 px-2 py-2 dark:border-slate-800">Outtake</th>
                        <th class="border-b border-slate-200 px-2 py-2 text-right dark:border-slate-800"></th>
                    </tr>
                </thead>

                <tbody>
                    <tr v-for="(r, rIdx) in rows"
                        :key="r.id"
                        class="odd:bg-white even:bg-slate-50 dark:odd:bg-slate-950 dark:even:bg-slate-900/40">
                        <!-- Status: glyph + dblclick to dropdown -->
                        <td class="border-t border-slate-200 px-1 py-1 dark:border-slate-800">
                            <div v-if="editingStatusId !== r.id"
                                 class="h-9 w-full cursor-default rounded px-2 leading-9 text-left hover:bg-slate-100 dark:hover:bg-slate-800/50"
                                 :title="'Double-click to change status'"
                                 @click="setFocus(rIdx, 0)"
                                 @dblclick="beginStatusEdit(r.id)"
                                 @paste="onCellPaste($event as any, rIdx, 0)">
                                {{ r.status }}
                            </div>

                            <select v-else
                                    v-model="r.status"
                                    class="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-slate-300 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-slate-700"
                                    :disabled="isLocked"
                                    @blur="endStatusEdit"
                                    @change="endStatusEdit">
                                <option v-for="s in STATUS_OPTIONS" :key="s" :value="s">{{ s }}</option>
                            </select>
                        </td>

                        <td class="border-t border-slate-200 px-1 py-1 dark:border-slate-800">
                            <input v-model="r.rank"
                                   type="text"
                                   class="h-9 w-full rounded px-2 outline-none focus:bg-white focus:ring-2 focus:ring-slate-200 disabled:opacity-50 dark:bg-transparent dark:focus:bg-slate-950 dark:focus:ring-slate-800"
                                   :disabled="isLocked"
                                   @focus="setFocus(rIdx, 1)"
                                   @paste="onCellPaste($event as any, rIdx, 1)" />
                        </td>

                        <td class="border-t border-slate-200 px-1 py-1 dark:border-slate-800">
                            <input v-model="r.name"
                                   type="text"
                                   class="h-9 w-full rounded px-2 outline-none focus:bg-white focus:ring-2 focus:ring-slate-200 disabled:opacity-50 dark:bg-transparent dark:focus:bg-slate-950 dark:focus:ring-slate-800"
                                   :disabled="isLocked"
                                   @focus="setFocus(rIdx, 2)"
                                   @paste="onCellPaste($event as any, rIdx, 2)" />
                        </td>

                        <td class="border-t border-slate-200 px-1 py-1 dark:border-slate-800">
                            <input v-model="r.intakeDate"
                                   type="date"
                                   class="h-9 w-full rounded px-2 outline-none focus:bg-white focus:ring-2 focus:ring-slate-200 disabled:opacity-50 dark:bg-transparent dark:focus:bg-slate-950 dark:focus:ring-slate-800"
                                   :disabled="isLocked"
                                   @focus="setFocus(rIdx, 3)"
                                   @paste="onCellPaste($event as any, rIdx, 3)" />
                        </td>

                        <td class="border-t border-slate-200 px-1 py-1 dark:border-slate-800">
                            <input v-model="r.outtakeDate"
                                   type="date"
                                   class="h-9 w-full rounded px-2 outline-none focus:bg-white focus:ring-2 focus:ring-slate-200 disabled:opacity-50 dark:bg-transparent dark:focus:bg-slate-950 dark:focus:ring-slate-800"
                                   :disabled="isLocked"
                                   @focus="setFocus(rIdx, 4)"
                                   @paste="onCellPaste($event as any, rIdx, 4)" />
                        </td>

                        <td class="border-t border-slate-200 px-1 py-1 text-right dark:border-slate-800">
                            <button type="button"
                                    class="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                                    :disabled="isLocked"
                                    @click="removeRow(r.id)"
                                    title="Remove row">
                                X
                            </button>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>
