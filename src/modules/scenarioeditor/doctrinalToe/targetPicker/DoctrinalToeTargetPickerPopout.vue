<!-- src/modules/scenarioeditor/doctrinalToe/targetPicker/DoctrinalToeTargetPickerPopout.vue -->
<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, triggerRef } from "vue";
import type { EntityId } from "@/types/base";
import type { DoctrinalUnitIndexRow } from "./doctrinalTargetTypes";
import { symbolGenerator } from "@/symbology/milsymbwrapper";

const props = defineProps<{
  title?: string;
  units: DoctrinalUnitIndexRow[];
  initialSelectedIds?: EntityId[];

  // Optional: pass these from UnitDetailsToe to offer quick scoping without recomputing trees here.
  contextSubtreeIds?: EntityId[];
}>();

const _svgCache = shallowRef(new Map<string, string>());

function symbolSvg(u: DoctrinalUnitIndexRow): string {
  const sidc = (u as any).sidc as string | undefined;
  if (!sidc) return "";

  const so = ((u as any).symbolOptions ?? {}) as Record<string, any>;
  const derivedColor = (u as any).fillColor ?? (u as any).hexFill ?? (u as any).color ?? (u as any).hexColor;

  // Cache key should change if sidc or color overrides change
  const key = `${u.id}|${sidc}|${so.fillColor ?? ""}|${so.frameColor ?? ""}|${so.iconColor ?? ""}|${so.color ?? ""}|${derivedColor ?? ""}`;

  const hit = _svgCache.value.get(key);
  if (hit) return hit;

  const opts: any = { size: 28 };

  // Respect common per-unit overrides used elsewhere in the app
  if (so.fillColor) opts.fillColor = so.fillColor;
  if (so.frameColor) opts.frameColor = so.frameColor;
  if (so.iconColor) opts.iconColor = so.iconColor;

  // Some builds use a single "color" for fill; best-effort support
  if (!opts.fillColor && so.color) opts.fillColor = so.color;
  if (!opts.fillColor && derivedColor) opts.fillColor = derivedColor;

  // Generate SVG (transparent background). We will put a white square behind it in the UI.
  const svg = symbolGenerator(sidc, opts).asSVG();
  _svgCache.value.set(key, svg);
  return svg;
}

const emit = defineEmits<{
  (e: "confirm", unitIds: EntityId[]): void;
  (e: "close"): void;
}>();

const q = ref("");
const sideFilter = ref<EntityId | "ALL">("ALL");
const groupFilter = ref<EntityId | "ALL">("ALL");

const selected = ref<Set<EntityId>>(new Set(props.initialSelectedIds ?? []));

function toggleOne(id: EntityId) {
  const s = selected.value;
  if (s.has(id)) s.delete(id);
  else s.add(id);
  triggerRef(selected);
}

function setAll(ids: EntityId[]) {
  selected.value = new Set(ids);
  triggerRef(selected);
}

function clearAll() {
  selected.value = new Set();
  triggerRef(selected);
}

function confirm() {
  emit("confirm", Array.from(selected.value));
}

function close() {
  emit("close");
}

const sideOptions = computed(() => {
  const m = new Map<EntityId, string>();
  for (const u of props.units) {
    if (u.sideId && u.sideName) m.set(u.sideId, u.sideName);
  }
  return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
});

const groupOptions = computed(() => {
  const m = new Map<EntityId, string>();
  for (const u of props.units) {
    if (u.groupId && u.groupName) m.set(u.groupId, u.groupName);
  }
  return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
});

const filtered = computed(() => {
  const text = q.value.trim().toLowerCase();

  return props.units.filter((u) => {
    if (sideFilter.value !== "ALL" && u.sideId !== sideFilter.value) return false;
    if (groupFilter.value !== "ALL" && u.groupId !== groupFilter.value) return false;

    if (!text) return true;

    const name = (u.name ?? "").toLowerCase();
    const short = (u.shortName ?? "").toLowerCase();
    const num = (u.unitNumber ?? "").toLowerCase();

    return name.includes(text) || short.includes(text) || num.includes(text);
  });
});

