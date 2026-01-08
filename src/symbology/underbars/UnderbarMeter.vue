<script setup lang="ts">
    import { computed } from "vue";
    import { getStatusBarPalette, toePctToCssColor } from "@/symbology/underbars/toeUnderbarColor";

    const props = withDefaults(
        defineProps<{
            pct: number | null | undefined;

            /** Hide when pct >= threshold (default 100 for “plain present = no bar”). */
            hideWhenAtOrAbove?: number;

            /**
             * Geometry: the picker underbar typically matches the symbol container width.
             * - widthMode="parent": width:100% (recommended for matching Symbol Picker)
             * - widthMode="px": fixed widthPx
             */
            widthMode?: "parent" | "px";
            widthPx?: number;

            /** Height/radius should match the picker’s underbar; adjust once here if needed. */
            heightPx?: number;
            radiusPx?: number;

            /** Outline like the original status bar. */
            outlinePx?: number;
            outlineCss?: string;

            /** Optional spacing/positioning classes only (no w-/h-/rounded-). */
            class?: string;
        }>(),
        {
            hideWhenAtOrAbove: 100,
            widthMode: "parent",
            widthPx: 34,       // used only when widthMode="px"
            heightPx: 5,
            radiusPx: 2.5,
            outlinePx: 1,
            outlineCss: "rgb(0 0 0)",
            class: "",
        },
    );

    const palette = getStatusBarPalette();

    const show = computed(() => {
        const p = props.pct;
        if (p == null || !Number.isFinite(p)) return false;
        return p < (props.hideWhenAtOrAbove ?? 100);
    });

    const styleObj = computed(() => {
        const p = Number.isFinite(props.pct as number) ? (props.pct as number) : 0;
        const bg = toePctToCssColor(p, palette);

        return {
            display: "block",
            width: props.widthMode === "px" ? `${props.widthPx}px` : "100%",
            height: `${props.heightPx}px`,
            borderRadius: `${props.radiusPx}px`,
            backgroundColor: bg,
            border: `${props.outlinePx}px solid ${props.outlineCss}`,
            boxSizing: "border-box",
        } as Record<string, string>;
    });
</script>

<template>
    <span v-if="show" :class="props.class" :style="styleObj" />
</template>
