<template>
    <h3 class="mt-6 font-medium text-gray-900">Unit state</h3>
    <div class="flex items-center justify-between">
        <span class="text-sm">Change</span>
        <div class="flex items-center gap-1">
            <UnitStatusPopover @update="setUnitStatus" :disabled="isLocked" />
            <SplitButton :items="stateItems" v-model:active-item="uiState.activeStateItem" />
        </div>
    </div>

    <ul class="mt-2 divide-y divide-gray-200 border-t border-b border-gray-200">
        <li v-if="unit.location" class="relative flex items-center py-4">
            <div class="flex min-w-0 flex-auto flex-col text-sm">
                <span class="font-medium text-gray-500">Initial position</span>

                <template v-if="editInitialPosition">
                    <CoordinateInput v-model="newPosition"
                                     :format="coordinateInputFormat"
                                     @update:format="coordinateInputFormat = $event"
                                     @outBlur="doneEditInitialPosition()"
                                     @keyup.enter="doneEditInitialPosition()"
                                     @keyup.esc="cancelEdit()"
                                     autofocus />
                    <div class="mt-1 flex items-center gap-2">
                        <span class="text-xs text-gray-500">Alt (m)</span>
                        <input v-model.number="newAltitude"
                               type="number"
                               inputmode="numeric"
                               class="w-24 rounded border border-gray-300 px-1 py-0.5 text-xs text-gray-900"
                               :disabled="isLocked"
                               placeholder="(clamped)" />
                        <span class="text-xs text-gray-400">blank = SFC</span>
                    </div>
                </template>

                <p v-else class="text-gray-700" @dblclick="startEditInitialPosition()">
                    {{ formatPosition(unit.location) }}
                    <span class="ml-2 text-xs text-gray-500">{{ formatAlt(unit.location) }}</span>
                </p>
            </div>

            <div class="relative flex flex-0 items-center space-x-0"></div>
        </li>

        <li v-for="(s, index) in state"
            :key="s.id"
            class="relative flex items-center py-4"
            :class="{ 'bg-blue-50': isActive(s, index) }">
            <div class="flex min-w-0 flex-auto flex-col text-sm">
                <p class="leading-tight text-gray-900" v-if="s.title === undefined" @dblclick="editTitle(s)">
                    {{ formatDateString(s.t, store.state.info.timeZone) }}
                </p>
                <p v-else-if="s.title"
                   class="my-1 leading-tight font-medium text-gray-900"
                   @dblclick="editTitle(s)">
                    {{ s.title }}
                </p>

                <template v-if="s === editedPosition">
                    <CoordinateInput v-model="newPosition"
                                     :format="coordinateInputFormat"
                                     @update:format="coordinateInputFormat = $event"
                                     @outBlur="doneEditPosition(s)"
                                     @keyup.enter="doneEditPosition(s)"
                                     @keyup.esc="cancelEdit()"
                                     autofocus />
                    <div class="mt-1 flex items-center gap-2">
                        <span class="text-xs text-gray-500">Alt (m)</span>
                        <input v-model.number="newAltitude"
                               type="number"
                               inputmode="numeric"
                               class="w-24 rounded border border-gray-300 px-1 py-0.5 text-xs text-gray-900"
                               :disabled="isLocked"
                               placeholder="(clamped)" />
                        <span class="text-xs text-gray-400">blank = SFC</span>
                    </div>
                </template>

                <p class="mt-1 text-gray-700" v-else-if="s.location" @dblclick="editPosition(s)">
                    {{ formatPosition(s.location) }}
                    <span class="ml-2 text-xs text-gray-500">{{ formatAlt(s.location) }}</span>
                </p>

                <IconMapMarkerOffOutline v-if="s.location === null" class="h-5 w-5 text-gray-600" />

                <div class="mt-1 flex gap-1">
                    <span v-if="s.sidc" class="w-12 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">sidc</span>
                    <span v-if="s.status"
                          class="w-auto rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-800">{{ unitStatusMap[s.status]?.name }}</span>
                    <span v-if="s.update?.equipment" class="badge">Equipment</span>
                    <span v-if="s.update?.personnel" class="badge">Personnel</span>
                    <span v-if="s.update?.supplies" class="badge">Supplies</span>
                    <span v-if="s.diff?.equipment" class="badge">±Equipment</span>
                    <span v-if="s.diff?.personnel" class="badge">±Personnel</span>
                    <span v-if="s.diff?.supplies" class="badge">±Supplies</span>
                </div>
            </div>

            <div class="relative flex flex-0 items-center space-x-0">
                <IconButton title="Goto Time and Place" @click="changeToState(s)">
                    <IconCrosshairsGps class="h-5 w-5" aria-hidden="true" />
                </IconButton>
                <DotsMenu :items="menuItems" @action="onStateAction(index, $event)" portal />
            </div>

            <div v-if="s.via?.length || s.viaStartTime !== undefined || s.interpolate === false"
                 class="absolute -top-3 left-1/2">
                <div class="relative -left-1/2 flex items-center rounded-full border bg-white px-4 py-0.5">
                    <IconMapMarkerPath v-if="s.via?.length" class="h-5 w-5 text-gray-500" />
                    <IconMapMarkerAlert v-else-if="s.interpolate === false" class="h-5 w-5 text-gray-500" />
                    <span v-if="s.viaStartTime" class="ml-2 text-xs text-gray-600">
                        {{
            formatDateString(s.viaStartTime, store.state.info.timeZone)
                        }}
                    </span>
                </div>
            </div>
        </li>
    </ul>
