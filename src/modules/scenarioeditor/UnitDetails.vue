<script setup lang="ts">
    import {
        computed,
        defineAsyncComponent,
        ref,
        useTemplateRef,
        watch,
        watchEffect,
        render,
        h,
    } from "vue";
    import {
        IconCrosshairsGps,
        IconFileTreeOutline as TreeLocateIcon,
        IconImage as ImageIcon,
        IconLockOutline,
        IconMagnifyExpand as ZoomIcon,
        IconPencil as EditIcon,
    } from "@iconify-prerendered/vue-mdi";
    import { useGeoStore, useUnitSettingsStore } from "@/stores/geoStore";
    import { GlobalEvents } from "vue-global-events";
    import { inputEventFilter, setCharAt } from "@/components/helpers";
    import DescriptionItem from "@/components/DescriptionItem.vue";
    import { unrefElement, useToggle } from "@vueuse/core";
    import { renderMarkdown } from "@/composables/formatting";
    import UnitPanelState from "./UnitPanelState.vue";
    import { useUnitActions } from "@/composables/scenarioActions";
    import { type UnitAction, UnitActions } from "@/types/constants";
    import SplitButton from "@/components/SplitButton.vue";
    import { type EntityId } from "@/types/base";
    import { injectStrict } from "@/utils";
    import { activeScenarioKey, searchActionsKey, sidcModalKey } from "@/components/injects";
    import type { MediaUpdate, UnitUpdate } from "@/types/internalModels";
    import { formatPosition } from "@/geo/utils";
    import IconButton from "@/components/IconButton.vue";
    import { useGetMapLocation } from "@/composables/geoMapLocation";
    import OLMap from "ol/Map";
    import { useUiStore } from "@/stores/uiStore";
    import { SID_INDEX } from "@/symbology/sidc";
    import MilitarySymbol from "@/components/NewMilitarySymbol.vue";
    import { useSelectedItems } from "@/stores/selectedStore";
    import { TabPanel } from "@headlessui/vue";
    import EditableLabel from "@/components/EditableLabel.vue";
    import UnitDetailsMapDisplay from "@/modules/scenarioeditor/UnitDetailsMapDisplay.vue";
    import { useTabStore } from "@/stores/tabStore";
    import { storeToRefs } from "pinia";
    import UnitDetailsToe from "@/modules/scenarioeditor/UnitDetailsToe.vue";
    import TabWrapper from "@/components/TabWrapper.vue";
    import DotsMenu from "@/components/DotsMenu.vue";
    import { type MenuItemData } from "@/components/types";
    import EditMediaForm from "@/modules/scenarioeditor/EditMediaForm.vue";
    import EditMetaForm from "@/modules/scenarioeditor/EditMetaForm.vue";
    import ItemMedia from "@/modules/scenarioeditor/ItemMedia.vue";
    import UnitDetailsProperties from "@/modules/scenarioeditor/UnitDetailsProperties.vue";
    import UnitDetailsSymbol from "@/modules/scenarioeditor/UnitDetailsSymbol.vue";
    import { Button } from "@/components/ui/button";
    import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
    import { getUnitDragItem } from "@/types/draggables.ts";
    import { pointerOutsideOfPreview } from "@atlaskit/pragmatic-drag-and-drop/element/pointer-outside-of-preview";
    import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
    import MilSymbol from "@/components/MilSymbol.vue";
    import UnitDetailsLeaders from "@/modules/scenarioeditor/Leaders/UnitDetailsLeaders.vue";
    import UnitDetailsPersonnel from "@/modules/scenarioeditor/Personnel/UnitDetailsPersonnel.vue";
    import type { Position } from "geojson";
    import { useInteractionAdapter } from "@/modules/threeDView/handling/interactionAdapter";

    const FeatureTransformations = defineAsyncComponent(
        () => import("@/modules/scenarioeditor/FeatureTransformations.vue"),
    );

    const props = defineProps<{ unitId: EntityId }>();
    const activeScenario = injectStrict(activeScenarioKey);
    const {
        store,
        helpers: { getUnitById },
        geo: { addUnitPosition },
        unitActions: {
            updateUnit,
            getUnitHierarchy,
            getCombinedSymbolOptions,
            isUnitLocked,
            updateUnitLocked,
        },
    } = activeScenario;

    const { onUnitSelectHook } = injectStrict(searchActionsKey);

    const {
        state: { unitStatusMap },
    } = store;
    const { unitDetailsTab: selectedTab } = storeToRefs(useTabStore());

    const unitName = ref("");
    const shortName = ref("");
    const unitNumber = ref("");
    const truncateUnits = ref(true);
    const isDragged = ref(false);
    const elRef = useTemplateRef("elRef");

    const tabList = computed(() =>
        uiStore.debugMode
            ? [
                "Details",
                "Map symbol",
                "Unit state",
                "Leaders",
                "Personnel",
                { label: "TO&E/S", title: "Table of organization, equipment and supplies" },
                "Map display",
                "Properties",
                "Transform",
                "Debug",
            ]
            : [
                "Details",
                "Map symbol",
                "Unit state",
                "Leaders",
                "Personnel",
                { label: "TO&E/S", title: "Table of organization, equipment and supplies" },
                "Map display",
                "Properties",
                "Transform",
            ],
    );

    const unit = computed(() => {
        return getUnitById(props.unitId);
    });

    const initialLocation = computed<Position | null>(() => {
        const st: any[] = (unit.value as any)?.state ?? [];
        let best: any = null;

        for (const e of st) {
            if (!e || !e.location) continue;
            const t = Number(e.t);
            if (!Number.isFinite(t)) continue;

            if (!best || t < Number(best.t)) best = e;
        }

        return (best?.location as Position) ?? ((unit.value as any)?.location ?? null);
    });

    const unitStatus = computed(() => {
        const status = unit.value._state?.status || unit.value.status;
        return status ? unitStatusMap[status]?.name : undefined;
    });

    const isLocked = computed(() => isUnitLocked(props.unitId));

    const geoStore = useGeoStore();
    const unitSettings = useUnitSettingsStore();
    const { getModalSidc } = injectStrict(sidcModalKey);

    const unitMenuItems = computed((): MenuItemData[] => [
        {
            label: "Change symbol",
            action: () => handleChangeSymbol(),
            disabled: isLocked.value,
        },
        { label: "Edit unit data", action: () => toggleEditMode(), disabled: isLocked.value },
        {
            label: "Add or change image",
            action: () => toggleEditMediaMode(),
            disabled: isLocked.value,
        },
        { label: "Remove unit image", action: () => removeMedia(), disabled: isLocked.value },
        unit.value.locked
            ? {
                label: "Unlock unit",
                action: () => setLocked(false),
                disabled: isUnitLocked(props.unitId, { excludeUnit: true }),
            }
            : {
                label: "Lock unit",
                action: () => setLocked(true),
                disabled: isUnitLocked(props.unitId, { excludeUnit: true }),
            },
    ]);

    watchEffect((onCleanup) => {
        const el = unrefElement(elRef.value) as HTMLElement | null;
        if (!el) return;
        const dndFunction = draggable({
            element: el,
            getInitialData: () => getUnitDragItem({ unit: unit.value }, "detailsPanel"),
            onDragStart: () => (isDragged.value = true),
            onDrop: () => (isDragged.value = false),
            canDrag: () => !isUnitLocked(unit.value.id),
            onGenerateDragPreview({ nativeSetDragImage }) {
                setCustomNativeDragPreview({
                    getOffset: pointerOutsideOfPreview({ x: "16px", y: "8px" }),
                    render: ({ container }) => {
                        return render(
                            h(MilitarySymbol, {
                                sidc: unit.value.sidc,
                                options: combinedSymbolOptions.value,
                                size: 25,
                            }),
                            container,
                        );
                    },
                    nativeSetDragImage,
                });
            },
        });

        onCleanup(() => dndFunction());
    });

    watch(
        () => unit.value?.name,
        () => {
            unitName.value = unit.value?.name;
        },
        { immediate: true },
    );
    watch(
        () => unit.value?.shortName,
        () => {
            shortName.value = unit.value?.shortName || "";
        },
        { immediate: true },
    );
    watch(
        () => (unit.value as any)?.unitNumber,
        () => {
            unitNumber.value = (unit.value as any)?.unitNumber || "";
        },
        { immediate: true },
    );
    watch(
        () => unitSettings.editHistory,
        (v) => {
            if (v && !unitSettings.showHistory) {
                unitSettings.showHistory = true;
            }
        },
    );

    const combinedSymbolOptions = computed(() => {
        return { ...getCombinedSymbolOptions(unit.value), outlineWidth: 8 };
    });

    const unitSidc = computed(() => unit.value._state?.sidc || unit.value.sidc);

    const _locHandlers = new Set<(pos: any) => void>();
    function onGetLocation(cb: (pos: any) => void) {
        _locHandlers.add(cb);
    }

    const isGetLocationActive = ref(false);
    let startGetLocation: () => void = () => { };

    if (geoStore.olMap) {
        // 2D mode (OpenLayers)
        const mapLoc = useGetMapLocation(geoStore.olMap as OLMap);
        startGetLocation = mapLoc.start;

        watch(
            mapLoc.isActive,
            (v) => {
                isGetLocationActive.value = v;
            },
            { immediate: true },
        );

        mapLoc.onGetLocation((pos) => {
            _locHandlers.forEach((h) => h(pos));
        });
    } else {
        // 3D mode (Cesium)
        const ia = useInteractionAdapter();
        startGetLocation = () => {
            isGetLocationActive.value = true;
            ia.requestLocationPick((pos) => {
                try {
                    _locHandlers.forEach((h) => h(pos));
                } finally {
                    isGetLocationActive.value = false;
                }
            });
        };
    }

    const uiStore = useUiStore();
    const { selectedUnitIds, clear: clearSelection } = useSelectedItems();
    const isMultiMode = computed(() => selectedUnitIds.value.size > 1);


    onGetLocation((location) => {
        const pos = location as Position;

        if (isMultiMode.value) {
            store.groupUpdate(() => {
                selectedUnitIds.value.forEach((id) => addUnitPosition(String(id), pos));
            });
            return;
        }

        addUnitPosition(props.unitId, pos);
    });

    const selectedUnits = computed(() =>
        [...selectedUnitIds.value].map((id) => getUnitById(id)),
    );

    const visibleSelectedUnits = computed(() => {
        if (selectedUnits.value.length > 50 && truncateUnits.value) {
            return selectedUnits.value.slice(0, 50);
        }
        return selectedUnits.value;
    });

    const isTruncated = computed(
        () => selectedUnits.value.length > visibleSelectedUnits.value.length,
    );
    const isEditMode = ref(false);
    const toggleEditMode = useToggle(isEditMode);

    const isEditMediaMode = ref(false);
    const toggleEditMediaMode = useToggle(isEditMediaMode);

    function commitUnitField(field: "name" | "shortName" | "unitNumber", nextRaw: any) {
        const next = (nextRaw ?? "").toString();
        const cur = ((unit.value as any)?.[field] ?? "").toString();

        // Prevent redundant updates that cause label redraw "twitch"
        if (next === cur) return;

        updateUnit(props.unitId, { [field]: next } as any);
    }


    const onFormSubmit = (unitUpdate: UnitUpdate) => {
        updateUnit(props.unitId, unitUpdate);
        toggleEditMode();
    };

    function removeMedia() {
        updateUnit(props.unitId, { media: [] });
    }

    function setLocked(locked: boolean) {
        updateUnitLocked(props.unitId, locked);
    }

    const hDescription = computed(() => renderMarkdown(unit.value.description || ""));
    const hasPosition = computed(() => Boolean(unit.value._state?.location));
    const media = computed(() => {
        const { media } = unit.value;
        if (!media || isMultiMode.value) return;
        return media[0];
    });

    watch(
        isEditMode,
        (v) => {
            if (!v) return;
            isEditMediaMode.value = false;
            selectedTab.value = 0;
        },
        { immediate: true },
    );

    watch(isEditMediaMode, (v) => {
        if (!v) return;
        isEditMode.value = false;
        selectedTab.value = 0;
    });

    watch(
        isGetLocationActive,
        (isActive) => {
            uiStore.getLocationActive = isActive;
        },
        { immediate: true },
    );

    const { onUnitAction } = useUnitActions();

    function tryZoom3D(units: any | any[]): boolean {
        const g: any = (window as any)?.MentatGlobe;
        if (!g || typeof g.flyToLatLon !== "function") return false;

        const arr = Array.isArray(units) ? units : [units];

        const pts = arr
            .map((u) => (u as any)?._state?.location ?? (u as any)?.location ?? null)
            .filter(Boolean) as Position[];

        if (!pts.length) return false;

        // If multiple, fly to the centroid. If single, fly to that point.
        let lon = pts[0][0];
        let lat = pts[0][1];

        if (pts.length > 1) {
            let minLon = lon, maxLon = lon, minLat = lat, maxLat = lat;
            for (const p of pts) {
                minLon = Math.min(minLon, p[0]);
                maxLon = Math.max(maxLon, p[0]);
                minLat = Math.min(minLat, p[1]);
                maxLat = Math.max(maxLat, p[1]);
            }
            lon = (minLon + maxLon) / 2;
            lat = (minLat + maxLat) / 2;
        }

        // Height heuristic (meters): closer for single unit, higher for multi-selection
        const height = pts.length > 1 ? 200000 : 12000;

        g.flyToLatLon(lon, lat, height);
        return true;
    }

    function actionWrapper(action: UnitAction) {
        // 3D zoom fallback: use Cesium camera if available
        if (action === UnitActions.Zoom) {
            if (isMultiMode.value) {
                if (tryZoom3D(selectedUnits.value)) return;
            } else {
                if (tryZoom3D(unit.value)) return;
            }
            // if not in 3D / no positions, fall through to 2D behavior
        }

        if (isMultiMode.value) {
            onUnitAction(selectedUnits.value, action);
            return;
        }
        onUnitAction(unit.value, action);
    }

    function updateMedia(mediaUpdate: MediaUpdate) {
        if (!mediaUpdate) return;
        const { media = [] } = unit.value;
        const newMedia = { ...media[0], ...mediaUpdate };
        updateUnit(props.unitId, { media: [newMedia] });
        isEditMediaMode.value = false;
    }

    const buttonItems = computed(() => [
        {
            label: "Duplicate",
            onClick: () => actionWrapper(UnitActions.Clone),
            disabled: isLocked.value,
        },
        {
            label: "Duplicate (with state)",
            onClick: () => actionWrapper(UnitActions.CloneWithState),
            disabled: isLocked.value,
        },
        {
            label: "Duplicate hierarchy",
            onClick: () => actionWrapper(UnitActions.CloneWithSubordinates),
            disabled: isLocked.value,
        },
        {
            label: "Duplicate hierarchy (with state)",
            onClick: () => actionWrapper(UnitActions.CloneWithSubordinatesAndState),
            disabled: isLocked.value,
        },
        {
            label: "Move up",
            onClick: () => actionWrapper(UnitActions.MoveUp),
            disabled: isLocked.value,
        },
        {
            label: "Move down",
            onClick: () => actionWrapper(UnitActions.MoveDown),
            disabled: isLocked.value,
        },
        {
            label: "Create subordinate",
            onClick: () => actionWrapper(UnitActions.AddSubordinate),
            disabled: isLocked.value,
        },
        {
            label: "Zoom",
            onClick: () => actionWrapper(UnitActions.Zoom),
        },
        {
            label: "Pan",
            onClick: () => actionWrapper(UnitActions.Pan),
            disabled: !hasPosition.value,
        },
        {
            label: "Delete",
            onClick: () => actionWrapper(UnitActions.Delete),
            disabled: isLocked.value,
        },
        {
            label: "Clear state",
            onClick: () => actionWrapper(UnitActions.ClearState),
            disabled: isLocked.value,
        },
    ]);

    async function handleChangeSymbol() {
        if (isLocked.value) return;
        const newSidcValue = await getModalSidc(unit.value.sidc, {
            symbolOptions: unit.value.symbolOptions,
            inheritedSymbolOptions: getCombinedSymbolOptions(unit.value, true),
            reinforcedStatus: unit.value.reinforcedStatus,
        });
        if (newSidcValue !== undefined) {
            const { sidc, symbolOptions = {}, reinforcedStatus } = newSidcValue;
            const dataUpdate: UnitUpdate = { sidc, symbolOptions };
            if (reinforcedStatus) dataUpdate.reinforcedStatus = reinforcedStatus;
            if (isMultiMode.value) {
                store.groupUpdate(() =>
                    selectedUnitIds.value.forEach((unitId) => {
                        const { side } = getUnitHierarchy(unitId);
                        dataUpdate.sidc = setCharAt(sidc, SID_INDEX, side.standardIdentity);
                        updateUnit(unitId, dataUpdate);
                    }),
                );
            } else updateUnit(props.unitId, dataUpdate);
        }
    }

    function locateInOrbat() {
        onUnitSelectHook.trigger({ unitId: props.unitId, options: { noZoom: true } });
    }
