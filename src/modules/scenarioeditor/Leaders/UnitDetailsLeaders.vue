<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { injectStrict } from "@/utils";
import { activeScenarioKey } from "@/components/injects";
import type { NUnit } from "@/types/internalModels";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { EllipsisVertical } from "lucide-vue-next";

import type { RankGrade, GradeType } from "./rankGrades";
import { DEFAULT_GRADE, normalizeGrade, gradeKey, gradesByType } from "./rankGrades";
import { listProfiles, displayForGrade } from "./rankProfiles";
import { resolveInsigniaUrl } from "./rankAssets";
import { enableMapSet } from "immer";

 enableMapSet();

type UnitUpdateLike = any;

interface LeaderImageRef {
  url?: string;
  dataUri?: string;
  mimeType?: string;
}

interface UnitLeader {
  id: string;
  name: string;
  role?: string;

  grade: RankGrade;
  rankProfileId: string;

  // Optional: full rank title override
  rankOverride?: string;

  callsign?: string;
  start?: string; // yyyy-mm-dd (date input)
  end?: string;   // yyyy-mm-dd (date input)
  notes?: string;

  image?: LeaderImageRef;

  // Optional: external reference (portrait click-through in preview)
  externalUrl?: string;
}

const props = defineProps<{
  unit: NUnit;
  isLocked?: boolean;
}>();

const isLocked = computed(() => !!props.isLocked);

const activeScenario = injectStrict(activeScenarioKey);
const {
  unitActions: { updateUnit },
} = activeScenario;

function makeId(): string {
  return "ldr_" + Date.now() + "_" + Math.random().toString(16).slice(2);
}

function normalizeImage(raw: any): LeaderImageRef {
  if (!raw || typeof raw !== "object") return {};
  return {
    url: typeof raw.url === "string" ? raw.url : "",
    dataUri: typeof raw.dataUri === "string" ? raw.dataUri : "",
    mimeType: typeof raw.mimeType === "string" ? raw.mimeType : "",
  };
}

function normalizeLeader(raw: any): UnitLeader {
  const legacyRankStr = typeof raw?.rank === "string" ? raw.rank : "";
  const rankOverrideStr =
    typeof raw?.rankOverride === "string" ? raw.rankOverride : legacyRankStr;

  const leader: UnitLeader = {
    id: raw?.id || makeId(),
    name: typeof raw?.name === "string" ? raw.name : "",
    role: typeof raw?.role === "string" ? raw.role : "",

    grade: normalizeGrade(raw?.grade ?? raw?.rank),
    rankProfileId:
      typeof raw?.rankProfileId === "string" && raw.rankProfileId
        ? raw.rankProfileId
        : "NONE",

    rankOverride: typeof rankOverrideStr === "string" ? rankOverrideStr : "",

    callsign: typeof raw?.callsign === "string" ? raw.callsign : "",
    start: typeof raw?.start === "string" ? raw.start : "",
    end: typeof raw?.end === "string" ? raw.end : "",
    notes: typeof raw?.notes === "string" ? raw.notes : "",

    image: normalizeImage(raw?.image),

    externalUrl: typeof raw?.externalUrl === "string" ? raw.externalUrl : "",
  };

  leader.grade = normalizeGrade(leader.grade);
  return leader;
}

const leadersLocal = ref<UnitLeader[]>([]);
const expandedById = ref<Record<string, boolean>>({});
const openMenuLeaderId = ref<string | null>(null);
const lastSavedAt = ref<number | null>(null);

const leadersFromUnit = computed<UnitLeader[]>(() => {
  const raw = (props.unit as any)?.leaders as any[] | undefined;
  return (raw || []).map(normalizeLeader);
});

watch(
  () => (props.unit as any)?.id,
  () => {
    // Unit changed: refresh local leaders
    leadersLocal.value = leadersFromUnit.value.map((x) => ({
      ...x,
      grade: { ...x.grade },
      image: x.image ? { ...x.image } : {},
    }));
    expandedById.value = {};
    openMenuLeaderId.value = null;
    lastSavedAt.value = null;
  },
  { immediate: true },
);

function isExpanded(id: string): boolean {
  return !!expandedById.value[id];
}

function toggleExpanded(id: string) {
  expandedById.value = { ...expandedById.value, [id]: !expandedById.value[id] };
  openMenuLeaderId.value = null;
}

function collapseAll() {
  expandedById.value = {};
  openMenuLeaderId.value = null;
}

function isLeaderMenuOpen(id: string) {
  return openMenuLeaderId.value === id;
}

function setLeaderMenuOpen(id: string, open: boolean) {
  openMenuLeaderId.value = open ? id : null;
}

