// src/stores/parentLink.ts (new)
import { reactive } from "vue";

export const parentLinkOverlay = reactive<{
	id: string | null;           // child id
	parentId: string | null;     // parent id
	coords: [number, number][];  // [lng, lat] pairs (child -> parent)
}>({
	id: null,
	parentId: null,
	coords: [],
});