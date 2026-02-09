<!-- src/modules/threeDView/objects/UnitDetails3D/UnitDetailsDock3D.vue -->
<script setup lang="ts">
    import UnitDetails from "@/modules/scenarioeditor/UnitDetails.vue";

    const props = withDefaults(
        defineProps<{
            unitId: string | null;
            open: boolean;
            topPx: number;
            maxHeight: string;
            title?: string;

            // passthroughs to UnitDetails (so GlobeView can still override if desired)
            actionsButtonClass?: string;
            actionsMenuClass?: string;
            actionsItemClass?: string;
            actionsCaretButtonClass?: string;
        }>(),
        {
            title: "Unit details",
            actionsButtonClass: "bg-gray-200 text-gray-700 hover:bg-gray-300",
            actionsMenuClass: "text-gray-700",
            actionsItemClass: "text-gray-700",
            actionsCaretButtonClass: "",
        },
    );

    const emit = defineEmits<{
        (e: "update:open", v: boolean): void;
    }>();

    function close() {
        emit("update:open", false);
    }
</script>

<template>
    <div v-if="unitId && open"
         class="unitdock"
         :style="{ top: topPx + 'px', maxHeight: maxHeight }">
        <div class="unitdock-header">
            <div style="font-weight:600;">{{ title }}</div>
            <button class="unitdock-close" @click="close">✕</button>
        </div>

        <div class="unitdock-body">
            <UnitDetails :unitId="unitId"
                         :actionsButtonClass="actionsButtonClass"
                         :actionsMenuClass="actionsMenuClass"
                         :actionsItemClass="actionsItemClass"
                         :actionsCaretButtonClass="actionsCaretButtonClass" />
        </div>
    </div>
</template>

