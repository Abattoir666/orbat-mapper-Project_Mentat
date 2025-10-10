import { ref } from "vue";

const selectedIds = ref<Set<string>>(new Set());
const lastClickedId = ref<string | null>(null);

export function useSelection() {
    function isSelected(id: string) { return selectedIds.value.has(id); }
    function clear() { selectedIds.value.clear(); lastClickedId.value = null; }

    function toggle(id: string, additive = true) {
        if (!additive) selectedIds.value.clear();
        if (selectedIds.value.has(id)) selectedIds.value.delete(id);
        else selectedIds.value.add(id);
        lastClickedId.value = id;
    }

    // Optionally implement range select if you have a flat, ordered list
    function add(id: string) { selectedIds.value.add(id); lastClickedId.value = id; }

    return { selectedIds, isSelected, toggle, add, clear, lastClickedId };
}