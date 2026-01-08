﻿<script setup lang="ts">
import { computed, ref, watch, watchEffect } from "vue";
import { Button } from "@/components/ui/button";
import { injectStrict } from "@/utils";
import { activeScenarioKey } from "@/components/injects";

import PersonnelSpreadsheetPopout from "./PersonnelSpreadsheetPopout.vue";
import {
  STATUS_GLYPH,
  type PersonnelRow,
  normalizePersonnelRow,
  flagsAtTimeMs,
  statusFromFlags,
  leaderSortKey,
  gradeSortKey,
} from "./personnelTypes";

import { listProfiles, displayForGrade } from "@/modules/scenarioeditor/Leaders/rankProfiles";
import { DEFAULT_GRADE, normalizeGrade } from "@/modules/scenarioeditor/Leaders/rankGrades";

const props = defineProps<{
  unit: any;
  isLocked: boolean;
}>();

const activeScenario = injectStrict(activeScenarioKey);
const {
  unitActions: { updateUnit },
  time,
} = activeScenario;

const scenarioTimeMs = computed(() => {
  // In your app this is already a number (ms). Coerce defensively.
  const n = +time.scenarioTime.value;
  return Number.isFinite(n) ? n : Date.now();
});

function normalizeRoster(raw: any): PersonnelRow[] {
  return Array.isArray(raw) ? raw.map(normalizePersonnelRow).filter((r) => !!r.id) : [];
}

const localRows = ref<PersonnelRow[]>(normalizeRoster((props.unit as any)?.personnelRoster));

watch(
  () => (props.unit as any)?.personnelRoster,
  (v) => {
    localRows.value = normalizeRoster(v);
  },
  { immediate: true },
);

// --- leaders auto-import ---
function leaderToPersonnelRow(raw: any): PersonnelRow | null {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id : "";
  const name = typeof raw.name === "string" ? raw.name : "";
  if (!id || !name) return null;

  const grade = normalizeGrade(raw.grade ?? DEFAULT_GRADE);
  const profile = listProfiles().find((p) => p.id === raw.rankProfileId) ?? listProfiles()[0];
  const rankOverride = typeof raw.rankOverride === "string" ? raw.rankOverride.trim() : "";
  const rank = rankOverride || displayForGrade(grade, profile);

  return normalizePersonnelRow({
    id,
    name,
    rank,
    grade,
    isLeader: true,
    // default legacy window (optional)
    intakeDate: raw.intakeDate ?? "",
    outtakeDate: raw.outtakeDate ?? "",
    // prefer flagsHistory for new model; keep legacy fields empty
    status: "Ok",
    statusHistory: [],
  });
}

const didAutoImport = ref(false);

watchEffect(() => {
  if (didAutoImport.value) return;
  if (props.isLocked) return;

  const leaders = Array.isArray((props.unit as any)?.leaders) ? (props.unit as any).leaders : [];
  if (!leaders.length) {
    didAutoImport.value = true;
    return;
  }

  const roster = normalizeRoster((props.unit as any)?.personnelRoster);
  const existing = new Set(roster.map((r) => r.id));

  const toAdd: PersonnelRow[] = [];
  for (const l of leaders) {
    const pr = leaderToPersonnelRow(l);
    if (!pr) continue;
    if (existing.has(pr.id)) continue;
    toAdd.push(pr);
  }

  if (!toAdd.length) {
    didAutoImport.value = true;
    return;
  }

  const merged = [...roster, ...toAdd].map(normalizePersonnelRow);
  localRows.value = merged;

  updateUnit((props.unit as any).id, { personnelRoster: merged });
  didAutoImport.value = true;
});