</script>
<template>
    <div v-if="unit" class="@container" :key="unit.id">
        <ItemMedia v-if="media" :media="media" />
        <header class="-mx-4 px-2 pt-2">
            <div class="flex flex-col">
                <!-- Row 1: SIDC + editable fields (discrete row) -->
                <div class="mb-3">
                    <div v-if="!isMultiMode" class="flex items-start gap-3">
                        <!-- Bigger SIDC box -->
                        <button type="button"
                                class="inline-flex h-24 w-20 shrink-0 items-center justify-center rounded-md"
                                @click="handleChangeSymbol()"
                                ref="elRef">
                            <MilitarySymbol :sidc="unitSidc" :size="46" :options="combinedSymbolOptions" />
                        </button>

                        <!-- Fields (full width to the right of SIDC) -->
                        <div class="flex-auto pr-4">
                            <div class="grid w-full">
                                <!-- Name -->
                                <div class="relative w-full min-h-8">
                                    <span v-if="!unitName"
                                          class="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-gray-400 dark:text-slate-500">
                                        Name
                                    </span>
                                    <EditableLabel v-model="unitName"
                                                   @update-value="commitUnitField('name', $event)"
                                                   class="relative z-10 w-full bg-transparent"
                                                   text-class="text-sm font-semibold text-gray-700 dark:text-slate-100"
                                                   :disabled="isLocked" />
                                </div>

                                <!-- Short name -->
                                <div class="relative w-full min-h-6">
                                    <span v-if="!shortName"
                                          class="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-gray-400 dark:text-slate-500">
                                        Short name
                                    </span>
                                    <EditableLabel v-model="shortName"
                                                   @update-value="commitUnitField('shortName', $event)"
                                                   class="relative z-10 w-full bg-transparent"
                                                   text-class="text-sm font-semibold text-gray-700 dark:text-slate-100"
                                                   :disabled="isLocked" />
                                </div>

                                <!-- Unit number -->
                                <div class="relative w-full min-h-6">
                                    <span v-if="!unitNumber"
                                          class="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-gray-400 dark:text-slate-500">
                                        Unit number
                                    </span>
                                    <EditableLabel v-model="unitNumber"
                                                   @update-value="commitUnitField('shortName', $event)"
                                                   class="relative z-10 w-full bg-transparent"
                                                   text-class="text-sm font-semibold text-gray-700 dark:text-slate-100"
                                                   :disabled="isLocked" />
                                </div>
                            </div>
                        </div>

                        <!-- Lock + status (right edge) -->
                        <div class="flex flex-col items-end gap-2 pt-1">
                            <IconLockOutline v-if="isLocked" class="size-5 text-gray-400" />
                            <div v-if="unitStatus">
                                <span class="inline-flex items-center rounded-full bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-500/10 ring-inset">
                                    {{ unitStatus }}
                                </span>
                            </div>
                        </div>
                    </div>

                    <!-- Multi-select header (keep your existing block) -->
                    <div v-else>
                        <div class="flex items-center justify-between">
                            <p class="font-medium">{{ selectedUnitIds.size }} units selected</p>
                            <Button type="button" size="sm" variant="outline" @click="clearSelection()">Clear</Button>
                        </div>

                        <ul class="relative my-4 flex w-full flex-wrap gap-1 pb-4">
                            <li v-for="sUnit in visibleSelectedUnits" class="relative flex">
                                <MilitarySymbol :sidc="sUnit.sidc"
                                                :size="24"
                                                class="block"
                                                :options="{ ...getCombinedSymbolOptions(sUnit), outlineWidth: 8 }" />
                                <span v-if="sUnit._state?.location" class="text-red-700">&deg;</span>
                            </li>

                            <li v-if="isTruncated">
                                <button type="button"
                                        class="bg-opacity-80 absolute right-0 bottom-0 left-0 border bg-white p-2 text-center text-gray-600"
                                        @click="truncateUnits = !truncateUnits">
                                    +{{ selectedUnits.length - visibleSelectedUnits.length }}
                                </button>
                            </li>
                        </ul>
                    </div>
                </div>

                <!-- Row 2: controls (discrete row; no negative margin) -->
                <nav class="mb-4 relative flex items-center">
                    <!-- Centered controls (do not shift when dots width changes) -->
                    <div class="absolute left-1/2 -translate-x-1/2 flex items-center gap-0.5">
                        <IconButton title="Zoom to" @click="actionWrapper(UnitActions.Zoom)">
                            <ZoomIcon class="size-5" />
                        </IconButton>

                        <IconButton title="Edit unit"
                                    @click="toggleEditMode()"
                                    :disabled="isMultiMode || isLocked"
                                    :class="[
        'unitdock-toggle-btn',
        isEditMode ? 'unitdock-toggle-btn--active' : ''
      ]">
                            <EditIcon class="size-5" />
                        </IconButton>

                        <IconButton title="Add/modify unit image"
                                    @click="toggleEditMediaMode()"
                                    :disabled="isMultiMode || isLocked"
                                    :class="[
        'unitdock-toggle-btn',
        isEditMediaMode ? 'unitdock-toggle-btn--active' : ''
      ]">
                            <ImageIcon class="size-5" />
                        </IconButton>

                        <IconButton @click="startGetLocation()"
                                    title="Set unit location"
                                    :disabled="isMultiMode || isLocked">
                            <IconCrosshairsGps class="size-5" aria-hidden="true" />
                        </IconButton>

                        <IconButton title="Show in ORBAT" :disabled="isMultiMode" @click="locateInOrbat()">
                            <TreeLocateIcon class="size-5" aria-hidden="true" />
                        </IconButton>

                        <SplitButton triggerClass="max-w-24"
                                     buttonClass="unit-actions-btn"
                                     caretButtonClass="unit-actions-btn"
                                     :items="buttonItems"
                                     v-model:active-item="uiStore.activeItem" />
                    </div>

                    <!-- Right-aligned dots (stays right; doesn't move center group) -->
                    <div class="ml-auto flex items-center justify-end unitdock-dots">
                        <DotsMenu :items="unitMenuItems" />
                    </div>
                </nav>
            </div>
        </header>

        <TabWrapper :tab-list="tabList" v-model="selectedTab">
            <TabPanel class="pt-4">
                <section class="relative" v-if="!isMultiMode">
                    <EditMetaForm v-if="isEditMode"
                                  :item="unit"
                                  @update="onFormSubmit"
                                  @cancel="toggleEditMode()" />
                    <EditMediaForm v-else-if="isEditMediaMode"
                                   :media="media"
                                   @cancel="toggleEditMediaMode()"
                                   @update="updateMedia" />
                    <div v-else-if="!isMultiMode" class="mb-4 space-y-4">
                        <DescriptionItem label="Name">{{ unit.name }}</DescriptionItem>
                        <DescriptionItem v-if="unit.shortName" label="Short name">{{ unit.shortName }}</DescriptionItem>
                        <DescriptionItem v-if="unit.unitNumber" label="Unit number">{{ unit.unitNumber }}</DescriptionItem>
                        <DescriptionItem v-if="unit.externalUrl"
                                         label="External URL"
                                         dd-class="truncate">
                            <a target="_blank"
                               draggable="false"
                               class="underline"
                               :href="unit.externalUrl">{{ unit.externalUrl }}</a>
                        </DescriptionItem>
                        <DescriptionItem v-if="unit.description" label="Description">
                            <div class="prose prose-sm dark:prose-invert" v-html="hDescription"></div>
                        </DescriptionItem>

                        <DescriptionItem v-if="initialLocation" label="Initial location">
                            <div class="flex items-center justify-between">
                                <p>{{ formatPosition(initialLocation) }}</p>
                                <IconButton @click="geoStore.panToLocation(initialLocation)">
                                    <IconCrosshairsGps class="h-5 w-5" />
                                </IconButton>
                            </div>
                        </DescriptionItem>
                    </div>
                </section>
                <p v-else class="p-2 pt-4 text-sm">Multi edit mode not supported yet.</p>
            </TabPanel>
            <TabPanel>
                <UnitDetailsSymbol :unit="unit"
                                   :key="unit.id"
                                   :is-multi-mode="isMultiMode"
                                   :is-locked="isLocked" />
            </TabPanel>
            <TabPanel>
                <UnitPanelState v-if="!isMultiMode" :unit="unit" :is-locked="isLocked" />
                <p v-else class="p-2 pt-4 text-sm">Multi edit mode not supported yet.</p>
            </TabPanel>

            <TabPanel>
                <div class="leaders-panel">
                    <UnitDetailsLeaders v-if="!isMultiMode" :unit="unit" :is-locked="isLocked" />
                    <p v-else class="p-2 pt-4 text-sm">Multi edit mode not supported yet.</p>
                </div>
            </TabPanel>

            <TabPanel>
                <UnitDetailsPersonnel v-if="!isMultiMode" :unit="unit" :is-locked="isLocked" />
                <p v-else class="p-2 pt-4 text-sm">Multi edit mode not supported yet.</p>
            </TabPanel>

            <TabPanel>
                <UnitDetailsToe :unit="unit" :is-locked="isLocked" />
            </TabPanel>
            <TabPanel>
                <UnitDetailsMapDisplay :unit="unit"
                                       :is-multi-mode="isMultiMode"
                                       :is-locked="isLocked" />
            </TabPanel>
            <TabPanel>
                <UnitDetailsProperties v-if="!isMultiMode" :unit="unit" :is-locked="isLocked" />
                <p v-else class="p-2 pt-4 text-sm">Multi edit mode not supported yet.</p>
            </TabPanel>
            <TabPanel>
                <FeatureTransformations class="mt-4" unitMode />
            </TabPanel>

            <TabPanel v-if="uiStore.debugMode" class="prose prose-sm max-w-none">
                <pre>{{ unit }}</pre>
            </TabPanel>
        </TabWrapper>
        <GlobalEvents v-if="uiStore.shortcutsEnabled"
                      :filter="inputEventFilter"
                      @keyup.e="toggleEditMode()" />
    </div>
</template>
