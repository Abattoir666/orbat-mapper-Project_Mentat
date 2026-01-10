<template>
    <nav class="bg-sidebar border-border pointer-events-auto flex w-full items-center justify-between border p-1 text-sm shadow-sm sm:rounded-xl sm:p-2 md:w-auto">
        <section class="flex items-center justify-between">
            <MainToolbarButton title="Keep selected tool active after drawing"
                               @click="toggleAddMultiple()"
                               class="hidden sm:flex">
                <IconLockOutline v-if="addMultiple" class="size-5" />
                <IconLockOpenVariantOutline v-else class="size-6" />
            </MainToolbarButton>

            <MainToolbarButton @click="toggleMoveUnit(false)"
                               :active="!moveUnitEnabled">
                <SelectIcon class="size-6" />
            </MainToolbarButton>

            <MainToolbarButton :active="moveUnitEnabled"
                               @click="toggleMoveUnit(true)"
                               title="Move unit">
                <MoveIcon class="size-6" />
            </MainToolbarButton>

            <MainToolbarButton @click="emit('show-settings')"
                               title="Show settings"
                               class="hidden md:flex">
                <SettingsIcon class="size-6" />
            </MainToolbarButton>

            <div class="border-border h-7 border-l-2 sm:mx-1" />

            <MainToolbarButton :active="mainToolbarStore.currentToolbar === 'measurements'"
                               @click="mainToolbarStore.toggleToolbar('measurements')"
                               title="Measurements">
                <MeasurementIcon class="size-6" />
            </MainToolbarButton>

            <MainToolbarButton :active="mainToolbarStore.currentToolbar === 'draw'"
                               @click="mainToolbarStore.toggleToolbar('draw')"
                               title="Draw">
                <DrawIcon class="size-6" />
            </MainToolbarButton>

            <MainToolbarButton title="Unit track"
                               :active="mainToolbarStore.currentToolbar === 'track'"
                               @click="mainToolbarStore.toggleToolbar('track')">
                <IconMapMarkerPath class="size-6" />
            </MainToolbarButton>

            <MainToolbarButton title="Unit Hieararchies"
                               :active="isParentLinkActive"
                               @click="toggleParentLinesPersistent">
                <img :src="sargChevron"
                     alt="Parent line"
                     class="size-6 opacity-90" />
            </MainToolbarButton>

            <!-- Bulk quick edit trigger -->
            <MainToolbarButton :title="selectedCount > 1 ? `Bulk Edit (${selectedCount})` : 'Bulk Edit'"
                               :disabled="selectedCount === 0"
                               @click="bulkMenuOpen = !bulkMenuOpen">
                <CircleStackIcon class="size-6" />
            </MainToolbarButton>

            <!-- Super light “menu” using your existing FloatingPanel (no transitions needed) -->
            <FloatingPanel v-if="bulkMenuOpen"
                           class="absolute z-[1000] left-1/2 top-12 -translate-x-1/2 p-2">
                <div class="flex items-center gap-2">
                    <button class="qb-btn" @click="promptSidc">Set SIDC…</button>
                    <button class="qb-btn" @click="promptFill">Set fillColor…</button>

                    <!-- open delete-events dialog, then close the mini menu -->
                    <button class="qb-btn" @click="openDeleteEventsDialog">
                        Delete events in time range…
                    </button>

                    <!-- 🆕 open copy-range-rings dialog -->
                    <button class="qb-btn" @click="openCopyRangeRingsDialog">
                        Copy range-rings…
                    </button>

                    <button class="qb-btn qb-cancel" @click="bulkMenuOpen = false">
                        Close
                    </button>
                </div>
            </FloatingPanel>


            <!-- Pop-out dialog for time-range delete, only for selected units -->
            <DeleteEventsBulkDialog v-model="deleteEventsDialogOpen"
                                    :selected-unit-ids="selectedUnitIdsArray" />

            <!-- 🆕 Pop-out dialog for copying range-rings in bulk -->
            <CopyRangeRingsBulkDialog v-model="copyRangeRingsDialogOpen"
                                      :selected-unit-ids="selectedUnitIdsArray" />

            <div class="border-border h-7 border-l-2 sm:mx-1" />

            <div class="ml-2 flex items-center">
                <EchelonPickerPopover :symbol-options="symbolOptions"
                                      :select-echelon="selectEchelon" />
                <PanelSymbolButton :size="22"
                                   :sidc="computedSidc"
                                   class="group relative ml-2 sm:ml-5"
                                   :symbol-options="symbolOptions"
                                   @click="addUnit(activeSidc)"
                                   title="Add unit"
                                   :disabled="!activeParentId || unitActions.isUnitLocked(activeParentId)">
                    <AddSymbolIcon class="bg-opacity-70 absolute -right-2 bottom-0 h-4 w-4 rounded-full bg-white text-gray-600 group-hover:text-gray-900" />
                </PanelSymbolButton>
                <SymbolPickerPopover :symbol-options="symbolOptions"
                                     :add-unit="addUnit" />
            </div>
        </section>

        <section class="flex items-center">
            <div class="border-border -mx-1 h-7 border-l-2 sm:mx-1" />
            <MainToolbarButton title="Undo" @click="undo()" :disabled="!canUndo">
                <UndoIcon class="size-6" />
            </MainToolbarButton>
            <MainToolbarButton title="Redo" @click="redo()" :disabled="!canRedo">
                <RedoIcon class="size-6" />
            </MainToolbarButton>

            <div class="border-border mx-1 hidden h-7 border-l-2 sm:block" />

            <MainToolbarButton title="Select Time and Date"
                               class="hidden sm:flex"
                               @click="emit('open-time-modal')">
                <span class="sr-only">Select Time and Date</span>
                <CalendarIcon class="size-5" aria-hidden="true" />
            </MainToolbarButton>

            <MainToolbarButton title="Previous Day"
                               class="hidden sm:flex"
                               @click="emit('dec-day')">
                <span class="sr-only">Previous Day</span>
                <IconChevronLeft class="size-5" aria-hidden="true" />
            </MainToolbarButton>

            <MainToolbarButton title="Next Day"
                               class="hidden sm:flex"
                               @click="emit('inc-day')">
                <span class="sr-only">Next Day</span>
                <IconChevronRight class="size-5" aria-hidden="true" />
            </MainToolbarButton>

            <MainToolbarButton title="Previous Event"
                               class="hidden sm:flex"
                               @click="emit('prev-event')">
                <span class="sr-only">Previous Event</span>
                <IconSkipPrevious class="size-5" aria-hidden="true" />
            </MainToolbarButton>

            <MainToolbarButton title="Next Event"
                               class="hidden sm:flex"
                               @click="emit('next-event')">
                <span class="sr-only">Next Event</span>
                <IconSkipNext class="size-5 w-5" aria-hidden="true" />
            </MainToolbarButton>
        </section>

        <FloatingPanel v-if="isGetLocationActive"
                       class="bg-opacity-75 absolute bottom-14 overflow-visible p-2 px-4 text-sm sm:bottom-16 sm:left-1/2 sm:-translate-x-1/2">
            Click on map or ORBAT to place unit.
            <Button type="button" variant="link" size="sm" @click="cancelGetLocation()">
                Cancel
            </Button>
        </FloatingPanel>
    </nav>
