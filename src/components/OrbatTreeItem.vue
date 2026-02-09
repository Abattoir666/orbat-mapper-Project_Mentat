<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
  attachInstruction,
  extractInstruction,
  type Instruction,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item";
import type { CleanupFn } from "@atlaskit/pragmatic-drag-and-drop/types";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { ChevronRightIcon } from "@heroicons/vue/20/solid";
import { IconLockOutline } from "@iconify-prerendered/vue-mdi";
import { useActiveUnitStore } from "@/stores/dragStore";
import { type UnitAction } from "@/types/constants";
import DotsMenu from "./DotsMenu.vue";
import { useUnitMenu } from "@/composables/scenarioActions";
import { useSettingsStore } from "@/stores/settingsStore";
import { activeParentKey, activeScenarioKey } from "./injects";
import type { NOrbatItemData, NUnit } from "@/types/internalModels";
import MilitarySymbol from "@/components/NewMilitarySymbol.vue";
import { type SymbolOptions } from "milsymbol";
import { injectStrict } from "@/utils";
import { useSelectedItems } from "@/stores/selectedStore";
import { useTimeoutFn } from "@vueuse/core";
import TreeDropIndicator from "@/components/TreeDropIndicator.vue";
import { getUnitDragItem, isUnitDragItem } from "@/types/draggables";
import { mapReinforcedStatus2Field } from "@/types/scenarioModels";

// Helper: pack multiple ids into a DnD payload
function beginDrag(e: DragEvent, unitIds: string[]) {
  if (!e.dataTransfer) return;
  const payload = { kind: "orbat/units", unitIds, source: "sidebar" };
  e.dataTransfer.setData("application/x-orbat-units", JSON.stringify(payload));
  e.dataTransfer.effectAllowed = "move";
}

// Helper: read payload back
function readPayload(e: DragEvent) {
  try {
    const raw = e.dataTransfer?.getData("application/x-orbat-units") || "";
    const p = JSON.parse(raw);
    return p?.kind === "orbat/units" ? p : null;
  } catch {
    return null;
  }
}

// Minimal move utility: re-parent to a unit or a group
function moveUnitsInScenario(state: any, unitIds: string[], target: { type: "unit"; parentUnitId: string } | { type: "group"; groupId: string; sideId: string }) {
  const s = state;
  const uMap = s.unitMap ||= {};
  const gMap = s.groupMap ||= {};
  const sg  = s.sideGroupMap ||= {};

  function detach(uid: string) {
    const u = uMap[uid]; if (!u) return;
    // remove from prior parent unit subUnits
    const pid = u._pid;
    if (pid && uMap[pid]?.subUnits) {
      uMap[pid].subUnits = uMap[pid].subUnits.filter((x: any) => (x?.id ?? x) !== uid);
    }
    // remove from all groups’ subUnits (safe, cheap)
    Object.values(gMap).forEach((g: any) => {
      if (Array.isArray(g?.subUnits)) g.subUnits = g.subUnits.filter((x: any) => (x?.id ?? x) !== uid);
    });
    Object.values(sg).forEach((node: any) => {
      if (Array.isArray(node?.subUnits)) node.subUnits = node.subUnits.filter((x: any) => (x?.id ?? x) !== uid);
    });
  }

  function attachToParent(uid: string, parentId: string) {
    const p = uMap[parentId] ||= { id: parentId, type: "unit", name: parentId, subUnits: [], equipment: [], personnel: [] };
    p.subUnits ||= [];
    if (!p.subUnits.includes(uid)) p.subUnits.push(uid);
    const u = uMap[uid]; if (u) u._pid = parentId;
  }

  function attachToGroup(uid: string, groupId: string, sideId: string) {
    const g = gMap[groupId] ||= { id: groupId, type: "group", name: "Units", subUnits: [] };
    const gNode = sg[groupId] ||= { id: groupId, type: "group", name: g.name, subUnits: g.subUnits };
    const sideNode = sg[sideId] ||= { id: sideId, groups: [], subUnits: [] };

    if (!g.subUnits.includes(uid)) g.subUnits.push(uid);
    gNode.subUnits ||= g.subUnits;
    if (!gNode.subUnits.includes(uid)) gNode.subUnits.push(uid);

    if (!sideNode.groups.some((x: any) => (x?.id ?? x) === groupId)) sideNode.groups.push(gNode);

    const u = uMap[uid]; if (!u) return;
    u._pid = groupId; u.groupId = groupId; u.sideId = sideId;
  }

  for (const uid of unitIds) {
    detach(uid);
    if (target.type === "unit") attachToParent(uid, target.parentUnitId);
    else attachToGroup(uid, target.groupId, target.sideId);
  }

  s.unitStateCounter = (s.unitStateCounter ?? 0) + 1;
  s.featureStateCounter = (s.featureStateCounter ?? 0) + 1;
}


