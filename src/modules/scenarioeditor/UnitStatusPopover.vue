<script setup lang="ts">
    import SimpleSelect from "@/components/SimpleSelect.vue";
    import { injectStrict, sortBy } from "@/utils";
    import { activeScenarioKey } from "@/components/injects";
    import { computed, ref } from "vue";
    import { type SelectItem } from "@/components/types";
    import BaseButton from "@/components/BaseButton.vue";
    import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
    import { Button } from "@/components/ui/button";

    const props = withDefaults(
        defineProps<{
            disabled?: boolean;

            /** Optional styling for the trigger button (e.g., match GlobeView grey theme). */
            buttonClass?: string;

            /** Optional styling for the popover content (z-index, bg, text). */
            contentClass?: string;

            /** Optional styling for the submit button inside the popover. */
            submitClass?: string;
        }>(),
        {
            disabled: false,
            buttonClass: "",
            contentClass: "",
            submitClass: "",
        }
    );

    const emit = defineEmits<{ (e: "update", value: string | null | undefined): void }>();

    const {
        store: {
            state: { unitStatusMap },
        },
    } = injectStrict(activeScenarioKey);

    const isOpen = ref(false);
    const statusValue = ref<string | null>(null);

    const unitStatusValues = computed<SelectItem[]>(() => {
        return sortBy(Object.values(unitStatusMap), "name").map((v) => ({
            value: v.id,
            label: v.name,
        }));
    });

    function onFormSubmit() {
        emit("update", statusValue.value);
        isOpen.value = false;
    }
</script>

<template>
    <Popover v-model:open="isOpen">
        <PopoverTrigger as-child>
            <Button variant="outline"
                    :disabled="props.disabled"
                    :class="props.buttonClass">
                Set status
            </Button>
        </PopoverTrigger>

        <PopoverContent :class="props.contentClass">
            <h3 class="font-medium">Set unit status</h3>

            <form @submit.prevent="onFormSubmit()" class="mt-2 space-y-2">
                <SimpleSelect add-none :items="unitStatusValues" v-model="statusValue" />

                <footer class="flex justify-end">
                    <BaseButton small
                                primary
                                type="submit"
                                :disabled="props.disabled"
                                :class="props.submitClass">
                        Set
                    </BaseButton>
                </footer>
            </form>
        </PopoverContent>
    </Popover>
</template>
