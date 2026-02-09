import { ref, computed, type Ref } from "vue";
import { useElementSize } from "@vueuse/core";
import { useSelectedItems } from "@/stores/selectedStore";

/**
 * 3D Unit Details docking logic extracted from GlobeView.vue.
 *
 * Keeps GlobeView's template simple while preserving identical runtime behavior.
 */
export function useUnitDetailsDock3D(opts: {
    rightOpen: Ref<boolean>;
    /** top padding for the right-side dock, in pixels */
    rightPanelTopPx?: number;
    /** extra spacing between right controls and the dock, in pixels */
    rightPanelGapPx?: number;
}) {
    const RIGHT_PANEL_TOP_PX = opts.rightPanelTopPx ?? 12;
    const RIGHT_PANEL_GAP_PX = opts.rightPanelGapPx ?? 30;

    // DOM handle used to measure the right controls block and push the dock below it.
    const rightControlsEl = ref<HTMLElement | null>(null);
    const { height: rightControlsH } = useElementSize(rightControlsEl);

    // SelectedStore compatibility: some versions expose refs, others expose plain values.
    const selectedItems = useSelectedItems();
    const activeUnitId = computed<string | null>(() => {
        const v = (selectedItems as any).activeUnitId;
        return v && typeof v === "object" && "value" in v ? v.value : v ?? null;
    });

    const selectedUnitIds = computed<Set<string>>(() => {
        const v = (selectedItems as any).selectedUnitIds;
        if (v && typeof v === "object" && "value" in v) return v.value as Set<string>;
        return (v as Set<string>) ?? new Set<string>();
    });

    const primarySelectedUnitId = computed<string | null>(() => {
        if (activeUnitId.value) return activeUnitId.value;
        const set = selectedUnitIds.value;
        return set && set.size ? Array.from(set)[0] : null;
    });

    // Dock visibility toggle (local UI state)
    const unitDockOpen = ref(true);

    const unitDockTopPx = computed(() => {
        const h = opts.rightOpen.value ? (rightControlsH.value || 0) : 0;
        return RIGHT_PANEL_TOP_PX + h + (opts.rightOpen.value ? RIGHT_PANEL_GAP_PX : 0);
    });

    // Keep the dock from running under the timeline (timeline height is injected via CSS var on GlobeView root)
    const unitDockMaxHeight = computed(() => {
        return `calc(100vh - ${unitDockTopPx.value}px - var(--timeline-height, 0px) - 12px)`;
    });

    return {
        rightControlsEl,
        unitDockOpen,
        primarySelectedUnitId,
        unitDockTopPx,
        unitDockMaxHeight,
    };
}