// START drag: include multi-selection if your app tracks it, else just this unit
function onDragStart(e: DragEvent) {
  const ids =
    // if you already keep a Set of selected ids somewhere, use it here:
    (window as any).__selectedUnitIds?.size
      ? Array.from((window as any).__selectedUnitIds)
      : [props.item.unit.id];
  beginDrag(e, ids.filter(Boolean) as string[]);
}

function onDragOver(e: DragEvent) {
  e.preventDefault();
  e.dataTransfer!.dropEffect = "move";
}

// Drop ON a unit → make dragged units children of THIS unit
function onDrop(e: DragEvent) {
  e.preventDefault();
  const p = readPayload(e);
  if (!p || !p.unitIds?.length) return;
  store.update((state: any) => {
    moveUnitsInScenario(state, p.unitIds, { type: "unit", parentUnitId: props.item.unit.id });
  });
}


interface Props {
  item: NOrbatItemData;
  symbolOptions?: SymbolOptions;
  level?: number;
  lastInGroup?: boolean;
}

interface Emits {
  (e: "unit-action", unit: NUnit, action: UnitAction): void;
  (e: "unit-click", unit: NUnit, event: MouseEvent): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const activeParentId = injectStrict(activeParentKey);
const {
  store,     
  unitActions: { isUnitLocked },
} = injectStrict(activeScenarioKey);

const combinedOptions = computed(() => ({
  ...(props.symbolOptions || {}),
  ...(props.item.unit.symbolOptions || {}),
  outlineWidth: 8,
}));

let subTree = ref<HTMLElement | null>(null);
const itemRef = ref<HTMLElement | null>(null);
const dragItemRef = ref<HTMLElement | null>(null);

let isDragged = ref(false);
const isDragOver = ref(false);

const unit = computed(() => props.item.unit);
const isOpen = computed({
  get(): boolean {
    return !!props.item.unit._isOpen;
  },
  set(v: boolean) {
    props.item.unit._isOpen = v;
  },
});

const isLocked = computed(() => isUnitLocked(props.item.unit.id));
const isSideGroupLocked = computed(() =>
  isUnitLocked(props.item.unit.id, { excludeUnit: true }),
);
const {
  isPending,
  start: startOpenTimeout,
  stop: stopOpenTimeout,
} = useTimeoutFn(
  () => {
    isOpen.value = true;
  },
  500,
  { immediate: false },
);

const settingsStore = useSettingsStore();
const { selectedUnitIds, activeUnitId } = useSelectedItems();

const unitLabel = computed(() =>
  settingsStore.orbatShortName
    ? unit.value.shortName || unit.value.name
    : unit.value.name,
);

const activeUnitStore = useActiveUnitStore();

const isActiveUnit = computed(() => activeUnitId.value === props.item.unit.id);
const isActiveParent = computed(() => activeParentId.value === props.item.unit.id);

const hasActiveChildren = computed(() =>
  activeUnitStore.activeUnitParentIds.value.includes(props.item.unit.id),
);

const { unitMenuItems: menuItems } = useUnitMenu(props.item, isLocked, isSideGroupLocked);

let dndCleanup: CleanupFn = () => {};
const instruction = ref<Instruction | null>(null);

onMounted(() => {
  if (!itemRef.value || !dragItemRef.value) return;
  dndCleanup = combine(
    draggable({
      element: dragItemRef.value,
      canDrag: () => !isUnitLocked(props.item.unit.id),
        getInitialData: () => {
            const base = getUnitDragItem({ unit: props.item.unit });
            // If multiple are selected and include this one, send them all; else just this one
            const unitIds = (selectedUnitIds.value?.size && selectedUnitIds.value.has(props.item.unit.id))
                ? Array.from(selectedUnitIds.value)
                : [props.item.unit.id];
            return { ...base, unitIds };
        },
      onDragStart: () => (isDragged.value = true),
      onDrop: () => (isDragged.value = false),
    }),

    dropTargetForElements({
      element: itemRef.value,
      getData: ({ input, element }) => {
        const data = getUnitDragItem({ unit: props.item.unit });
        return attachInstruction(data, {
          input,
          element,
          currentLevel: props.level ?? 0,
          indentPerLevel: 20,
          block: ["reparent"],
          mode:
            isParent.value && isOpen.value
              ? "expanded"
              : props.lastInGroup
                ? "last-in-group"
                : "standard",
        });
      },
      canDrop: ({ source }) => {
        return (
          !isUnitLocked(props.item.unit.id) &&
          isUnitDragItem(source.data) &&
          source.data.unit.id !== props.item.unit.id &&
          props.item.unit._pid !== source.data.unit.id
        );
      },
      onDragEnter: ({ self }) => {
        isDragOver.value = true;
      },
      onDrag: (args) => {
        instruction.value = extractInstruction(args.self.data);
        if (
          instruction.value?.type === "make-child" &&
          isParent.value &&
          !isOpen.value &&
          !isPending.value
        ) {
          startOpenTimeout();
        }

        if (instruction.value?.type !== "make-child" && isPending.value) {
          stopOpenTimeout();
        }
      },
      onDragLeave: () => {
        isDragOver.value = false;
        instruction.value = null;
        stopOpenTimeout();
      },
        onDrop: (args) => {
            isDragOver.value = false;
            instruction.value = null;
            stopOpenTimeout();

            if (isUnitDragItem(args.source.data)) {
                const data: any = args.source.data;
                const unitIds: string[] =
                    Array.isArray(data.unitIds) && data.unitIds.length
                        ? data.unitIds
                        : [data.unit.id];

                // Make dragged units children of THIS unit
                store.update((state: any) => {
                    const s = state;
                    const uMap = (s.unitMap ||= {});
                    const gMap = (s.groupMap ||= {});
                    const sgm = (s.sideGroupMap ||= {});
                    // small helper to detach
                    const detach = (uid: string) => {
                        const u = uMap[uid];
                        if (!u) return;
                        const pid = u._pid;
                        if (pid && uMap[pid]?.subUnits) {
                            uMap[pid].subUnits = uMap[pid].subUnits.filter((x: any) => (x?.id ?? x) !== uid);
                        }
                        Object.values(gMap).forEach((g: any) => {
                            if (Array.isArray(g?.subUnits)) g.subUnits = g.subUnits.filter((x: any) => (x?.id ?? x) !== uid);
                        });
                        Object.values(sgm).forEach((node: any) => {
                            if (Array.isArray(node?.subUnits)) node.subUnits = node.subUnits.filter((x: any) => (x?.id ?? x) !== uid);
                        });
                    };
                    for (const uid of unitIds) {
                        if (uid === props.item.unit.id) continue; // don't parent a unit under itself
                        detach(uid);
                        const parent = (uMap[props.item.unit.id] ||= { id: props.item.unit.id, type: "unit", name: props.item.unit.name, subUnits: [], equipment: [], personnel: [] });
                        parent.subUnits ||= [];
                        if (!parent.subUnits.includes(uid)) parent.subUnits.push(uid);
                        const u = uMap[uid]; if (u) u._pid = props.item.unit.id;
                    }
                    s.unitStateCounter = (s.unitStateCounter ?? 0) + 1;
                    s.featureStateCounter = (s.featureStateCounter ?? 0) + 1;
                });
            }
        },
    }),
  );
});

onUnmounted(() => {
  dndCleanup();
});

const isParent = computed(() =>
  Boolean(props.item.children && props.item.children.length),
);

const onUnitMenuAction = (unit: NUnit, action: UnitAction) => {
  emit("unit-action", unit, action);
};

const dbg = () => (window as any).__MENTAT_DEBUG_ORBAT === true;

/** DotsMenu has emitted multiple payload shapes over time; normalize them to our UnitAction. */
function resolveUnitAction(ev: unknown): UnitAction | undefined {
  const items = menuItems.value ?? [];

  const resolveString = (s: string): UnitAction | undefined => {
    const byAction = items.find((i) => i.action === s);
    if (byAction) return byAction.action;
    const byLabel = items.find((i) => i.label === s);
    if (byLabel) return byLabel.action;
    return undefined;
  };

  if (typeof ev === "string") return resolveString(ev);

  if (ev && typeof ev === "object") {
    const o: any = ev;
    const candidates = [o.action, o.id, o.value, o.label].filter(
      (x: any) => typeof x === "string",
    ) as string[];
    for (const c of candidates) {
      const r = resolveString(c);
      if (r) return r;
    }
  }

  return undefined;
}

const onDotsMenuAction = (ev: unknown) => {
  const action = resolveUnitAction(ev);
  if (!action) {
    if (dbg()) console.warn("[OrbatTreeItem] Unrecognized menu payload", ev);
    return;
  }
  emit("unit-action", unit.value, action);
};


const onUnitClick = (unit: NUnit, event: MouseEvent) => {
  emit("unit-click", unit, event);
};
</script>

<template>
    <li :id="'ou-' + unit.id" class="relative text-gray-900 dark:text-gray-400">
        <div ref="itemRef"
             class="group relative flex items-center justify-between border-l-2 py-1 pl-2 hover:bg-gray-200 sm:pl-0 dark:hover:bg-gray-700"
             @dblclick="isOpen = !isOpen"
             @click="onUnitClick(unit, $event)"
             :class="[
             selectedUnitIds.has(unit.id) && selectedUnitIds.size>
            1
            ? 'bg-yellow-100 hover:bg-yellow-200'
            : '',
            isActiveParent ? 'border-red-800 bg-red-50' : 'border-transparent',
            ]"
            >
            <div class="flex items-center space-x-1">
                <div class="h-6 w-6">
                    <button v-if="isParent" @click.stop="isOpen = !isOpen" class="">
                        <ChevronRightIcon class="h-6 w-6 transform text-gray-500 transition-transform group-hover:text-gray-900 dark:text-gray-400 dark:group-hover:text-gray-100"
                                          :class="{
                'rotate-90': isOpen,
                'text-red-600': hasActiveChildren,
              }" />
                    </button>
                </div>
                <button class="flex items-center space-x-1 text-sm">
                    <div class="flex items-center space-x-1" :class="{ 'opacity-20': isDragged }">
                        <div class="relative flex cursor-move justify-center"
                             :style="{ width: settingsStore.orbatIconSize + 'pt' }"
                             ref="dragItemRef">
                            <MilitarySymbol :sidc="unit._state?.sidc || unit.sidc"
                                            :size="settingsStore.orbatIconSize"
                                            :options="combinedOptions" />
                            <span v-if="unit.reinforcedStatus"
                                  class="absolute -top-2 -right-2.5 text-xs font-medium">
                                {{
                  mapReinforcedStatus2Field(unit.reinforcedStatus, { compact: true })
                                }}
                            </span>
                        </div>
                        <span class="flex-auto pl-1 text-left"
                              :class="{
                'font-medium': isActiveUnit,
              }">{{ unitLabel }}</span><span v-if="unit._state?.location" class="text-red-700">&deg;</span>
                    </div>
                </button>
            </div>

            <div class="flex items-center">
                <IconLockOutline v-if="unit.locked" class="h-5 w-5 text-gray-400" />
                <DotsMenu class="shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                          :items="menuItems"
                          @action="onDotsMenuAction" />
            </div>
            <TreeDropIndicator v-if="instruction" :instruction="instruction" />
        </div>
        <ul v-if="isOpen" class="ml-6 pb-1" ref="subTree">
            <OrbatTreeItem :item="subUnit"
                           :level="props.level ? props.level + 1 : 1"
                           v-for="(subUnit, index) in item.children"
                           :key="subUnit.unit.id"
                           @unit-action="onUnitMenuAction"
                           @unit-click="onUnitClick"
                           :symbolOptions="symbolOptions"
                           :last-in-group="index === item.children.length - 1" />
        </ul>
    </li>
</template>
