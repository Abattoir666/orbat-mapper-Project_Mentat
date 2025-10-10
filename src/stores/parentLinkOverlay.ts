import { computed, reactive, watch } from "vue";
import { useStorage } from "@vueuse/core";

// Persisted raw state (serializable)
type PersistedParentLinkState = {
    enabled: boolean;
    trackedUnitIds: string[]; // serialize Set as array
    arrowAt: "parent" | "child";
    color: string;
    width: number;
    dash: number[];
    opacity: number;
};

const persisted = useStorage<PersistedParentLinkState>(
    "orbat.parentLinkOverlay",
    {
        enabled: false,
        trackedUnitIds: [],
        arrowAt: "child",
        color: "#FFEA00",
        width: 3,
        dash: [9, 5],
        opacity: 0.7,
    }
);

export const parentLinkOverlay = reactive({
    // reactive mirror
    enabled: computed({
        get: () => persisted.value.enabled,
        set: (v: boolean) => (persisted.value.enabled = v),
    }),
    tracked: new Set<string>(persisted.value.trackedUnitIds),
    arrowAt: computed({
        get: () => persisted.value.arrowAt,
        set: (v: "parent" | "child") => (persisted.value.arrowAt = v),
    }),
    color: computed({
        get: () => persisted.value.color,
        set: (v: string) => (persisted.value.color = v),
    }),
    width: computed({
        get: () => persisted.value.width,
        set: (v: number) => (persisted.value.width = v),
    }),
    dash: computed({
        get: () => persisted.value.dash,
        set: (v: number[]) => (persisted.value.dash = v),
    }),
    opacity: computed({
        get: () => persisted.value.opacity,
        set: (v: number) => (persisted.value.opacity = v),
    }),

    // computed snapshot for canvas (re-built elsewhere)
    segments: [] as [[number, number], [number, number]][],

    // API
    enable() { persisted.value.enabled = true; },
    disable() { persisted.value.enabled = false; },
    toggleEnabled() { persisted.value.enabled = !persisted.value.enabled; },

    clearTracked() { parentLinkOverlay.tracked.clear(); },
    trackUnits(ids: Iterable<string>) {
        for (const id of ids) parentLinkOverlay.tracked.add(String(id));
    },
    untrackUnits(ids: Iterable<string>) {
        for (const id of ids) parentLinkOverlay.tracked.delete(String(id));
    },
    toggleUnits(ids: Iterable<string>) {
        for (const id0 of ids) {
            const id = String(id0);
            if (parentLinkOverlay.tracked.has(id)) parentLinkOverlay.tracked.delete(id);
            else parentLinkOverlay.tracked.add(id);
        }
    },
});

// keep persisted mirror up-to-date
watch(
    () => Array.from(parentLinkOverlay.tracked),
    (arr) => { persisted.value.trackedUnitIds = arr; },
    { deep: false }
);