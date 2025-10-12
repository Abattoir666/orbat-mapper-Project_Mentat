<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { Toggle } from "reka-ui";
import { ChevronUpIcon } from "@heroicons/vue/24/solid";
import {
  IconDrag,
  IconEye,
  IconEyeOff,
  IconFilterVariant,
  IconFilterVariantPlus,
  IconLockOutline,
} from "@iconify-prerendered/vue-mdi";
import { type SideAction, SideActions, type UnitAction } from "@/types/constants";
import { useDebounce, useTimeoutFn } from "@vueuse/core";
import FilterQueryInput from "./FilterQueryInput.vue";
import EditSideForm from "./EditSideForm.vue";
import OrbatSideGroup from "./OrbatSideGroup.vue";
import type { NSide, NSideGroup, NUnit } from "@/types/internalModels";
import type { DropTarget } from "./types";
import { activeScenarioKey } from "@/components/injects";
import { injectStrict } from "@/utils";
import {
  attachInstruction,
  extractInstruction,
  type Instruction,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item";
import { type CleanupFn } from "@atlaskit/pragmatic-drag-and-drop/types";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
  getSideDragItem,
  isSideDragItem,
  isSideGroupDragItem,
  isUnitDragItem,
} from "@/types/draggables";
import TreeDropIndicator from "@/components/TreeDropIndicator.vue";
import SideDropdownMenu from "@/modules/scenarioeditor/SideDropdownMenu.vue";

interface Props {
  side: NSide;
  hideFilter?: boolean;
}

const props = withDefaults(defineProps<Props>(), { hideFilter: false });

interface Emits {
  (e: "unit-action", unit: NUnit, action: UnitAction): void;

  (e: "unit-click", unit: NUnit, event: MouseEvent): void;

  (
    e: "unit-drop",
    unit: NUnit,
    destinationUnit: NUnit | NSideGroup,
    target: DropTarget,
  ): void;

  (e: "side-action", unit: NSide, action: SideAction): void;
}

const emit = defineEmits<Emits>();

const { store, unitActions } = injectStrict(activeScenarioKey);

const isOpen = ref(true);
const dropRef = ref<HTMLElement | null>(null);
const dragRef = ref<HTMLElement | null>(null);
const isDragging = ref(false);
const instruction = ref<Instruction | null>(null);
const isDragOver = ref(false);

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
const hasLocationFilter = ref(false);
const filterQuery = ref("");

const showFilter = ref(false);
const debouncedFilterQuery = useDebounce(filterQuery, 100);
const isLocked = computed(() => !!props.side.locked);
const isHidden = computed(() => props.side.isHidden);

const sideGroups = computed(() =>
  props.side.groups.map((id) => store.state.sideGroupMap[id]),
);
const showEditSideForm = ref(false);

let dndCleanup: CleanupFn = () => {};