</template>

<script setup lang="ts">
/* Icons */
import {
  IconChevronLeft,
  IconChevronRight,
  IconCogOutline as SettingsIcon,
  IconCursorDefaultOutline as SelectIcon,
  IconCursorMove as MoveIcon,
  IconLockOpenVariantOutline,
  IconLockOutline,
  IconMapMarkerPath,
  IconPencil as DrawIcon,
  IconPlus as AddSymbolIcon,
  IconRedoVariant as RedoIcon,
  IconRulerSquareCompass as MeasurementIcon,
  IconSkipNext,
  IconSkipPrevious,
  IconUndoVariant as UndoIcon,
} from "@iconify-prerendered/vue-mdi";
import { CalendarIcon, CircleStackIcon } from "@heroicons/vue/24/solid";

/* Components */
import MainToolbarButton from "@/components/MainToolbarButton.vue";
import PanelSymbolButton from "@/components/PanelSymbolButton.vue";
import FloatingPanel from "@/components/FloatingPanel.vue";
import SymbolPickerPopover from "@/modules/scenarioeditor/SymbolPickerPopover.vue";
import EchelonPickerPopover from "@/modules/scenarioeditor/EchelonPickerPopover.vue";
import * as QuickBulkActions from "@/modules/scenarioeditor/bulkEdit/quickBulkActions";
import { Button } from "@/components/ui/button";
import DeleteEventsBulkDialog from "@/modules/scenarioeditor/bulkEdit/DeleteEventsBulkDialog.vue";
import CopyRangeRingsBulkDialog from "@/modules/scenarioeditor/bulkEdit/CopyRangeRingsBulkDialog.vue";