// --- summary (leaders first by rank, then others) ---
const summaryRowsSorted = computed(() => {
  const t = scenarioTimeMs.value;

  return [...(localRows.value ?? [])]
    .filter((r) => !!r.id)
    .sort((a, b) => {
  const aK = gradeSortKey(a);
  const bK = gradeSortKey(b);
  if (aK !== bK) return bK - aK; // desc

  // Optional: leaders above non-leaders inside same grade
  const aLeader = !!a.isLeader;
  const bLeader = !!b.isLeader;
  if (aLeader !== bLeader) return aLeader ? -1 : 1;

  const ar = (a.rank || "").localeCompare(b.rank || "");
  if (ar !== 0) return ar;

  return (a.name || "").localeCompare(b.name || "");
})
    .map((r) => {
      const flags = flagsAtTimeMs(r, t);
      return {
        ...r,
        _flagsAtTime: flags,
        _statusAtTime: statusFromFlags(flags),
        _inRollsAtTime: !!flags.InRolls,
      };
    });
});

// ---------------------------
// Modeless in-app editor panel (draggable + resizable)
// ---------------------------
const editorOpen = ref(false);
const editorZ = ref(9999);

const editorPos = ref({ x: 140, y: 120 });
const editorSize = ref({ w: 900, h: 520 });

let dragOn = false;
let dragStart = { x: 0, y: 0, left: 0, top: 0 };

function onDragStart(e: MouseEvent) {
  if (props.isLocked) return;
  dragOn = true;
  dragStart = { x: e.clientX, y: e.clientY, left: editorPos.value.x, top: editorPos.value.y };
  e.preventDefault();
  e.stopPropagation();
}

function onDragMove(e: MouseEvent) {
  if (!dragOn) return;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  editorPos.value = { x: dragStart.left + dx, y: dragStart.top + dy };
  clampPanel();
}

function onDragEnd() {
  dragOn = false;
}

let resizeOn = false;
let resizeStart = { x: 0, y: 0, w: 0, h: 0 };

function onResizeStart(e: MouseEvent) {
  if (props.isLocked) return;
  resizeOn = true;
  resizeStart = { x: e.clientX, y: e.clientY, w: editorSize.value.w, h: editorSize.value.h };
  e.preventDefault();
  e.stopPropagation();
}

function onResizeMove(e: MouseEvent) {
  if (!resizeOn) return;
  const dx = e.clientX - resizeStart.x;
  const dy = e.clientY - resizeStart.y;
  editorSize.value = {
    w: Math.max(640, resizeStart.w + dx),
    h: Math.max(320, resizeStart.h + dy),
  };
  clampPanel();
}

function onResizeEnd() {
  resizeOn = false;
}

function bringEditorToFront() {
  editorZ.value += 1;
}

function openEditor() {
  if (props.isLocked) return;
  editorOpen.value = true;
  bringEditorToFront();
}

function closeEditor() {
  editorOpen.value = false;
  dragOn = false;
  resizeOn = false;
}

function clampPanel() {
  // Keep panel on-screen-ish after resizes / moves.
  editorPos.value.x = Math.max(0, Math.min(window.innerWidth - 220, editorPos.value.x));
  editorPos.value.y = Math.max(0, Math.min(window.innerHeight - 120, editorPos.value.y));
  editorSize.value.w = Math.max(640, Math.min(window.innerWidth - editorPos.value.x - 10, editorSize.value.w));
  editorSize.value.h = Math.max(320, Math.min(window.innerHeight - editorPos.value.y - 10, editorSize.value.h));
}

function onGlobalMouseMove(e: MouseEvent) {
  onDragMove(e);
  onResizeMove(e);
}

function onGlobalMouseUp() {
  onDragEnd();
  onResizeEnd();
}

window.addEventListener("mousemove", onGlobalMouseMove);
window.addEventListener("mouseup", onGlobalMouseUp);

function applyRows(rows: PersonnelRow[]) {
  const normalized = (rows ?? []).map(normalizePersonnelRow);
  localRows.value = normalized;
  updateUnit((props.unit as any).id, { personnelRoster: normalized });
}

