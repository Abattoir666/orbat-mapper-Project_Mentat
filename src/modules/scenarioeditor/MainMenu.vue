<script setup lang="ts">
    import {
        DropdownMenu,
        DropdownMenuCheckboxItem,
        DropdownMenuContent,
        DropdownMenuItem,
        DropdownMenuRadioGroup,
        DropdownMenuRadioItem,
        DropdownMenuSeparator,
        DropdownMenuShortcut,
        DropdownMenuSub,
        DropdownMenuSubContent,
        DropdownMenuSubTrigger,
        DropdownMenuTrigger,
    } from "@/components/ui/dropdown-menu";
    import { ChevronDownIcon } from "@heroicons/vue/20/solid";
    import { useUiStore } from "@/stores/uiStore";
    import { LANDING_PAGE_ROUTE } from "@/router/names";

    import type { ScenarioActions, UiAction } from "@/types/constants";
    import { useRoute } from "vue-router";
    import { useMapSettingsStore } from "@/stores/mapSettingsStore";
    import { storeToRefs } from "pinia";
    import { useMeasurementsStore } from "@/stores/geoStore";
    import { breakpointsTailwind, useBreakpoints } from "@vueuse/core";
    import { injectStrict } from "@/utils";
    import { activeScenarioKey } from "@/components/injects";
    import brandMark from "@/components/ui/Icons/Mentat.png?url";

    import { useCollabConnectionStore } from "@/stores/collabConnectionStore";
    import { useCollabPresenceStore } from "@/stores/collabPresenceStore";

    import { computed, ref } from "vue";
    import CollabPanel from "@/components/collab/CollabPanel.vue";

    const showCollabPanel = ref(false);

    const onBrandClick = () => {
        window.open("https://www.patreon.com/Analytica_Camillus", "_blank", "noopener");
    };

    const breakpoints = useBreakpoints(breakpointsTailwind);
    const isMobile = breakpoints.smallerOrEqual("md");

    const emit = defineEmits<{
        action: [value: ScenarioActions];
        uiAction: [value: UiAction];
    }>();

    // IMPORTANT: keep a real reference to the injected scenario (so we can get scenario id)
    const scenario = injectStrict(activeScenarioKey);
    const scenarioStore = scenario.store;

    // Existing undo/redo wiring
    const { undo, redo, canRedo, canUndo } = scenarioStore;

    // Active scenario content id (used for POST /api/sessions)
    const scenarioContentId = computed(() => String(scenarioStore.state?.id ?? ""));

    const route = useRoute();
    const uiSettings = useUiStore();

    const { coordinateFormat, showLocation, showScaleLine, showDayNightTerminator } =
        storeToRefs(useMapSettingsStore());

    const { measurementUnit } = storeToRefs(useMeasurementsStore());

    // Collab indicator state
    const collabConn = useCollabConnectionStore();
    const presence = useCollabPresenceStore();

    function statusLabel(): string {
        if (!collabConn.enabled) return "Solo";
        if (collabConn.status === "connecting") return "Multi-user: connecting…";
        if (collabConn.status === "error") return "Multi-user: error";
        return "Multi-user";
    }

    function statusPillClass(): string {
        // keep subtle + consistent with your existing gray palette
        return "bg-gray-800/70 text-gray-200";
    }
</script>