function commit() {
  try {
    const payload: UnitUpdateLike = { leaders: leadersLocal.value.map(normalizeLeader) };
    updateUnit((props.unit as any).id, payload);

    lastSavedAt.value = Date.now();
    collapseAll();
  } catch (err) {
    console.error("[UnitDetailsLeaders] commit failed", err);
    throw err;
  }
}

const savedRecently = computed(() => {
  if (!lastSavedAt.value) return false;
  return Date.now() - lastSavedAt.value < 1200;
});

const isDirty = computed(() => {
  const a = JSON.stringify(leadersLocal.value.map(normalizeLeader));
  const b = JSON.stringify(leadersFromUnit.value.map(normalizeLeader));
  return a !== b;
});

function addLeader() {
  if (props.isLocked) return;
  leadersLocal.value = [
    ...leadersLocal.value,
    normalizeLeader({
      id: makeId(),
      name: "",
      role: "",
      grade: { ...DEFAULT_GRADE },
      rankProfileId: "NONE",
      rankOverride: "",
      callsign: "",
      start: "",
      end: "",
      notes: "",
      image: {},
      externalUrl: "",
    }),
  ];
}

function removeLeader(id: string) {
  if (props.isLocked) return;
  leadersLocal.value = leadersLocal.value.filter((l) => l.id !== id);

  const nextExpanded = { ...expandedById.value };
  delete nextExpanded[id];
  expandedById.value = nextExpanded;

  if (openMenuLeaderId.value === id) openMenuLeaderId.value = null;
}

const profileOptions = computed(() => listProfiles());

function safeGradeType(t: any): GradeType {
  return t === "O" || t === "W" || t === "E" ? t : DEFAULT_GRADE.gradeType;
}

function gradeNumbersFor(l: UnitLeader): number[] {
  const t = safeGradeType((l.grade as any)?.gradeType);
  return gradesByType(t).map((d) => d.gradeNumber);
}

function canonicalGradeKey(l: UnitLeader): string {
  return gradeKey(normalizeGrade(l.grade));
}

function rankFullTitle(l: UnitLeader): string {
  if (l.rankOverride && l.rankOverride.trim()) return l.rankOverride.trim();

  const g = normalizeGrade(l.grade);
  const k = gradeKey(g);
  const disp = displayForGrade(l.rankProfileId, k);

  if (disp && disp.name) return disp.name;
  return k;
}

function formatCallsign(cs: string | undefined): string {
  const t = (cs || "").trim();
  if (!t) return "";
  return '"' + t + '"';
}

function nameLineText(l: UnitLeader): string {
  const rank = rankFullTitle(l);
  const name = (l.name || "").trim() || "Unnamed";
  const cs = formatCallsign(l.callsign);
  return (rank + " " + (cs ? cs + " " : "") + name).trim();
}

function nameLineClass(l: UnitLeader): string {
  const s = nameLineText(l);
  const n = s.length;
  if (n <= 28) return "text-sm";
  if (n <= 40) return "text-xs";
  if (n <= 54) return "text-[11px] leading-4";
  return "text-[10px] leading-4";
}

function insigniaUrl(l: UnitLeader): string | undefined {
  if (l.rankOverride && l.rankOverride.trim()) return undefined;

  const g = normalizeGrade(l.grade);
  const k = gradeKey(g);
  const disp = displayForGrade(l.rankProfileId, k);
  if (!disp || !disp.insigniaImageId) return undefined;

  return resolveInsigniaUrl(disp.insigniaImageId, {
    localBasePath: "/ranks",
    defaultExt: "svg",
  });
}

function onInsigniaImgError(ev: Event) {
  const img = ev.target as HTMLImageElement | null;
  if (img) img.style.display = "none";
}

function leaderImageSrc(l: UnitLeader): string | undefined {
  if (l.image && l.image.dataUri) return l.image.dataUri;
  if (l.image && l.image.url) return l.image.url;
  return undefined;
}

function normalizedExternalUrl(l: UnitLeader): string {
  const t = (l.externalUrl || "").trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  return "https://" + t;
}