// --- very lightweight “virtual list” ---
const rowH = 44;
const viewportH = ref(520);
const scrollTop = ref(0);

function onScroll(e: Event) {
  const el = e.target as HTMLElement;
  scrollTop.value = el.scrollTop;
}

const startIndex = computed(() => Math.max(0, Math.floor(scrollTop.value / rowH) - 10));
const endIndex = computed(() => Math.min(filtered.value.length, startIndex.value + Math.ceil(viewportH.value / rowH) + 20));

const visibleSlice = computed(() => filtered.value.slice(startIndex.value, endIndex.value));

const padTop = computed(() => startIndex.value * rowH);
const padBottom = computed(() => Math.max(0, (filtered.value.length - endIndex.value) * rowH));

onMounted(() => {
  // best effort: size based on window, but don’t get fancy
  viewportH.value = Math.max(320, Math.min(720, window.innerHeight - 220));
});
</script>

<template>
  <div class="flex h-full flex-col gap-3 p-4 text-slate-800 dark:bg-slate-950 dark:text-slate-100">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <h2 class="text-base font-semibold">{{ props.title ?? "Select target units" }}</h2>
        <p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          Filter by name / short name / unit number. Icons use each unit’s current color overrides when available.
        </p>
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          class="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          @click="close"
        >
          Close
        </button>

        <button
          type="button"
          class="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white dark:bg-slate-100 dark:text-slate-900"
          @click="confirm"
        >
          Confirm ({{ selected.size }})
        </button>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <input
        v-model="q"
        type="text"
        class="h-9 w-64 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900"
        placeholder="Search…"
      />

      <select
        v-model="sideFilter"
        class="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
      >
        <option value="ALL">All sides</option>
        <option v-for="[id, name] in sideOptions" :key="id" :value="id">{{ name }}</option>
      </select>

      <select
        v-model="groupFilter"
        class="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
      >
        <option value="ALL">All groups</option>
        <option v-for="[id, name] in groupOptions" :key="id" :value="id">{{ name }}</option>
      </select>

      <div class="ml-auto flex items-center gap-2">
        <button
          type="button"
          class="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          @click="clearAll"
        >
          Clear
        </button>

        <button
          type="button"
          class="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          @click="setAll(filtered.map(u => u.id))"
        >
          Select filtered
        </button>
      </div>
    </div>

    <div class="text-xs text-slate-500 dark:text-slate-400">
      Filtered: {{ filtered.length }} — Selected: {{ selected.size }}
    </div>

    <div class="overflow-hidden rounded-md border border-slate-200 dark:border-slate-800">
      <div
        class="overflow-y-auto bg-white dark:bg-slate-950"
        :style="{ height: viewportH + 'px' }"
        @scroll="onScroll"
      >
        <div :style="{ height: padTop + 'px' }"></div>

        <div
          v-for="u in visibleSlice"
          :key="u.id"
          class="flex items-center gap-2 px-2"
          :style="{ height: rowH + 'px' }"
        >
          <input type="checkbox" :checked="selected.has(u.id)" @change="toggleOne(u.id)" />

          <div class="h-9 w-9 shrink-0 rounded border border-slate-300 bg-white p-0.5 dark:border-slate-700">
            <div class="h-full w-full" v-html="symbolSvg(u)"></div>
          </div>

          <div class="min-w-0 flex-1">
            <div class="truncate text-sm text-slate-800 dark:text-slate-100">
              {{ u.name }}
              <span v-if="u.shortName" class="text-slate-500 dark:text-slate-400">({{ u.shortName }})</span>
              <span v-if="u.unitNumber" class="ml-2 text-slate-500 dark:text-slate-400">- {{ u.unitNumber }}</span>
            </div>
            <div class="truncate text-[11px] text-slate-500 dark:text-slate-400">
              <span v-if="u.sideName">{{ u.sideName }}</span>
              <span v-if="u.groupName"> - {{ u.groupName }}</span>
            </div>
          </div>
        </div>

        <div :style="{ height: padBottom + 'px' }"></div>
      </div>
    </div>
  </div>
</template>