<style scoped>
    .unitdock {
        position: absolute;
        right: 10px;
        width: 420px;
        overflow: hidden;
        z-index: 80;
        background: rgba(0,0,0,0.65);
        border: 1px solid rgba(255,255,255,0.18);
        border-radius: 12px;
        backdrop-filter: blur(6px);
    }

    .unitdock-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 10px;
        border-bottom: 1px solid rgba(255,255,255,0.12);
    }

    .unitdock-body {
        padding: 8px;
        overflow: auto;
    }

    .unitdock-close {
        background: rgba(255,255,255,0.12);
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 8px;
        padding: 4px 8px;
        cursor: pointer;
        color: #fff;
    }

    /* UnitDetails legibility inside the dock */
    .unitdock :deep(*),
    .unitdock :deep([class*="text-"]) {
        color: #fff !important;
    }

    .unitdock :deep(input),
    .unitdock :deep(select),
    .unitdock :deep(textarea) {
        color: #fff !important;
    }

    .unitdock :deep(a) {
        color: #fff !important;
        text-decoration-color: rgba(255, 255, 255, 0.7);
    }

    /* Hover: BUT if the button is on a light background token, force dark text */
    .unitdock :deep(button[class*="bg-gray-50"]:hover),
    .unitdock :deep(button[class*="bg-gray-100"]:hover),
    .unitdock :deep(button[class*="bg-gray-200"]:hover),
    .unitdock :deep(button[class*="bg-gray-300"]:hover),
    .unitdock :deep(button[class*="bg-gray-400"]:hover) {
        color: #000 !important;
    }

    /* Black text on light grey backgrounds (matches your existing overrides) */
    .unitdock :deep([class*="bg-gray-50"]),
    .unitdock :deep([class*="bg-gray-100"]),
    .unitdock :deep([class*="bg-gray-200"]),
    .unitdock :deep([class*="bg-gray-300"]),
    .unitdock :deep([class*="bg-gray-400"]),
    .unitdock :deep([class*="bg-gray-50"] *),
    .unitdock :deep([class*="bg-gray-100"] *),
    .unitdock :deep([class*="bg-gray-200"] *),
    .unitdock :deep([class*="bg-gray-300"] *),
    .unitdock :deep([class*="bg-gray-400"] *) {
        color: #000 !important;
    }

    /* ALSO treat other light backgrounds as "light": make their text (and icons) dark.
   Use token selectors so we don't match bg-white/10 etc. */
    .unitdock :deep([class~="bg-white"]),
    .unitdock :deep([class~="bg-slate-50"]),
    .unitdock :deep([class~="bg-slate-100"]),
    .unitdock :deep([class~="bg-slate-200"]),
    .unitdock :deep([class~="bg-slate-300"]),
    .unitdock :deep([class~="bg-neutral-50"]),
    .unitdock :deep([class~="bg-neutral-100"]),
    .unitdock :deep([class~="bg-neutral-200"]),
    .unitdock :deep([class~="bg-neutral-300"]),
    .unitdock :deep([class~="bg-zinc-50"]),
    .unitdock :deep([class~="bg-zinc-100"]),
    .unitdock :deep([class~="bg-zinc-200"]),
    .unitdock :deep([class~="bg-zinc-300"]) {
        color: #000 !important;
    }

    /* Ensure nested text + SVG icons (caret) also go dark on those light backgrounds */
    .unitdock :deep([class~="bg-white"] *),
    .unitdock :deep([class~="bg-slate-50"] *),
    .unitdock :deep([class~="bg-slate-100"] *),
    .unitdock :deep([class~="bg-slate-200"] *),
    .unitdock :deep([class~="bg-slate-300"] *),
    .unitdock :deep([class~="bg-neutral-50"] *),
    .unitdock :deep([class~="bg-neutral-100"] *),
    .unitdock :deep([class~="bg-neutral-200"] *),
    .unitdock :deep([class~="bg-neutral-300"] *),
    .unitdock :deep([class~="bg-zinc-50"] *),
    .unitdock :deep([class~="bg-zinc-100"] *),
    .unitdock :deep([class~="bg-zinc-200"] *),
    .unitdock :deep([class~="bg-zinc-300"] *) {
        color: #000 !important;
    }

    .unitdock :deep([class~="bg-white"] svg),
    .unitdock :deep([class~="bg-slate-50"] svg),
    .unitdock :deep([class~="bg-slate-100"] svg),
    .unitdock :deep([class~="bg-slate-200"] svg),
    .unitdock :deep([class~="bg-slate-300"] svg),
    .unitdock :deep([class~="bg-neutral-50"] svg),
    .unitdock :deep([class~="bg-neutral-100"] svg),
    .unitdock :deep([class~="bg-neutral-200"] svg),
    .unitdock :deep([class~="bg-neutral-300"] svg),
    .unitdock :deep([class~="bg-zinc-50"] svg),
    .unitdock :deep([class~="bg-zinc-100"] svg),
    .unitdock :deep([class~="bg-zinc-200"] svg),
    .unitdock :deep([class~="bg-zinc-300"] svg) {
        color: #000 !important;
        fill: currentColor !important;
        stroke: currentColor !important;
    }


    /* 3D dock: ensure SplitButton "last used" label + caret are always readable */
    .unitdock :deep(.unit-actions-btn) {
        background: rgba(255, 255, 255, 0.12) !important;
        border-color: rgba(255, 255, 255, 0.25) !important;
        color: #fff !important;
    }

    .unitdock :deep(.unit-actions-btn svg) {
        color: #fff !important;
        fill: currentColor !important;
        stroke: currentColor !important;
    }

    /* Override the dock's generic button hover -> black text (which can vanish) */
    .unitdock :deep(.unit-actions-btn:hover),
    .unitdock :deep(.unit-actions-btn:hover svg) {
        color: #fff !important;
        fill: currentColor !important;
        stroke: currentColor !important;
    }

    /* Default button readability inside 3D dock content */
    .unitdock :deep(button) {
        color: #fff !important;
    }

    /* Outline / ghost style buttons (commonly Cancel) need a visible border */
    .unitdock :deep(button[class*="border"]),
    .unitdock :deep(button[class*="bg-transparent"]),
    .unitdock :deep(button[class*="bg-none"]) {
        border-color: rgba(255, 255, 255, 0.25) !important;
        background: rgba(255, 255, 255, 0.06) !important;
    }

    /* Hover: slight brighten */
    .unitdock :deep(button:hover) {
        background: rgba(255, 255, 255, 0.10) !important;
    }

    /* Pressed feedback: invert while mouse is down */
    .unitdock :deep(button:active) {
        background: rgba(255, 255, 255, 0.92) !important;
        border-color: rgba(255, 255, 255, 0.92) !important;
        color: #000 !important;
    }

    .unitdock :deep(button:active *),
    .unitdock :deep(button:active svg) {
        color: #000 !important;
        fill: currentColor !important;
        stroke: currentColor !important;
    }

    /* DotsMenu: keep it clean (no bubble) */
    .unitdock :deep(.unitdock-dots button) {
        background: transparent !important;
        border-color: transparent !important;
    }

    .unitdock :deep(.unitdock-dots button:hover) {
        background: rgba(255, 255, 255, 0.06) !important; /* subtle hover only */
        border-color: transparent !important;
    }

    /* ---- Body button legibility (fix Leaders + TO&E internal controls) ---- */

    /* Default: keep button text/icons readable on dark dock */
    .unitdock-body :deep(button:hover) {
        color: #fff !important;
    }

    /* If a button has an explicit light background, use dark text instead */
    .unitdock-body :deep(button[class*="bg-gray-50"]:hover),
    .unitdock-body :deep(button[class*="bg-gray-100"]:hover),
    .unitdock-body :deep(button[class*="bg-gray-200"]:hover),
    .unitdock-body :deep(button[class*="bg-gray-300"]:hover),
    .unitdock-body :deep(button[class*="bg-gray-400"]:hover),
    .unitdock-body :deep(button[class~="bg-white"]:hover),
    .unitdock-body :deep(button[class~="bg-slate-50"]:hover),
    .unitdock-body :deep(button[class~="bg-slate-100"]:hover),
    .unitdock-body :deep(button[class~="bg-neutral-50"]:hover),
    .unitdock-body :deep(button[class~="bg-neutral-100"]:hover),
    .unitdock-body :deep(button[class~="bg-zinc-50"]:hover),
    .unitdock-body :deep(button[class~="bg-zinc-100"]:hover) {
        color: #000 !important;
    }

    /* Make sure nested labels + SVG icons follow the button color */
    .unitdock-body :deep(button:hover *),
    .unitdock-body :deep(button:hover svg) {
        color: inherit !important;
        fill: currentColor !important;
        stroke: currentColor !important;
    }

    /* Optional: click feedback (invert while mouse is down) for internal buttons */
    .unitdock-body :deep(button:active) {
        background: rgba(255, 255, 255, 0.92) !important;
        border-color: rgba(255, 255, 255, 0.92) !important;
        color: #000 !important;
    }

    .unitdock-body :deep(button:active *),
    .unitdock-body :deep(button:active svg) {
        color: #000 !important;
        fill: currentColor !important;
        stroke: currentColor !important;
    }

    /* Persisted toggles (common in editors / pills): keep inverted when active/on */
    .unitdock-body :deep(button[aria-pressed="true"]),
    .unitdock-body :deep(button[data-state="on"]),
    .unitdock-body :deep(button[data-state="active"]) {
        background: rgba(255, 255, 255, 0.92) !important;
        border-color: rgba(255, 255, 255, 0.92) !important;
        color: #000 !important;
    }

    .unitdock-body :deep(button[aria-pressed="true"] *),
    .unitdock-body :deep(button[data-state="on"] *),
    .unitdock-body :deep(button[data-state="active"] *),
    .unitdock-body :deep(button[aria-pressed="true"] svg),
    .unitdock-body :deep(button[data-state="on"] svg),
    .unitdock-body :deep(button[data-state="active"] svg) {
        color: #000 !important;
        fill: currentColor !important;
        stroke: currentColor !important;
    }

    /* 3D dock: badges (Equipment / Personnel / Supplies) should not be white pills */
    .unitdock :deep(.badge) {
        background: transparent !important;
        border: 1px solid rgba(255, 255, 255, 0.18) !important;
        color: #fff !important;
    }

    /* Ensure any nested icons/text inherit correctly */
    .unitdock :deep(.badge *),
    .unitdock :deep(.badge svg) {
        color: #fff !important;
        fill: currentColor !important;
        stroke: currentColor !important;
    }

    /* 3D dock: remove gray fills in the UnitPanelState "flags" row (sidc/status + badges) */
    .unitdock :deep(.unitstate-flags > span) {
        background: transparent !important;
        color: #fff !important;
    }

    /* Re-add a subtle border so the pills still read as pills in 3D */
    .unitdock :deep(.unitstate-flags > span) {
        border: 1px solid rgba(255, 255, 255, 0.18) !important;
    }

    /* Keep inner text/icons consistent */
    .unitdock :deep(.unitstate-flags > span *),
    .unitdock :deep(.unitstate-flags > span svg) {
        color: #fff !important;
        fill: currentColor !important;
        stroke: currentColor !important;
    }

    /* ---- 3D dock: TabsList (Equipment / Personnel / Supplies) should not be a grey bar ---- */
    .unitdock :deep([data-slot="tabs-list"].bg-muted) {
        background-color: transparent !important; /* removes the grey bar */
    }

    /* Keep the tablist border subtle in 3D */
    .unitdock :deep([data-slot="tabs-list"]) {
        border-color: rgba(255, 255, 255, 0.18) !important;
    }

    /* Triggers: default readable */
    .unitdock :deep([data-slot="tabs-trigger"]) {
        color: rgba(255, 255, 255, 0.85) !important;
    }

    /* Active trigger: invert (light bg, dark fg) */
    .unitdock :deep([data-slot="tabs-trigger"][data-state="active"]) {
        background-color: rgba(255, 255, 255, 0.92) !important; /* replaces bg-background token */
        color: #000 !important;
        border-color: rgba(255, 255, 255, 0.92) !important;
    }

    /* Ensure inner text/icons follow */
    .unitdock :deep([data-slot="tabs-trigger"] *),
    .unitdock :deep([data-slot="tabs-trigger"] svg) {
        color: inherit !important;
        fill: currentColor !important;
        stroke: currentColor !important;
    }

    /* Hover: subtle highlight (optional) */
    .unitdock :deep([data-slot="tabs-trigger"]:hover) {
        background-color: rgba(255, 255, 255, 0.08) !important;
    }

    /* ===== 3D dock: "pill" tab rows inside panel body (e.g., Unit State / Leaders) ===== */
    .unitdock :deep(.unitdock-body [data-slot="tabs-list"]) {
        /* kill the light grey bar */
        background-color: rgba(255, 255, 255, 0.06) !important; /* or transparent if you prefer */
        border-color: rgba(255, 255, 255, 0.18) !important;
        border-width: 1px !important;
        border-style: solid !important;
        /* make it look like your other dock controls */
        border-radius: 10px !important;
        padding: 3px !important;
        /* remove the “flat bar” feel */
        height: auto !important;
    }

    /* Default trigger (inactive): dock-consistent */
    .unitdock :deep(.unitdock-body [data-slot="tabs-trigger"]) {
        background-color: transparent !important;
        border-color: transparent !important;
        color: rgba(255, 255, 255, 0.85) !important;
    }

    /* Hover */
    .unitdock :deep(.unitdock-body [data-slot="tabs-trigger"]:hover) {
        background-color: rgba(255, 255, 255, 0.08) !important;
    }

    /* Active trigger: inverted, like your other "pressed" buttons */
    .unitdock :deep(.unitdock-body [data-slot="tabs-trigger"][data-state="active"]) {
        background-color: rgba(255, 255, 255, 0.92) !important;
        color: #000 !important;
        border-color: rgba(255, 255, 255, 0.92) !important;
    }

    /* Ensure labels/icons follow currentColor */
    .unitdock :deep(.unitdock-body [data-slot="tabs-trigger"] *),
    .unitdock :deep(.unitdock-body [data-slot="tabs-trigger"] svg) {
        color: inherit !important;
        fill: currentColor !important;
        stroke: currentColor !important;
    }

    /* 3D dock: restyle "Set status" + "Change symbol" pills to match dock buttons */
    .unitdock :deep(.unitstate-pill) {
        background-color: rgba(255, 255, 255, 0.10) !important;
        border: 1px solid rgba(255, 255, 255, 0.18) !important;
        color: #fff !important;
    }

    .unitdock :deep(.unitstate-pill:hover) {
        background-color: rgba(255, 255, 255, 0.16) !important;
        color: #fff !important;
    }

    /* Ensure label + caret/icons follow currentColor */
    .unitdock :deep(.unitstate-pill *),
    .unitdock :deep(.unitstate-pill svg) {
        color: inherit !important;
        fill: currentColor !important;
        stroke: currentColor !important;
    }

    /* 3D dock: Leaders tab internal action buttons (e.g., Save / Add leader)
   Match the dock "bubble" look, but do NOT touch icon-only buttons (they usually have title/aria-label). */
    .unitdock :deep(.leaders-panel button:not([title]):not([aria-label])) {
        background-color: rgba(255, 255, 255, 0.10) !important;
        border: 1px solid rgba(255, 255, 255, 0.18) !important;
        color: #fff !important;
    }

    .unitdock :deep(.leaders-panel button:not([title]):not([aria-label]):hover) {
        background-color: rgba(255, 255, 255, 0.16) !important;
        border-color: rgba(255, 255, 255, 0.22) !important;
        color: #fff !important;
    }

    /* Ensure any nested text/icons inherit properly */
    .unitdock :deep(.leaders-panel button:not([title]):not([aria-label]) *),
    .unitdock :deep(.leaders-panel button:not([title]):not([aria-label]) svg) {
        color: inherit !important;
        fill: currentColor !important;
        stroke: currentColor !important;
    }
</style>