/* Stores / DI / composables */
import { useMainToolbarStore } from "@/stores/mainToolbarStore";
import { storeToRefs } from "pinia";
import { injectStrict } from "@/utils";
import { activeMapKey, activeScenarioKey } from "@/components/injects";
import { useUnitSettingsStore } from "@/stores/geoStore";
import { useEventBus, useToggle } from "@vueuse/core";
import { useMapSelectStore } from "@/stores/mapSelectStore";
import { useToolbarUnitSymbolData } from "@/composables/mainToolbarData";
import { useActiveUnitStore } from "@/stores/dragStore";
import { orbatUnitClick } from "@/components/eventKeys";
import sargChevron from "@/components/ui/Icons/sargchevron.svg?url";
import { useSelectedItems } from "@/stores/selectedStore";
import {
  setSidcBulk,
  setFillColorBulk,
} from "@/modules/scenarioeditor/bulkEdit/quickBulkActions";
import { parentLinkOverlay } from "@/stores/parentLinkOverlay";
import { useGetMapLocation } from "@/composables/geoMapLocation";

/* Vue */
import { computed, ref, onMounted, type Ref, watch } from "vue";

/* Symbology */
import { SID_INDEX, Sidc } from "@/symbology/sidc";
import type { Position } from "geojson";

/* ---------- Emits ---------- */
const emit = defineEmits([
  "open-time-modal",
  "inc-day",
  "dec-day",
  "next-event",
  "prev-event",
  "show-settings",
]);

/* ---------- Scenario + map DI ---------- */
const { store: scenarioStore, unitActions, geo, helpers } =
  injectStrict(activeScenarioKey);
const { addUnitPosition } = geo;
const { getSideById } = helpers;
const mapRef = injectStrict(activeMapKey);

/* ---------- Toolbar + selection stores ---------- */
const mainToolbarStore = useMainToolbarStore();
const { addMultiple } = storeToRefs(mainToolbarStore);

const { moveUnitEnabled } = storeToRefs(useUnitSettingsStore());
const toggleMoveUnit = useToggle(moveUnitEnabled);

const selectStore = useMapSelectStore();
const toggleAddMultiple = useToggle(addMultiple);

const { activeUnitId, resetActiveParent, activeParent, activeParentId } =
  useActiveUnitStore();

const { selectedUnitIds } = useSelectedItems(); // Ref<Set<string>>

const selectedCount = computed(() => selectedUnitIds.value.size);
const selectedUnitIdsArray = computed(() => Array.from(selectedUnitIds.value));

/* ---------- Time / SIDC helpers ---------- */
const { currentSid, currentEchelon, activeSidc } = useToolbarUnitSymbolData();

/* ---------- History / groupUpdate ---------- */
const { undo, redo, canRedo, canUndo, groupUpdate, state } =
  scenarioStore;

/* ---------- Bulk menu + dialogs ---------- */
const bulkMenuOpen = ref(false);
const deleteEventsDialogOpen = ref(false);
const copyRangeRingsDialogOpen = ref(false);

function openDeleteEventsDialog() {
  if (!selectedCount.value) return;
  deleteEventsDialogOpen.value = true;
  bulkMenuOpen.value = false;
}

function openCopyRangeRingsDialog() {
  if (!selectedCount.value || selectedCount.value < 2) return;
  copyRangeRingsDialogOpen.value = true;
  bulkMenuOpen.value = false;
}

/* ---------- Parent-link overlay ---------- */
const isParentLinkActive = computed(
  () =>
    parentLinkOverlay.enabled &&
    parentLinkOverlay.tracked.has(activeUnitId.value || "")
);

function toggleParentLinesPersistent() {
  // If currently disabled, enable and track current selection
  if (!parentLinkOverlay.enabled) {
    parentLinkOverlay.enable();
    if (selectedUnitIds.value.size) {
      parentLinkOverlay.toggleUnits(selectedUnitIds.value);
    }
    return;
  }

  // If enabled and you have a selection, toggle those units in/out of tracking
  if (selectedUnitIds.value.size) {
    parentLinkOverlay.toggleUnits(selectedUnitIds.value);
    return;
  }

  // If enabled and no selection, disable entirely (acts as global off)
  parentLinkOverlay.disable();
  parentLinkOverlay.clearTracked();
  console.log("[ParentLine] segments:", parentLinkOverlay.segments);
}

/* ---------- Geo location composable ---------- */
const {
  start: startGetLocation,
  isActive: isGetLocationActive,
  cancel: cancelGetLocation,
  onGetLocation,
  onCancel,
  onStart,
} = useGetMapLocation(mapRef.value, {
  cancelOnClickOutside: false,
  stopPropagationOnClickOutside: false,
});

