<script setup lang="ts">
    import { injectStrict } from "@/utils";
    import { activeScenarioKey, timeModalKey } from "@/components/injects";
    import { computed } from "vue";
    import type { NScenarioEvent } from "@/types/internalModels";
    import PanelHeading from "@/components/PanelHeading.vue";
    import { useTimeFormatStore } from "@/stores/timeFormatStore";
    import ScenarioEventDropdownMenu from "@/modules/scenarioeditor/ScenarioEventDropdownMenu.vue";
    import type { ScenarioEventAction } from "@/types/constants";
    import { useSelectedItems } from "@/stores/selectedStore";
    import { Button } from "@/components/ui/button";

    import { resolveEventIcon } from "@/modules/scenarioeditor/ExtendedScenarioEvents/eventIconRegistry";

    interface Props {
        selectOnly?: boolean;
        hideDropdown?: boolean;
    }

    const props = withDefaults(defineProps<Props>(), {
        selectOnly: false,
        hideDropdown: false,
    });
    const emit = defineEmits(["event-click"]);

    const activeScenario = injectStrict(activeScenarioKey);
    const { store } = activeScenario as any;
    const helpers = (activeScenario as any)?.helpers;

    const {
        time: { goToScenarioEvent, deleteScenarioEvent, updateScenarioEvent, addScenarioEvent },
    } = activeScenario as any;

    const { getModalTimestamp } = injectStrict(timeModalKey);
    const { activeScenarioEventId } = useSelectedItems();
    const fmt = useTimeFormatStore();

    const events = computed(() => store.state.events.map((id: string) => store.state.eventMap[id]));
    const t = computed(() => store.state.currentTime);

    function onEventClick(event: NScenarioEvent) {
        if (!props.selectOnly) goToScenarioEvent(event);
        emit("event-click", event);
    }

    async function onAction(action: ScenarioEventAction, eventId: string) {
        const scenarioEvent = store.state.eventMap[eventId];
        if (!scenarioEvent) return;
        switch (action) {
            case "changeTime": {
                const newTimestamp = await getModalTimestamp(scenarioEvent.startTime, {
                    timeZone: store.state.info.timeZone,
                    title: "Set scenario event time",
                });
                if (newTimestamp !== undefined) {
                    updateScenarioEvent(eventId, { startTime: newTimestamp });
                }
                break;
            }
            case "delete":
                deleteScenarioEvent(eventId);
                break;
        }
    }

    function addEvent() {
        const day = new Date(t.value).getDate();
        const eventId = addScenarioEvent({ title: `Event ${day}`, startTime: t.value });
        activeScenarioEventId.value = eventId;
    }

    function iconForEvent(ev: any): string {
        return resolveEventIcon((ev?.category as string) || "generic");
    }

    // --- color helpers (unit color, then side color, then null) ---
    function parseColorToRgb(c: string | null | undefined): { r: number; g: number; b: number } | null {
        if (!c) return null;
        const s = c.trim();
        const hex = s.startsWith("#") ? s.slice(1) : s;

        if (/^[0-9a-fA-F]{3}$/.test(hex)) {
            const r = parseInt(hex[0] + hex[0], 16);
            const g = parseInt(hex[1] + hex[1], 16);
            const b = parseInt(hex[2] + hex[2], 16);
            return { r, g, b };
        }
        if (/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) {
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            return { r, g, b };
        }

        const m = s.match(/rgba?\s*\(\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)/i);
        if (m) {
            const r = Number(m[1]);
            const g = Number(m[2]);
            const b = Number(m[3]);
            if ([r, g, b].every((v) => Number.isFinite(v) && v >= 0 && v <= 255)) return { r, g, b };
        }

        return null;
    }

    function pickUnitColor(u: any): string | null {
        const c =
            u?.color ??
            u?.iconColor ??
            u?.style?.color ??
            u?.style?.iconColor ??
            u?.style?.stroke ??
            u?.symbolOptions?.color ??
            u?.symbolOptions?.fillColor ??
            u?.meta?.color ??
            u?.appearance?.color ??
            null;

        return typeof c === "string" && c.trim() ? c.trim() : null;
    }

    function pickSideColor(side: any): string | null {
        const c =
            side?.color ??
            side?.style?.color ??
            side?.style?.stroke ??
            side?.meta?.color ??
            null;

        return typeof c === "string" && c.trim() ? c.trim() : null;
    }

    function getUnitOrSideRgb(unitId: string): { r: number; g: number; b: number } | null {
        if (!unitId) return null;

        let unit: any = null;
        try {
            unit = helpers?.getUnitById ? helpers.getUnitById(unitId) : null;
        } catch {
            unit = null;
        }

        const unitRgb = parseColorToRgb(pickUnitColor(unit));
        if (unitRgb) return unitRgb;

        // Fallback to side color if unit has no explicit color
        const sideId = unit?.sideId ?? unit?.SideId ?? null;
        if (!sideId) return null;

        let side: any = null;
        try {
            side = helpers?.getSideById ? helpers.getSideById(sideId) : null;
        } catch {
            side = null;
        }

        return parseColorToRgb(pickSideColor(side));
    }

    function averageRgbFromUnitIds(ids: string[]): { r: number; g: number; b: number } | null {
        const rgbs: Array<{ r: number; g: number; b: number }> = [];
        for (const id of ids) {
            const rgb = getUnitOrSideRgb(String(id));
            if (rgb) rgbs.push(rgb);
        }
        if (!rgbs.length) return null;

        const r = rgbs.reduce((a, c) => a + c.r, 0) / rgbs.length;
        const g = rgbs.reduce((a, c) => a + c.g, 0) / rgbs.length;
        const b = rgbs.reduce((a, c) => a + c.b, 0) / rgbs.length;
        return { r, g, b };
    }

    function rgba(rgb: { r: number; g: number; b: number }, a: number): string {
        const r = Math.max(0, Math.min(255, Math.round(rgb.r)));
        const g = Math.max(0, Math.min(255, Math.round(rgb.g)));
        const b = Math.max(0, Math.min(255, Math.round(rgb.b)));
        const alpha = Math.max(0, Math.min(1, a));
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function circleStyleForEvent(ev: any): Record<string, string> {
        const ids: string[] = Array.isArray(ev?.involvedUnitIds) ? ev.involvedUnitIds.map((x: any) => String(x)) : [];
        const avg = ids.length ? averageRgbFromUnitIds(ids) : null;

        // No affiliated unit (or no usable color) -> hollow black
        if (!avg) {
            return {
                backgroundColor: "transparent",
                border: "2px solid rgba(0,0,0,0.90)",
            };
        }

        // Affiliated -> unit/side color at 50% transparency
        return {
            backgroundColor: rgba(avg, 0.50),
            border: `2px solid ${rgba(avg, 0.90)}`,
        };
    }
</script>

<template>
    <div class="p-0.5">
        <PanelHeading>Scenario events</PanelHeading>

        <div class="flow-root">
            <ul class="mt-4">
                <li v-for="(event, eventIdx) in events" :key="event.id" class="group flex">
                    <div class="relative flex-auto pb-4">
                        <span v-if="eventIdx !== events.length - 1"
                              class="absolute top-2 left-2 -ml-px h-full w-0.5 bg-gray-200"
                              aria-hidden="true" />
                        <div class="relative flex space-x-4">
                            <button @click="onEventClick(event)"
                                    class="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full ring-4 ring-white"
                                    :style="circleStyleForEvent(event)"
                                    title="Jump to event">
                                <img :src="iconForEvent(event)"
                                     alt=""
                                     class="h-3.5 w-3.5"
                                     draggable="false" />
                            </button>

                            <div class="min-w-0 flex-1 cursor-pointer text-sm" @click="onEventClick(event)">
                                <p class="text-xs font-medium text-red-900">
                                    {{ fmt.scenarioDateFormatter.format(event.startTime) }}
                                </p>
                                <p class="font-medium">{{ event.title }}</p>
                                <p v-if="event.subTitle" class="text-gray-700">
                                    {{ event.subTitle }}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div v-if="!hideDropdown"
                         class="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                        <ScenarioEventDropdownMenu hide-edit @action="onAction($event, event.id)" />
                    </div>
                </li>
            </ul>
        </div>

        <Button v-if="!selectOnly" size="sm" variant="outline" @click="addEvent()" class="mt-4">
            Add scenario event
        </Button>
    </div>
</template>