function saveRows(rows: PersonnelRow[]) {
  // In your app, updateUnit writes into the scenario store and persists via your normal mechanism.
  applyRows(rows);
}

// Re-clamp if the window changes while editor is open
window.addEventListener("resize", () => {
  if (!editorOpen.value) return;
  clampPanel();
});
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-sm font-medium text-slate-900 dark:text-slate-100">Personnel</div>
        <div class="text-xs text-slate-500 dark:text-slate-400">
          Summary is time-sensitive (scenario time). Use the modeless editor to scrub time and edit statuses quickly.
        </div>
      </div>

      <div class="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" @click="openEditor" :disabled="isLocked">
          Open spreadsheet editor
        </Button>
      </div>
    </div>

    <div class="rounded-md border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-950">
      <div v-if="summaryRowsSorted.length === 0" class="text-slate-500 dark:text-slate-400">
        No personnel yet.
      </div>

      <div v-else class="space-y-1">
        <div v-for="p in summaryRowsSorted" :key="p.id" class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <span class="mr-2 inline-flex w-5 justify-center" :title="p._statusAtTime">
              {{ STATUS_GLYPH[p._statusAtTime] }}
            </span>

            <span class="text-slate-900 dark:text-slate-100">
              <span v-if="p.rank" class="mr-2 text-slate-600 dark:text-slate-300">{{ p.rank }}</span>
              <span class="font-medium">{{ p.name || "(unnamed)" }}</span>
              <span v-if="p.isLeader" class="ml-2 text-xs text-slate-500 dark:text-slate-400">(leader)</span>
            </span>
          </div>

          <div class="shrink-0 text-xs text-slate-500 dark:text-slate-400">
            <span v-if="p._flagsAtTime?.KIA">KIA</span>
            <span v-else-if="!p._inRollsAtTime">out of rolls</span>
            <span v-else-if="p.intakeDate || p.outtakeDate">
              {{ p.intakeDate || "?" }} → {{ p.outtakeDate || "?" }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <div class="text-xs text-slate-500 dark:text-slate-400">
      Tip: Apply/Save in the editor updates the unit roster immediately (so TO&amp;E/S and other views can stay in sync).
    </div>
  </div>

  <!-- Modeless floating editor panel -->
  <Teleport to="body">
    <div
      v-if="editorOpen"
      class="fixed rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950"
      :style="{
        left: editorPos.x + 'px',
        top: editorPos.y + 'px',
        width: editorSize.w + 'px',
        height: editorSize.h + 'px',
        zIndex: editorZ,
      }"
      @mousedown="bringEditorToFront"
    >
      <!-- Panel layout: header + body (flex so body fits and scrolls) -->
      <div class="flex h-full min-h-0 flex-col">
        <!-- Drag handle / header -->
        <div
          class="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-3 dark:border-slate-800"
          @mousedown.left="onDragStart"
        >
          <div class="min-w-0 truncate text-sm font-medium text-slate-900 dark:text-slate-100">
            Personnel – {{ (unit as any)?.name ?? "" }}
            <span class="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">(modeless)</span>
          </div>

          <div class="flex items-center gap-2">
            <button
              type="button"
              class="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
              @click.stop="closeEditor"
              title="Close editor"
            >
              Close
            </button>
          </div>
        </div>

        <!-- Body -->
        <div class="min-h-0 flex-1 overflow-auto p-3">
          <PersonnelSpreadsheetPopout
            :title="`Personnel – ${(unit as any)?.name ?? ''}`"
            :initialRows="localRows"
            :isLocked="isLocked"
            :scenarioTimeMs="scenarioTimeMs"
            @apply="applyRows"
            @save="saveRows"
          />
        </div>

        <!-- Resize handle -->
        <div
          class="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize select-none"
          @mousedown.left="onResizeStart"
          title="Resize"
        />
      </div>
    </div>
  </Teleport>
</template>