/* ---------- Computed symbol + options ---------- */
const computedSidc = computed(() => {
  const parsedSidc = new Sidc(activeSidc.value);
  parsedSidc.standardIdentity = currentSid.value;
  parsedSidc.emt = "00";
  parsedSidc.hqtfd = "0";
  return parsedSidc.toString();
});

const symbolOptions = computed(() =>
  activeParent.value
    ? {
        ...unitActions.getCombinedSymbolOptions(activeParent.value, true),
        outlineWidth: 5,
      }
    : {}
);

/* ---------- Quick Bulk actions (SIDC / fill / delete events) ---------- */

function promptSidc() {
  if (!selectedCount.value) return;
  const v = window.prompt(
    `Set SIDC for ${selectedCount.value} unit(s):`,
    ""
  );
  if (!v) return;
  setSidcBulk(scenarioStore, selectedUnitIds.value, v);
  bulkMenuOpen.value = false;
}

function promptFill() {
  if (!selectedCount.value) return;
  const v = window.prompt(
    `Set symbolOptions.fillColor for ${selectedCount.value} unit(s):`,
    "#2e86de"
  );
  if (!v) return;
  setFillColorBulk(scenarioStore, selectedUnitIds.value, v);
  bulkMenuOpen.value = false;
}

/** UX: auto-close bulk menu when selection clears */
watch(selectedUnitIds, (s) => {
  if (!s.size) bulkMenuOpen.value = false;
});

/* ---------- Existing behaviors ---------- */

const bus = useEventBus(orbatUnitClick);

function addUnit(
  sidc: string,
  closePopover?: (ref?: Ref | HTMLElement) => void
) {
  activeSidc.value = sidc;
  closePopover && closePopover();
  startGetLocation();
}

onMounted(() => {
  if (!activeParentId.value) resetActiveParent();
});

onCancel(() => {
  selectStore.hoverEnabled = true;
});

onStart(() => {
  selectStore.hoverEnabled = false;
  mainToolbarStore.clearToolbar();
});

    const DEFAULT_NEW_UNIT_ALT_M = 0; // meters; wire to a setting later if desired

    function withDefaultAlt(location: Position, defaultAltM = DEFAULT_NEW_UNIT_ALT_M): Position {
        const z = (location as any)[2];
        if (typeof z === "number" && Number.isFinite(z)) return location; // already 3D
        return [location[0] as number, location[1] as number, defaultAltM];
    }


onGetLocation((location) => {
  selectStore.hoverEnabled = true;
  groupUpdate(() => {
    if (!activeParentId.value || unitActions.isUnitLocked(activeParentId.value))
      return;

    const name = `${(activeParent.value?.subUnits?.length ?? 0) + 1}`;
    const sidc = new Sidc(activeSidc.value!);
    sidc.emt = currentEchelon.value;
    sidc.standardIdentity = currentSid.value;
    const unitId = unitActions.createSubordinateUnit(activeParentId.value, {
      sidc: sidc.toString(),
      name,
    });
      unitId && addUnitPosition(unitId, withDefaultAlt(location));
  });
  if (addMultiple.value && activeSidc.value) {
    addUnit(activeSidc.value);
  }
});

bus.on((unit) => {
  if (isGetLocationActive.value) {
    if (!(addMultiple.value && activeSidc.value)) {
      cancelGetLocation();
    }
    const name = `${(activeParent.value?.subUnits?.length ?? 0) + 1}`;
    const sidc = new Sidc(activeSidc.value!);
    sidc.emt = currentEchelon.value;
    sidc.standardIdentity = unit.sidc[SID_INDEX];
    const unitId = unitActions.createSubordinateUnit(unit.id, {
      sidc: sidc.toString(),
      name,
    });
  }
});

watch(activeParent, (unitOrSideGroup) => {
  if (!unitOrSideGroup) return;
  if ("sidc" in unitOrSideGroup) {
    currentSid.value = unitOrSideGroup.sidc[SID_INDEX];
  } else {
    currentSid.value = getSideById(unitOrSideGroup._pid).standardIdentity;
  }
});

function selectEchelon(sidc: string) {
  currentEchelon.value = new Sidc(sidc).emt;
}
</script>

<style scoped>
    .qb-btn {
        height: 28px;
        padding: 0 10px;
        border-radius: 7px;
        border: 1px solid #3b4047;
        background: #2c3138;
        color: #fff;
        cursor: pointer;
    }

    .qb-cancel {
        background: #444b55;
    }
</style>