onMounted(() => {
  if (!dropRef.value) {
    return;
  }
    // === STABLE MULTI-DRAG PATCH: begin ===
    // Assumptions this component already has available (keep these as-is if you already import them):
    // - `store` or `scenario.store` with a reactive `state` that has unitMap (id -> unit),
    //   and each unit has `_pid` (parent id) and `subUnits` array on parent.
    // - Your DnD event gives you:
    //     draggedIds: string[]         // all selected ids being dragged (includes the “primary” dragged id)
    //     sourceParentId: string       // parent container they’re being dragged from
    //     targetParentId: string       // parent container they’re being dropped into
    //     targetIndex: number          // the intended insertion index within targetParent’s subUnits
    //
    // If your event shape is different, adjust the `mapEvent` function below in one place.

    type UnitNode = {
        id: string;
        name?: string;
        _pid?: string;         // parent id (repo tree)
        groupId?: string;      // optional, some builds mirror group id here
        subUnits?: string[];   // children ids (only meaningful for containers/units that have children)
    };

    type DnDDropEvent = {
        draggedIds: string[];
        sourceParentId: string;
        targetParentId: string;
        targetIndex: number; // index in target parent's subUnits (0..length)
        // Add anything else your DnD layer provides if needed
    };

    // ----- helpers to read/write your store -----
    const st = (store as any)?.state ?? store;                           // pinia or raw object
    const unitMap: Record<string, UnitNode> = (st.unitMap ??= {});
    const getChildren = (parentId: string | undefined): string[] => {
        if (!parentId) return [];
        const p = unitMap[parentId];
        if (!p) return [];
        if (!Array.isArray(p.subUnits)) p.subUnits = [];
        return p.subUnits;
    };
    const setParent = (childId: string, newParentId: string | undefined) => {
        const u = unitMap[childId];
        if (u) u._pid = newParentId;
    };

    // Guard: is target a descendant of any dragged? (prevent cycles)
    const isDescendantOf = (candidateId: string, ancestorIds: Set<string>): boolean => {
        let cur: UnitNode | undefined = unitMap[candidateId];
        const MAX = 10000; // safety
        let hops = 0;
        while (cur && cur._pid && hops++ < MAX) {
            if (ancestorIds.has(cur._pid)) return true;
            cur = unitMap[cur._pid];
        }
        return false;
    };

    // Sort dragged items by their current visual order within `sourceParentId`
    // This ensures we always keep the block’s relative order predictable.
    const sortDraggedBySourceOrder = (ids: string[], sourceParentId: string): string[] => {
        const src = getChildren(sourceParentId);
        const idx = new Map(src.map((id, i) => [id, i]));
        return [...ids].sort((a, b) => (idx.get(a) ?? 1e9) - (idx.get(b) ?? 1e9));
    };

    // Compute the adjusted insertion index when reordering within the same parent.
    // If you remove N dragged items located before targetIndex, the final insertionIndex shifts left by N.
    const adjustIndexForSameParent = (sourceIds: string[], draggedIds: Set<string>, targetIndex: number): number => {
        let removedBefore = 0;
        for (let i = 0; i < Math.min(targetIndex, sourceIds.length); i++) {
            if (draggedIds.has(sourceIds[i])) removedBefore++;
        }
        return Math.max(0, targetIndex - removedBefore);
    };

    // Remove a set of ids from a children array (in-place) while preserving order of non-moved.
    const removeMany = (arr: string[], toRemove: Set<string>) => {
        let w = 0;
        for (let r = 0; r < arr.length; r++) {
            const id = arr[r];
            if (!toRemove.has(id)) arr[w++] = id;
        }
        arr.length = w;
    };

    // Insert a block of ids into an array at a given index (in-place).
    const insertBlock = (arr: string[], at: number, ids: string[]) => {
        const idx = Math.min(Math.max(0, at), arr.length);
        arr.splice(idx, 0, ...ids);
    };

    // NO-OP short-circuit: drop into same parent at same effective index with same order
    const isNoOp = (dragged: string[], sourceParentId: string, targetParentId: string, targetIndex: number): boolean => {
        if (sourceParentId !== targetParentId) return false;
        const children = getChildren(sourceParentId);
        // Check if dragged already occupy a contiguous block at `adjustedIndex` in the same order
        const set = new Set(dragged);
        const adjusted = adjustIndexForSameParent(children, set, targetIndex);
        // Build a filtered array that excludes dragged
        const filtered = children.filter(id => !set.has(id));
        // Simulate insert
        const preview = [...filtered.slice(0, adjusted), ...dragged, ...filtered.slice(adjusted)];
        // If equal to original, it’s a no-op
        if (preview.length !== children.length) return false;
        for (let i = 0; i < children.length; i++) {
            if (children[i] !== preview[i]) return false;
        }
        return true;
    };

    // Main entry: call this from your DnD drop hook
    const onDrop = (evtRaw: any) => {
        // 1) Map your framework event → DnDDropEvent shape (EDIT THIS PART if your event differs)
        const mapEvent = (e: any): DnDDropEvent => {
            // Example mapping; replace with your own getters:
            return {
                draggedIds: e.draggedIds ?? e.selection ?? [e.id],
                sourceParentId: e.sourceParentId ?? e.fromParentId ?? e.source?.parentId,
                targetParentId: e.targetParentId ?? e.toParentId ?? e.target?.parentId,
                targetIndex: Number(e.targetIndex ?? e.index ?? 0),
            };
        };

        const evt = mapEvent(evtRaw);
        if (!Array.isArray(evt.draggedIds) || evt.draggedIds.length === 0) return;

        const dragged = Array.from(new Set(evt.draggedIds)); // de-dup
        const draggedSet = new Set(dragged);

        // 2) Basic guards
        if (!evt.targetParentId) return;
        if (isDescendantOf(evt.targetParentId, draggedSet)) {
            // Prevent dropping a parent under its own descendant
            return;
        }

        // 3) Keep a deterministic relative order for the block:
        //    If dragging inside the same parent, use the source parent's order;
        //    otherwise, if your DnD gives you a "visual selection order", you could keep that.
        const block = (evt.sourceParentId === evt.targetParentId)
            ? sortDraggedBySourceOrder(dragged, evt.sourceParentId)
            : dragged.slice(); // cross-parent: keep selection order

        // 4) Early no-op exit (avoid jitter)
        if (isNoOp(block, evt.sourceParentId, evt.targetParentId, evt.targetIndex)) return;

        // 5) Apply mutation atomically so watchers fire once
        const usePinia = store && typeof (store as any).$patch === "function";
        const mutate = (fn: (root: any) => void) => {
            if (usePinia) (store as any).$patch(fn);
            else fn((store as any) ?? {});
        };

        mutate((root: any) => {
            const targetChildren = getChildren(evt.targetParentId);

            if (evt.sourceParentId === evt.targetParentId) {
                // Reorder within the same parent
                const sourceChildren = targetChildren; // same array
                const adjusted = adjustIndexForSameParent(sourceChildren, draggedSet, evt.targetIndex);

                // Remove dragged
                removeMany(sourceChildren, draggedSet);

                // Insert as a block at adjusted index
                insertBlock(sourceChildren, adjusted, block);
                // parent pointers do not change (_pid stays the same)
            } else {
                // Move across different parents

                // 5a) Remove from source parent (we assume all share the same sourceParentId; if not, group by their _pid)
                const sourceChildren = getChildren(evt.sourceParentId);
                removeMany(sourceChildren, draggedSet);

                // 5b) Insert in target as a block at targetIndex (clamped)
                const clampedIndex = Math.min(Math.max(0, evt.targetIndex), targetChildren.length);
                insertBlock(targetChildren, clampedIndex, block);

                // 5c) Update parent pointers for moved items
                for (const id of block) setParent(id, evt.targetParentId);
            }

            // 6) Optional: bump simple counters if your UI depends on them
            root.nodesVersion = (root.nodesVersion ?? 0) + 1;
            root.structureVersion = (root.structureVersion ?? 0) + 1;
        });
    };
    // === STABLE MULTI-DRAG PATCH: end ===
});