function openExternalUrl(l: UnitLeader) {
  const url = normalizedExternalUrl(l);
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function notesPreview(l: UnitLeader): string {
  const t = (l.notes || "").trim();
  if (!t) return "";
  const max = 220;
  if (t.length <= max) return t;
  return t.slice(0, max - 3).trimEnd() + "...";
}

function clearLeaderImage(leaderId: string) {
  if (props.isLocked) return;
  const leader = leadersLocal.value.find((x) => x.id === leaderId);
  if (!leader) return;
  leader.image = {};
}

async function onLeaderFileSelected(ev: Event, leaderId: string) {
  if (props.isLocked) return;

  const input = ev.target as HTMLInputElement | null;
  const file = input?.files?.[0];
  if (!file) return;

  const maxBytes = 350_000;
  if (file.size > maxBytes) {
    alert(
      "Image is too large (" +
        Math.round(file.size / 1024) +
        " KB). Please use an image under " +
        Math.round(maxBytes / 1024) +
        " KB for now."
    );
    if (input) input.value = "";
    return;
  }

  const dataUri = await fileToDataUri(file);

  const leader = leadersLocal.value.find((x) => x.id === leaderId);
  if (!leader) return;

  leader.image = {
    ...(leader.image || {}),
    dataUri: dataUri,
    mimeType: file.type || "",
  };

  if (input) input.value = "";
}

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function onPreviewKeydown(ev: KeyboardEvent, leaderId: string) {
  if (ev.key === "Enter" || ev.key === " ") {
    ev.preventDefault();
    toggleExpanded(leaderId);
  }
}
</script>

<template>
  <div class="mt-4 space-y-4">
    <div class="flex items-center justify-between">
      <div class="min-w-0">
        <h3 class="text-sm font-semibold text-slate-700 dark:text-slate-200">Unit leaders</h3>
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
          :disabled="isLocked || !isDirty"
          @click="commit"
        >
          Save
        </button>

        <button
          type="button"
          class="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          :disabled="isLocked"
          @click="addLeader"
        >
          Add leader
        </button>
      </div>
    </div>

    <p v-if="leadersLocal.length === 0" class="text-sm text-slate-500 dark:text-slate-400">
      No leaders set.
    </p>

    <div
      v-for="l in leadersLocal"
      :key="l.id"
      class="rounded-lg border border-slate-200 dark:border-slate-700"
    >
      <!-- PREVIEW CARD (collapsed) -->
      <div
        v-if="!isExpanded(l.id)"
        class="flex cursor-pointer gap-3 p-3"
        role="button"
        tabindex="0"
        @click="toggleExpanded(l.id)"
        @keydown="onPreviewKeydown($event, l.id)"
      >
        <div class="h-20 w-20 shrink-0 overflow-hidden rounded-md ring-1 ring-slate-200 dark:ring-slate-700">
          <div
            v-if="leaderImageSrc(l)"
            class="h-full w-full"
            :class="(l.externalUrl || '').trim() ? 'cursor-pointer' : ''"
            title="Open external link"
            @click.stop="(l.externalUrl || '').trim() ? openExternalUrl(l) : undefined"
          >
            <img :src="leaderImageSrc(l)" class="h-full w-full object-cover" alt="Leader portrait" />
          </div>

          <div v-else class="flex h-full w-full items-center justify-center text-xs text-slate-400">
            No image
          </div>
        </div>

        <div class="min-w-0 flex-1">
          <!-- Name row -->
          <div class="flex items-center gap-2">
            <div
              class="min-w-0 truncate font-semibold text-slate-800 dark:text-slate-100"
              :class="nameLineClass(l)"
            >
              {{ nameLineText(l) }}
            </div>

            <img
              v-if="insigniaUrl(l)"
              :src="insigniaUrl(l)"
              class="h-5 w-5 opacity-90"
              alt="Rank insignia"
              @error="onInsigniaImgError"
            />
          </div>

          <!-- Role/Grade row + Popout actions -->
          <div class="mt-1 flex items-center justify-between gap-2">
            <div class="min-w-0 text-xs text-slate-500 dark:text-slate-400">
              <span v-if="l.role && l.role.trim()">{{ l.role }}</span>
              <span v-if="l.role && l.role.trim()"> | </span>
              <span>Grade: {{ canonicalGradeKey(l) }}</span>
            </div>

            <Popover :open="isLeaderMenuOpen(l.id)" @update:open="(v) => setLeaderMenuOpen(l.id, v)">
              <PopoverTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8"
                  :disabled="isLocked"
                  aria-label="Leader actions"
                  @click.stop
                >
                  <EllipsisVertical class="h-5 w-5" />
                </Button>
              </PopoverTrigger>

              <PopoverContent class="z-[5000] w-40 p-1 shadow-lg" align="end" side="right" :side-offset="8" @click.stop>
                <button
                  type="button"
                  class="block w-full rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                  @click="toggleExpanded(l.id); setLeaderMenuOpen(l.id, false)"
                >
                  Edit
                </button>

                <div class="my-1 h-px bg-slate-200 dark:bg-slate-700"></div>

                <button
                  type="button"
                  class="block w-full rounded-md px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950/30"
                  :disabled="isLocked"
                  @click="removeLeader(l.id); setLeaderMenuOpen(l.id, false)"
                >
                  Remove
                </button>
              </PopoverContent>
            </Popover>
          </div>

          <!-- Dates row -->
          <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
            <span v-if="(l.start || '').trim() || (l.end || '').trim()">
              {{ l.start || "?" }} - {{ l.end || "?" }}
            </span>
          </div>

          <div v-if="notesPreview(l)" class="mt-2 text-xs text-slate-600 dark:text-slate-300">
            {{ notesPreview(l) }}
          </div>
        </div>
      </div>

      <!-- EDIT PANEL (expanded) -->
      <div v-else class="p-3" @click.stop>
        <div class="mb-3 flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="text-xs font-medium text-slate-500 dark:text-slate-400">Editing</div>
            <div class="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
              {{ nameLineText(l) }}
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button
              type="button"
              class="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              :disabled="isLocked"
              @click="toggleExpanded(l.id)"
            >
              Done
            </button>

            <button
              type="button"
              class="rounded-md px-2 py-1 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950/30"
              :disabled="isLocked"
              @click="removeLeader(l.id)"
            >
              Remove
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label class="block">
            <div class="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">Name</div>
            <input
              v-model="l.name"
              type="text"
              class="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
              :disabled="isLocked"
            />
          </label>

          <label class="block">
            <div class="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">Role</div>
            <input
              v-model="l.role"
              type="text"
              class="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
              :disabled="isLocked"
              placeholder="Commander / XO / S3 / etc."
            />
          </label>

          <label class="block">
            <div class="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">Callsign</div>
            <input
              v-model="l.callsign"
              type="text"
              class="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
              :disabled="isLocked"
            />
          </label>

          <label class="block">
            <div class="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">
              Rank override (optional, full title)
            </div>
            <input
              v-model="l.rankOverride"
              type="text"
              class="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
              :disabled="isLocked"
              placeholder="Captain / Colonel / etc."
            />
          </label>

          <div class="block md:col-span-2">
            <div class="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">Rank / grade</div>

            <div class="grid grid-cols-1 gap-2 md:grid-cols-3">
              <label class="block">
                <div class="mb-1 text-xs text-slate-500 dark:text-slate-400">Grade type</div>
                <select
                  v-model="l.grade.gradeType"
                  class="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
                  :disabled="isLocked"
                >
                  <option value="O">O (Officer)</option>
                  <option value="W">W (Warrant)</option>
                  <option value="E">E (Enlisted)</option>
                </select>
              </label>

              <label class="block">
                <div class="mb-1 text-xs text-slate-500 dark:text-slate-400">Grade number</div>
                <select
                  v-model.number="l.grade.gradeNumber"
                  class="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
                  :disabled="isLocked"
                >
                  <option v-for="n in gradeNumbersFor(l)" :key="n" :value="n">{{ n }}</option>
                </select>
              </label>

              <label class="block">
                <div class="mb-1 text-xs text-slate-500 dark:text-slate-400">Rank profile</div>
                <select
                  v-model="l.rankProfileId"
                  class="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
                  :disabled="isLocked"
                >
                  <option v-for="p in profileOptions" :key="p.id" :value="p.id">{{ p.label }}</option>
                </select>
              </label>
            </div>
          </div>

          <label class="block">
            <div class="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">Start</div>
            <input
              v-model="l.start"
              type="date"
              class="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
              :disabled="isLocked"
            />
          </label>

          <label class="block">
            <div class="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">End</div>
            <input
              v-model="l.end"
              type="date"
              class="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
              :disabled="isLocked"
            />
          </label>

          <div class="block md:col-span-2">
            <div class="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">Portrait</div>

            <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
              <label class="block">
                <div class="mb-1 text-xs text-slate-500 dark:text-slate-400">Image URL</div>
                <input
                  v-model="l.image.url"
                  type="url"
                  class="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
                  :disabled="isLocked"
                  placeholder="https://..."
                />
              </label>

              <label class="block">
                <div class="mb-1 text-xs text-slate-500 dark:text-slate-400">Upload image</div>
                <input
                  type="file"
                  accept="image/*"
                  class="block w-full text-sm"
                  :disabled="isLocked"
                  @change="onLeaderFileSelected($event, l.id)"
                />
              </label>
            </div>

            <div v-if="leaderImageSrc(l)" class="mt-2 flex items-start gap-3">
              <img
                :src="leaderImageSrc(l)"
                class="h-24 w-24 rounded-md object-cover ring-1 ring-slate-200 dark:ring-slate-700"
                alt="Leader portrait"
              />

              <button
                type="button"
                class="rounded-md px-2 py-1 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950/30"
                :disabled="isLocked"
                @click="clearLeaderImage(l.id)"
              >
                Clear image
              </button>
            </div>
          </div>

          <label class="block md:col-span-2">
            <div class="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">External URL</div>
            <input
              v-model="l.externalUrl"
              type="url"
              class="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
              :disabled="isLocked"
              placeholder="https://..."
            />
            <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">
              If set, clicking the portrait in preview opens this link.
            </div>
          </label>

          <label class="block md:col-span-2">
            <div class="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">Notes</div>
            <textarea
              v-model="l.notes"
              rows="4"
              class="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
              :disabled="isLocked"
            />
          </label>
        </div>
      </div>
    </div>
  </div>
</template>