<template>
    <div class="flex items-center gap-2">
        <DropdownMenu>
            <DropdownMenuTrigger as="div" class="bg-opacity-50 relative bg-gray-900">
                <button class="group flex items-center">
                    <svg class="block h-7 w-auto shrink-0 fill-gray-700 stroke-gray-300"
                         stroke="currentColor"
                         viewBox="41 41 118 118">
                        <path d="m100 45 55 25v60l-55 25-55-25V70z" stroke-width="6" />
                        <path d="m45 70 110 60m-110 0 110-60" stroke-width="6" />
                        <circle cx="100" cy="70" r="10" class="fill-gray-300" />
                    </svg>

                    <span class="ml-2 hidden font-medium tracking-tight sm:block">
                        ORBAT-Mapper — PROJECT Mentat
                    </span>

                    <ChevronDownIcon class="ml-1 h-5 w-5 text-gray-400 group-hover:text-gray-200"
                                     aria-hidden="true" />
                </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent class="" align="start" :side-offset="10">
                <DropdownMenuItem as-child>
                    <router-link :to="{ name: LANDING_PAGE_ROUTE }" class="font-medium">
                        Home
                    </router-link>
                </DropdownMenuItem>

                <DropdownMenuSeparator />
                <DropdownMenuItem @select="emit('uiAction', 'showSearch')">
                    Search
                    <DropdownMenuShortcut class="ml-4">Ctrl/⌘ K</DropdownMenuShortcut>
                </DropdownMenuItem>

                <DropdownMenuSeparator />
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>File</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                        <DropdownMenuItem @select="emit('action', 'exportJson')">
                            Download scenario
                        </DropdownMenuItem>
                        <DropdownMenuItem @select="emit('action', 'save')">
                            Save scenario
                        </DropdownMenuItem>
                        <DropdownMenuItem @select="emit('action', 'loadNew')">
                            Load scenario...
                        </DropdownMenuItem>
                        <DropdownMenuItem @select="emit('action', 'createNew')">
                            New scenario...
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />
                        <DropdownMenuItem @select="emit('action', 'export')">
                            Export scenario data...
                        </DropdownMenuItem>
                        <DropdownMenuItem @select="emit('action', 'exportToImage')">
                            Export as image
                        </DropdownMenuItem>
                        <DropdownMenuItem @select="emit('action', 'import')">
                            Import data...
                        </DropdownMenuItem>
                        <DropdownMenuItem @select="emit('action', 'exportToClipboard')">
                            Copy scenario to clipboard
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem @select="emit('action', 'duplicate')">
                            Duplicate scenario
                        </DropdownMenuItem>
                        <DropdownMenuItem @select="emit('action', 'showInfo')">
                            Show scenario info
                        </DropdownMenuItem>
                    </DropdownMenuSubContent>
                </DropdownMenuSub>

                <DropdownMenuSub>
                    <DropdownMenuSubTrigger><span>Edit</span></DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                        <DropdownMenuItem @select="undo()" :disabled="!canUndo">
                            Undo
                            <DropdownMenuShortcut class="ml-4">Ctrl/⌘ Z</DropdownMenuShortcut>
                        </DropdownMenuItem>
                        <DropdownMenuItem @select="redo()" :disabled="!canRedo">
                            Redo
                            <DropdownMenuShortcut class="ml-4">Ctrl/⌘ shift Z</DropdownMenuShortcut>
                        </DropdownMenuItem>
                    </DropdownMenuSubContent>
                </DropdownMenuSub>

                <DropdownMenuSub>
                    <DropdownMenuSubTrigger><span class="mr-4">View</span></DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                        <DropdownMenuCheckboxItem v-model="uiSettings.showToolbar" @select.prevent>
                            Map toolbar
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem v-model="uiSettings.showTimeline" @select.prevent>
                            Timeline
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem v-if="!isMobile"
                                                  v-model="uiSettings.showLeftPanel"
                                                  @select.prevent>
                            ORBAT panel
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem v-model="uiSettings.showOrbatBreadcrumbs" @select.prevent>
                            Unit breadcrumbs
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuCheckboxItem v-model="showScaleLine" @select.prevent>
                            Scale line
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem v-model="showLocation" @select.prevent>
                            Pointer location
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem v-model="showDayNightTerminator" @select.prevent>
                            Day/nigth terminator
                        </DropdownMenuCheckboxItem>

                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger inset>
                                <span class="pr-4">Measurement units</span>
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                                <DropdownMenuRadioGroup v-model="measurementUnit">
                                    <DropdownMenuRadioItem value="metric" @select.prevent>
                                        Metric
                                    </DropdownMenuRadioItem>
                                    <DropdownMenuRadioItem value="imperial" @select.prevent>
                                        Imperial
                                    </DropdownMenuRadioItem>
                                    <DropdownMenuRadioItem value="nautical" @select.prevent>
                                        Nautical
                                    </DropdownMenuRadioItem>
                                </DropdownMenuRadioGroup>
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>

                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger inset>Coordinate format</DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                                <DropdownMenuRadioGroup v-model="coordinateFormat">
                                    <DropdownMenuRadioItem value="dms" @select.prevent>
                                        Degrees, minutes, seconds
                                    </DropdownMenuRadioItem>
                                    <DropdownMenuRadioItem value="dd" @select.prevent>
                                        Decimal degrees
                                    </DropdownMenuRadioItem>
                                    <DropdownMenuRadioItem value="MGRS" @select.prevent>
                                        MGRS
                                    </DropdownMenuRadioItem>
                                </DropdownMenuRadioGroup>
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
            </DropdownMenuContent>
        </DropdownMenu>

        <!-- Collab status button (Solo / Multi-user) -->
        <div class="relative flex items-center">
            <button type="button"
                    class="rounded-full px-3 py-1 text-xs font-medium ring-1 ring-gray-700 hover:ring-gray-500"
                    :class="statusPillClass()"
                    @click="showCollabPanel = !showCollabPanel"
                    title="Collaboration">
                {{ statusLabel() }}
                <span v-if="collabConn.enabled && presence.onlineList.length" class="ml-2 text-gray-300">
                    {{ presence.onlineList.length }}
                </span>
            </button>

            <div v-if="showCollabPanel" class="absolute left-0 top-8 z-50">
                <CollabPanel :scenario-content-id="scenarioContentId"
                             @close="showCollabPanel = false" />
            </div>
        </div>

        <button type="button" @click="onBrandClick" class="flex items-center">
            <img :src="brandMark" alt="Brand" class="h-6 w-6" draggable="false" />
        </button>
    </div>
</template>