onUnmounted(() => {
  dndCleanup();
});

if (props.side._isNew) showEditSideForm.value = true;

const onSideAction = (action: SideAction) => {
  if (action === SideActions.Expand) {
  } else if (action === SideActions.AddSubordinate) {
    // unitManipulationStore.createSubordinateUnit(props.side.groups[0]);
  } else if (action === SideActions.AddGroup) {
    unitActions.addSideGroup(props.side.id);
  } else if (action === SideActions.Edit) {
    showEditSideForm.value = true;
  } else {
    emit("side-action", props.side, action);
  }
};

function onSideGroupAction(sideGroup: NSideGroup, action: SideAction) {
  if (action === SideActions.Delete) {
    unitActions.deleteSideGroup(sideGroup.id);
  } else if (action === SideActions.MoveDown) {
    unitActions.reorderSideGroup(sideGroup.id, "down");
  } else if (action === SideActions.MoveUp) {
    unitActions.reorderSideGroup(sideGroup.id, "up");
  } else if (action === SideActions.Lock) {
    unitActions.updateSideGroup(sideGroup.id, { locked: true }, { noUndo: true });
  } else if (action === SideActions.Unlock) {
    unitActions.updateSideGroup(sideGroup.id, { locked: false }, { noUndo: true });
  } else if (action === SideActions.Clone) {
    unitActions.cloneSideGroup(sideGroup.id);
  } else if (action === SideActions.CloneWithState) {
    unitActions.cloneSideGroup(sideGroup.id, { includeState: true });
  } else if (action === SideActions.Hide) {
    unitActions.updateSideGroup(sideGroup.id, { isHidden: true });
  } else if (action === SideActions.Show) {
    unitActions.updateSideGroup(sideGroup.id, { isHidden: false });
  }
}