</template>

<script setup lang="ts">
    import { computed, nextTick, ref, type VNode } from "vue";
    import type { Position } from "geojson";
    import {
        IconCrosshairsGps,
        IconMapMarkerAlert,
        IconMapMarkerOffOutline,
        IconMapMarkerPath,
    } from "@iconify-prerendered/vue-mdi";
    import type { StateAdd } from "@/types/scenarioModels";
    import { formatDateString, formatPosition } from "@/geo/utils";
    import IconButton from "@/components/IconButton.vue";
    import { useUnitActions } from "@/composables/scenarioActions";
    import { type StateAction, UnitActions } from "@/types/constants";
    import type { NState, NUnit } from "@/types/internalModels";
    import { injectStrict } from "@/utils";
    import { activeScenarioKey, sidcModalKey, timeModalKey } from "@/components/injects";
    import DotsMenu from "@/components/DotsMenu.vue";
    import CoordinateInput, { type CoordinateInputFormat } from "@/components/CoordinateInput.vue";
    import type { ButtonGroupItem, MenuItemData } from "@/components/types";
    import SplitButton from "@/components/SplitButton.vue";
    import { useUiStore } from "@/stores/uiStore";
    import UnitStatusPopover from "@/modules/scenarioeditor/UnitStatusPopover.vue";
    import { useLocalStorage } from "@vueuse/core";
    import { useAltitudeIndicator } from "@/composables/useAltitudeIndicator";

    const { format: formatAlt } = useAltitudeIndicator();

    interface Props {
        unit: NUnit;
        isLocked?: boolean;
    }
    const props = defineProps<Props>();

    const { store, time, unitActions } = injectStrict(activeScenarioKey);
    const { getModalTimestamp } = injectStrict(timeModalKey);
    const { getModalSidc } = injectStrict(sidcModalKey);

    const {
        state: { unitStatusMap },
    } = store;

    const { onUnitAction } = useUnitActions();
    const uiState = useUiStore();

    const state = computed(() => props.unit.state ?? []);
    const unit = computed(() => props.unit);

    const coordinateInputFormat = useLocalStorage<CoordinateInputFormat>("coordinateInputFormat", "LonLat");

    const editedTitle = ref<NState | null>();
    const editedPosition = ref<NState | null>();
    const editInitialPosition = ref(false);

    const newTitle = ref<string>("");
    const newPosition = ref<Position | null>(null);
    const newAltitude = ref<number | null>(null);

    function altOf(pos: Position | null | undefined): number | undefined {
        if (!pos) return undefined;
        const z = (pos as any)[2];
        return typeof z === "number" && Number.isFinite(z) ? z : undefined;
    }

    function composeLocation(pos: Position | null, altOverride: number | null): Position | null {
        if (!pos) return null;
        if (typeof altOverride === "number" && Number.isFinite(altOverride)) {
            return [pos[0] as number, pos[1] as number, altOverride];
        }
        return pos;
    }

    const menuItems = computed((): MenuItemData<StateAction>[] => [
        { label: "Delete", action: "delete", disabled: props.isLocked },
        { label: "Duplicate", action: "duplicate", disabled: props.isLocked },
        { label: "Change time", action: "changeTime", disabled: props.isLocked },
        { label: "Edit title", action: "editTitle", disabled: props.isLocked },
        { label: "Edit location", action: "editLocation", disabled: props.isLocked },
        { label: "Clear location", action: "clearLocation", disabled: props.isLocked },
    ]);

    const stateItems = computed((): ButtonGroupItem[] => [
        { label: "Change symbol", onClick: () => handleChangeSymbol(), disabled: props.isLocked },
        { label: "Remove from map", onClick: () => handleRemoveFromMap(), disabled: props.isLocked },
    ]);

    const isActive = (s: NState, index: number) => {
        if (!state.value?.length) return;
        const nextUnitTimestamp = state.value[index + 1]?.t || Number.MAX_VALUE;
        const currentTime = store.state.currentTime;
        return s.t <= currentTime && nextUnitTimestamp > currentTime;
    };

    const changeToState = (stateEntry: NState) => {
        time.setCurrentTime(stateEntry.t);
        if (stateEntry.location) onUnitAction(props.unit, UnitActions.Pan);
    };

    async function onStateAction(index: number, action: StateAction) {
        if (action === "delete") {
            if (index < 0) {
                // initial position handled elsewhere
                return;
            }
            unitActions.deleteUnitStateEntry(props.unit.id, index);
        } else if (action === "duplicate") {
            unitActions.addUnitStateEntry(props.unit.id, { ...state.value[index], t: store.state.currentTime });
        } else if (action === "changeTime") {
            const newTimestamp = await getModalTimestamp(state.value[index].t, {
                timeZone: store.state.info.timeZone,
                title: "Set event time",
            });
            if (newTimestamp !== undefined) {
                unitActions.updateUnitStateEntry(props.unit.id, index, { t: newTimestamp });
            }
        } else if (action === "editTitle") {
            await editTitle(state.value[index]);
        } else if (action === "editLocation") {
            if (index < 0) startEditInitialPosition();
            else await editPosition(state.value[index]);
        } else if (action === "clearLocation") {
            unitActions.updateUnitStateEntry(props.unit.id, index, { location: null });
        }
    }

    async function editTitle(s: NState) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        editedTitle.value = s;
        newTitle.value = s.title || "";
    }

    function doneEdit(s: NState) {
        if (!editedTitle.value) return;
        const index = state.value.indexOf(s);
        editedTitle.value = null;
        if (index < 0 || newTitle.value === s.title) return;
        unitActions.updateUnitStateEntry(props.unit.id, index, { title: newTitle.value });
        newTitle.value = "";
    }

    function cancelEdit() {
        editedTitle.value = null;
        newTitle.value = "";
        editedPosition.value = null;
        newPosition.value = null;
        newAltitude.value = null;
        editInitialPosition.value = false;
    }

    async function editPosition(s: NState) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        editedPosition.value = s;
        newPosition.value = (s.location as any) ?? null;
        newAltitude.value = altOf(s.location as any) ?? null;
    }

    function doneEditPosition(s: NState) {
        if (!editedPosition.value) return;
        const index = state.value.indexOf(s);
        editedPosition.value = null;
        if (index < 0) return;

        unitActions.updateUnitStateEntry(props.unit.id, index, {
            location: composeLocation(newPosition.value, newAltitude.value),
        });

        newPosition.value = null;
        newAltitude.value = null;
    }

    function startEditInitialPosition() {
        nextTick(() => (editInitialPosition.value = true));
        newPosition.value = (props.unit.location as any) ?? ([0, 0] as any);
        newAltitude.value = altOf(props.unit.location as any) ?? null;
    }

    function doneEditInitialPosition() {
        editInitialPosition.value = false;

        unitActions.updateUnit(props.unit.id, { location: composeLocation(newPosition.value, newAltitude.value) }, { doUpdateUnitState: true });

        newPosition.value = null;
        newAltitude.value = null;
    }

    const onVMounted = ({ el }: VNode) => el?.focus();

    async function handleChangeSymbol() {
        const newSidcValue = await getModalSidc(props.unit.sidc, {
            title: `Change symbol at ${formatDateString(store.state.currentTime, store.state.info.timeZone)}`,
            symbolOptions: unitActions.getCombinedSymbolOptions(props.unit),
        });
        if (newSidcValue !== undefined) {
            const newState: StateAdd = {
                sidc: newSidcValue.sidc,
                t: store.state.currentTime,
                symbolOptions: newSidcValue.symbolOptions,
            };
            unitActions.addUnitStateEntry(props.unit.id, newState, true);
        }
    }

    function handleRemoveFromMap() {
        const newState: StateAdd = { location: null, t: store.state.currentTime };
        unitActions.addUnitStateEntry(props.unit.id, newState, true);
    }

    function setUnitStatus(newStatus?: string | null) {
        const newState: StateAdd = { status: newStatus, t: store.state.currentTime };
        unitActions.addUnitStateEntry(props.unit.id, newState, true);
    }
</script>
