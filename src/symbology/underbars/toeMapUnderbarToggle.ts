import { ref, watch } from "vue";

const KEY = "toeMapUnderbarEnabled";

function readInitial(): boolean {
    try {
        const v = localStorage.getItem(KEY);
        if (v == null) return true; // default ON
        return v === "1" || v.toLowerCase() === "true";
    } catch {
        return true;
    }
}

export const toeMapUnderbarEnabled = ref<boolean>(readInitial());

export function setToeMapUnderbarEnabled(v: boolean) {
    toeMapUnderbarEnabled.value = !!v;
}

watch(
    toeMapUnderbarEnabled,
    (v) => {
        try {
            localStorage.setItem(KEY, v ? "1" : "0");
        } catch {
            // ignore
        }
    },
    { flush: "post" },
);
