// src/symbology/underbars/underbarSettings.ts

import { computed, ref, watch } from "vue";
import { toeMapUnderbarEnabled, setToeMapUnderbarEnabled } from "@/symbology/underbars/toeMapUnderbarToggle"; 
/**
 * Master underbar toggle (global).
 * Goal: one settings control can disable *all* underbars everywhere,
 * while preserving per-underbar toggles for when the master is re-enabled.
 */
const MASTER_KEY = "underbarsEnabled";

function readMasterInitial(): boolean {
    try {
        const v = localStorage.getItem(MASTER_KEY);
        if (v == null) return true; // default ON
        return v === "1" || v.toLowerCase() === "true";
    } catch {
        return true;
    }
}

export const underbarsEnabled = ref<boolean>(readMasterInitial());

export function setUnderbarsEnabled(v: boolean) {
    underbarsEnabled.value = !!v;
}

/**
 * Effective toggles (what renderers should actually check).
 * Today you only have the TO&E/S underbar toggle; this file is where you’ll add
 * additional underbar toggles later (status/capability/etc.) and gate them all
 * behind underbarsEnabled.
 */
export const effectiveToeUnderbarEnabled = computed<boolean>(() => {
    return underbarsEnabled.value && toeMapUnderbarEnabled.value;
});

/**
 * Optional convenience: if you want a single UI switch that specifically controls
 * "TO&E/S underbars" but still respects the master toggle, use these.
 */
export function setToeUnderbarEnabled(v: boolean) {
    setToeMapUnderbarEnabled(!!v);
}

watch(
    underbarsEnabled,
    (v) => {
        try {
            localStorage.setItem(MASTER_KEY, v ? "1" : "0");
        } catch {
            // ignore
        }
    },
    { flush: "post" },
);
