<script setup lang="ts">
    import { type OrbatMapperExportSettings } from "@/types/convert";
    import { computed } from "vue";
    import { injectStrict } from "@/utils";
    import { activeScenarioKey } from "@/components/injects";
    import InputCheckbox from "@/components/InputCheckbox.vue";
    import InputGroupTemplate from "@/components/InputGroupTemplate.vue";
    import InputGroup from "@/components/InputGroup.vue";

    const form = defineModel<OrbatMapperExportSettings>({ required: true });

    const {
        store: { state },
    } = injectStrict(activeScenarioKey);

    /** Default scenario name from store */
    form.value.scenarioName = state.info.name;

    /**
     * Build a side → [groupId] structure suitable for rendering.
     * We normalize groups to ID strings, and we only include sides with ≥ 1 group.
     */
    const sidesWithGroupIds = computed(() => {
        const out: Array<{ id: string; name: string; groups: string[] }> = [];
        for (const sideId of Object.keys(state.sideMap)) {
            const side = state.sideMap[sideId];
            const rawGroups = (side?.groups ?? []) as any[];
            const groupIds = rawGroups
                .map(g => (typeof g === "string" ? g : g?.id))
                .filter((gid: any): gid is string => typeof gid === "string");

            if (groupIds.length > 0) {
                out.push({ id: side.id, name: side.name, groups: groupIds });
            }
        }
        return out;
    });

    /** All group IDs that exist in the scenario (restricted to those present in sideGroupMap) */
    const allGroupIds = computed(() => {
        const ids = new Set<string>();
        for (const s of sidesWithGroupIds.value) {
            for (const gid of s.groups) {
                if (state.sideGroupMap?.[gid]) ids.add(gid);
            }
        }
        return Array.from(ids);
    });

    /**
     * Toggle all:
     * - If not all groups are currently selected, select them all.
     * - If all groups are currently selected, clear the selection.
     */
    function toggleAll() {
        const current = new Set(form.value.sideGroups ?? []);
        const all = allGroupIds.value;
        if (current.size < all.length) {
            form.value.sideGroups = all;
        } else {
            form.value.sideGroups = [];
        }
    }

    /** Whether every available group is currently selected (for button label state, if desired) */
    const isAllSelected = computed(() => {
        const current = form.value.sideGroups ?? [];
        return current.length > 0 && current.length === allGroupIds.value.length;
    });
</script>

<template>
    <fieldset class="space-y-4">
        <!-- Action row ABOVE the selection section -->
        <div class="flex items-center justify-between">
            <p class="text-sm opacity-80">
                Select which side groups you want to export
            </p>
            <button type="button"
                    class="px-3 py-1.5 rounded-lg border text-sm font-medium hover:bg-black/5"
                    @click="toggleAll">
                {{ isAllSelected ? 'Clear all' : 'Toggle all' }}
            </button>
        </div>

        <InputGroupTemplate label="Sides and groups">
            <div class="space-y-3">
                <div v-for="s in sidesWithGroupIds"
                     :key="s.id"
                     class="rounded-lg border p-3">
                    <div class="font-medium mb-2">{{ s.name }}</div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        <InputCheckbox v-for="g in s.groups"
                                       :key="g"
                                       :label="state.sideGroupMap[g]?.name ?? g"
                                       :value="g"
                                       v-model="form.sideGroups" />
                    </div>
                </div>
            </div>
        </InputGroupTemplate>

        <InputGroup label="Scenario name" v-model="form.scenarioName" />
        <InputGroup label="Name of downloaded file" v-model="form.fileName" />
    </fieldset>
</template>