const onUnitAction = (unit: NUnit, action: UnitAction) => {
  emit("unit-action", unit, action);
};

const toggleOpen = () => {
  isOpen.value = !isOpen.value;
};
</script>
<template>
  <div class="pl-4">
    <header
      ref="dropRef"
      :id="`os-${side.id}`"
      class="group relative -ml-4 flex items-center justify-between border-t-2 border-b-2 border-gray-300 bg-gray-200 py-0 pl-4 dark:border-gray-600 dark:bg-gray-700"
    >
      <IconDrag
        class="size-6 flex-none cursor-move text-gray-500 group-focus-within:opacity-100 group-hover:opacity-100 sm:-ml-3 sm:opacity-0"
        ref="dragRef"
      />

      <button
        @click="toggleOpen"
        class="flex w-full items-center justify-between text-left"
      >
        <span class="text-sm font-medium text-gray-900 dark:text-gray-200">
          {{ side.name }}
        </span>
        <ChevronUpIcon
          :class="isOpen ? 'rotate-180 transform' : ''"
          class="size-5 text-gray-400 group-hover:text-gray-900"
        />
      </button>
      <button
        type="button"
        class="ml-1 flex-none text-gray-400 hover:text-gray-700"
        title="Toggle visibility"
        @click="onSideAction(isHidden ? SideActions.Show : SideActions.Hide)"
      >
        <IconEyeOff v-if="isHidden" class="h-5 w-5" />
        <IconEye class="h-5 w-5" v-else />
      </button>
      <Toggle
        v-if="!hideFilter"
        v-model="showFilter"
        v-slot="{ pressed }"
        title="Toggle ORBAT filter"
        class="ml-1 text-gray-400 hover:text-gray-900"
      >
        <span class="sr-only">Toggle ORBAT filter</span>
        <IconFilterVariantPlus v-if="pressed" class="h-5 w-5" aria-hidden="true" />
        <IconFilterVariant v-else class="h-5 w-5" aria-hidden="true" />
      </Toggle>
      <IconLockOutline v-if="isLocked" class="size-6 text-gray-400" />

      <SideDropdownMenu
        @action="onSideAction"
        :is-locked="isLocked"
        :is-hidden="isHidden"
      />
      <TreeDropIndicator v-if="instruction" :instruction="instruction" class="z-10" />
    </header>
    <EditSideForm
      v-if="showEditSideForm"
      :side-id="side.id"
      @close="showEditSideForm = false"
      class="-ml-6"
    />
    <div v-show="isOpen">
      <div v-if="showFilter" class="mt-4 mr-10">
        <FilterQueryInput
          v-model="filterQuery"
          v-model:location-filter="hasLocationFilter"
        />
      </div>
      <div v-for="group in sideGroups" :key="group.id">
        <OrbatSideGroup
          :group="group"
          :filter-query="debouncedFilterQuery"
          :has-location-filter="hasLocationFilter"
          @unit-action="onUnitAction"
          @unit-click="(unit, event) => emit('unit-click', unit, event)"
          @sidegroup-action="onSideGroupAction"
        >
        </OrbatSideGroup>
      </div>
    </div>
  </div>
</template>
