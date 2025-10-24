<template>
    <div class="space-y-3">
        <!-- Swatch selector -->
        <SymbolCodeSelect label="Fill color"
                          :items="colorIconItems"
                          v-model="colorValue" />

        <!-- Manual hex input -->
        <div class="flex items-center gap-2">
            <label class="text-sm w-16">Hex</label>
            <input class="border rounded px-2 py-1 w-40"
                   v-model="manualHex"
                   @blur="onHexBlur"
                   placeholder="#RRGGBB"
                   spellcheck="false" />
            <button class="border rounded px-3 py-1" type="button" @click="applyHex">
                Apply
            </button>
            <span v-if="hexError" class="text-red-600 text-sm">{{ hexError }}</span>
        </div>
    </div>
</template>

<script setup lang="ts">
    import { computed, ref, watch } from "vue";
    import SymbolCodeSelect from "@/components/SymbolCodeSelect.vue";
    import type { NullableSymbolItem } from "@/types/constants";

    interface Props {
        modelValue?: string | null;
        sid?: string;
        defaultFillColor?: string;
    }

    withDefaults(defineProps<Props>(), { sid: "3", modelValue: "" });
    defineEmits(["update:modelValue"]);
    const colorValue = defineModel<string | null>({ default: null });

    const colors: Omit<NullableSymbolItem, "sidc">[] = [
        { code: null, text: "Default" },
        { code: "#80e0ff", text: "Blue (standard)" },
        { code: "#ff8080", text: "Red (standard)" },
        { code: "#aaffaa", text: "Green (standard)" },
        { code: "#ffff80", text: "Yellow (standard)" },
        { code: "#ffa1ff", text: "Pink (civilian)" },
        { code: "#aab074", text: "Olive" },
        { code: "#5baa5b", text: "Infantry (Battle Order)" },
        { code: "#ffd00b", text: "Armor (Battle Order)" },
        { code: "#ff3333", text: "Artillery (Battle Order)" },
        { code: "#f7f7f7", text: "Combat Support (Battle Order)" },
        { code: "#d87600", text: "Service Support (Battle Order)" },
        { code: "#a2e3e8", text: "Aviation (Battle Order)" },

        /* your added swatches */
        { code: "#003f5c", text: "Navy Deep" },
        { code: "#2f4b7c", text: "Indigo Slate" },
        { code: "#665191", text: "Purple Steel" },
        { code: "#a05195", text: "Magenta Grape" },
        { code: "#d45087", text: "Rose Punch" },
        { code: "#f95d6a", text: "Coral Red" },
        { code: "#ff7c43", text: "Orange Pop" },
        { code: "#ffa600", text: "Amber Glow" },
    ];

    const colorIconItems = computed((): NullableSymbolItem[] =>
        colors.map((item) => ({
            ...item,
            sidc: "100" + "3" + 10 + "00" + "00" + "0000000000", // icon sample (sid prop is not needed here)
            symbolOptions: item.code ? { fillColor: item.code } : undefined,
        }))
    );

    /* Manual hex input */
    const manualHex = ref<string>("");
    const hexError = ref<string>("");

    watch(
        () => colorValue.value,
        (val) => {
            if (typeof val === "string" && val) manualHex.value = val;
        },
        { immediate: true }
    );

    function normalizeHex(s: string): string {
        const x = s.trim().toLowerCase();
        if (!x) return "";
        if (x.startsWith("#")) return x;
        return "#" + x;
    }

    function isValidHex(s: string): boolean {
        return /^#([0-9a-f]{6}|[0-9a-f]{3})$/.test(s.toLowerCase());
    }

    function onHexBlur() {
        const n = normalizeHex(manualHex.value);
        manualHex.value = n;
        hexError.value = n && !isValidHex(n) ? "Invalid hex" : "";
    }

    function applyHex() {
        const n = normalizeHex(manualHex.value);
        if (!isValidHex(n)) {
            hexError.value = "Invalid hex";
            return;
        }
        hexError.value = "";
        colorValue.value = n; // updates v-model upstream
    }
</script>