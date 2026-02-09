<script setup lang="ts">
    import ScenarioEventDetails from "@/modules/scenarioeditor/ScenarioEventDetails.vue";
    import ScenarioEventsList3D from "@/modules/threeDView/objects/ScenarioEvents3D/ScenarioEventsList3D.vue";
    import { useScenarioEventSelection3D } from "@/modules/threeDView/objects/ScenarioEvents3D";
    import { inject } from "vue";

    const addScenarioEvent3D = inject<() => void>("mentatAddScenarioEvent3D");

    const props = withDefaults(
        defineProps<{
            open: boolean;
            topPx: number;
            maxHeight: string;
            title?: string;
        }>(),
        { title: "Scenario events" },
    );

    const emit = defineEmits<{
        (e: "update:open", v: boolean): void;
    }>();

    const { activeScenarioEventId, clearActiveScenarioEvent } = useScenarioEventSelection3D();

    function closeDock() {
        emit("update:open", false);
    }

    function backToList() {
        clearActiveScenarioEvent();
    }

    function onEventClick() {
        // no-op; selection is handled via store in the list component
    }
</script>

<template>
    <div v-if="open"
         class="eventdock"
         :style="{ top: topPx + 'px', maxHeight: maxHeight }">

        <div class="eventdock-header">
            <div class="left">
                <button v-if="activeScenarioEventId"
                        class="eventdock-back"
                        @click="backToList">
                    ←
                </button>
                <div class="title">{{ title }}</div>
            </div>

            <div class="right">
                <!-- Show Add on the list view -->
                <button v-if="!activeScenarioEventId"
                        class="eventdock-add"
                        @click="addScenarioEvent3D?.()">
                    + Add
                </button>

                <button class="eventdock-close" @click="closeDock">✕</button>
            </div>
        </div>

        <div class="eventdock-body">
            <ScenarioEventsList3D v-if="!activeScenarioEventId"
                                  @click="onEventClick" />
            <ScenarioEventDetails v-else
                                  :eventId="activeScenarioEventId" />
        </div>
    </div>
</template>

<style scoped>
    .eventdock {
        position: absolute;
        right: 10px;
        width: 520px;
        overflow: hidden;
        z-index: 80;
        background: rgba(0,0,0,0.65);
        border: 1px solid rgba(255,255,255,0.18);
        border-radius: 12px;
        backdrop-filter: blur(6px);
        display: flex;
        flex-direction: column;
    }

    .eventdock-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 8px 10px;
        border-bottom: 1px solid rgba(255,255,255,0.12);
        flex: 0 0 auto;
    }

    .left {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
    }

    .title {
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .eventdock-body {
        padding: 8px;
        overflow: auto;
        flex: 1 1 auto;
        min-height: 0;
    }

    .eventdock-close,
    .eventdock-back {
        background: rgba(255,255,255,0.12);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 8px;
        padding: 4px 8px;
        cursor: pointer;
        color: #fff;
        line-height: 1;
    }

    /* Legibility inside the dock */
    .eventdock :deep(*),
    .eventdock :deep([class*="text-"]) {
        color: #fff !important;
    }

    .eventdock :deep(input),
    .eventdock :deep(select),
    .eventdock :deep(textarea) {
        color: #fff !important;
    }

    .eventdock :deep(a) {
        color: #fff !important;
        text-decoration-color: rgba(255, 255, 255, 0.7);
    }

    /* Black text on light gray blocks (same strategy as unit dock) */
    .eventdock :deep([class*="bg-gray-50"]),
    .eventdock :deep([class*="bg-gray-100"]),
    .eventdock :deep([class*="bg-gray-200"]),
    .eventdock :deep([class*="bg-gray-300"]),
    .eventdock :deep([class*="bg-gray-400"]),
    .eventdock :deep([class*="bg-gray-50"] *),
    .eventdock :deep([class*="bg-gray-100"] *),
    .eventdock :deep([class*="bg-gray-200"] *),
    .eventdock :deep([class*="bg-gray-300"] *),
    .eventdock :deep([class*="bg-gray-400"] *) {
        color: #000 !important;
    }

    /* Dropdown/option styling for dark 3D dock */
    .eventdock :deep(select) {
        color: rgba(255,255,255,0.92) !important;
        background: rgba(0,0,0,0.35) !important;
        border-color: rgba(255,255,255,0.25) !important;
    }

    /* Note: styling <option> is OS-controlled on many platforms; keep it sane where supported */
    .eventdock :deep(select option) {
        color: #fff !important;
        background: #111 !important;
    }

    /* Ensure Radix/shadcn dialogs always appear above the 3D docks (dock is z-index: 80). */
    [data-radix-dialog-overlay] {
        z-index: 2000 !important;
    }

    [data-radix-dialog-content] {
        z-index: 2001 !important;
    }

    /* Some builds use these instead (safe to include). */
    [data-radix-popper-content-wrapper] {
        z-index: 2002 !important;
    }

    .right {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .eventdock-add {
        background: rgba(255,255,255,0.12);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 8px;
        padding: 4px 10px;
        cursor: pointer;
        color: #fff;
        line-height: 1;
        font-weight: 600;
    }

    .right {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    /* Ensure dropdown (dot menu) renders above the dock/panels */
    :global([data-radix-popper-content-wrapper]),
    :global([data-reka-popper-content-wrapper]) {
        z-index: 10000 !important;
        position: relative;
    }
</style>
