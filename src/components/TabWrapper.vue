<script setup lang="ts">
    import { Tab, TabGroup, TabList, TabPanels } from "@headlessui/vue";
    import { computed, onMounted, ref } from "vue";
    import type { TabItem } from "@/components/types";
    import { useElementVisibility, useScroll } from "@vueuse/core";
    import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/vue/24/outline";

    interface Props {
        tabList: TabItem[];
        modelValue?: number;
        /**
         * When true, tabs wrap into multiple rows instead of using horizontal scroll.
         */
        wrapTabs?: boolean;

        /**
         * When true, the tab panel area gets its own vertical scrollbar (overflow-auto).
         * When false (default), panels "splay out" and rely on the parent container to scroll.
         */
        scrollPanels?: boolean;
    }

    const props = withDefaults(defineProps<Props>(), {
        wrapTabs: true,
        scrollPanels: false,
    });

    const emit = defineEmits<{
        (e: "update:modelValue", value: number): void;
    }>();

    // Controlled/uncontrolled selected index
    const internalSelected = ref(0);

    const selectedIndex = computed<number>({
        get() {
            return props.modelValue === undefined ? internalSelected.value : props.modelValue;
        },
        set(v) {
            if (props.modelValue === undefined) internalSelected.value = v;
            emit("update:modelValue", v);
        },
    });

    const tabListItems = computed(() => {
        return props.tabList.map((i) => {
            if (typeof i === "string") return { label: i, title: undefined as string | undefined };
            return { label: i.label, title: i.title };
        });
    });

    // Horizontal scroll controls (only used when wrapTabs === false)
    const scrollRef = ref<HTMLElement | null>(null);
    const startTarget = ref<HTMLElement | null>(null);
    const endTarget = ref<HTMLElement | null>(null);

    const { x: scrollX } = useScroll(scrollRef, { behavior: "smooth" });

    const isStartVisible = useElementVisibility(startTarget);
    const isEndVisible = useElementVisibility(endTarget);

    const showLeft = computed(() => !props.wrapTabs && !isStartVisible.value);
    const showRight = computed(() => !props.wrapTabs && !isEndVisible.value);

    function scrollTabsBy(deltaPx: number) {
        const el = scrollRef.value;
        if (!el) return;
        el.scrollBy({ left: deltaPx, behavior: "smooth" });
    }

    function onChange(i: number) {
        selectedIndex.value = i;
    }

    onMounted(() => {
        // Ensure we start at left when using scroll mode.
        if (!props.wrapTabs && scrollRef.value) scrollRef.value.scrollLeft = 0;
    });
</script>

<template>
    <TabGroup :selected-index="selectedIndex" @change="onChange" class="-mx-4 mt-2" as="div">
        <!-- Tabs -->
        <div class="border-b-2 px-4">
            <div class="relative">
                <!-- Scroll buttons only in non-wrapping mode -->
                <button v-if="showLeft"
                        type="button"
                        class="absolute left-0 top-1/2 z-10 -translate-y-1/2 rounded-md bg-white/90 p-1 shadow-sm ring-1 ring-slate-200 hover:bg-white dark:bg-slate-900/90 dark:ring-slate-700"
                        aria-label="Scroll tabs left"
                        @click="scrollTabsBy(-260)">
                    <ChevronLeftIcon class="h-5 w-5 text-slate-700 dark:text-slate-200" />
                </button>

                <button v-if="showRight"
                        type="button"
                        class="absolute right-0 top-1/2 z-10 -translate-y-1/2 rounded-md bg-white/90 p-1 shadow-sm ring-1 ring-slate-200 hover:bg-white dark:bg-slate-900/90 dark:ring-slate-700"
                        aria-label="Scroll tabs right"
                        @click="scrollTabsBy(260)">
                    <ChevronRightIcon class="h-5 w-5 text-slate-700 dark:text-slate-200" />
                </button>

                <TabList v-slot="{ selectedIndex: si }"
                         :class="[
            props.wrapTabs ? 'flex flex-wrap gap-x-4 gap-y-2 py-2' : 'flex gap-4 py-2',
            props.wrapTabs ? '' : 'overflow-x-auto no-scrollbar scroll-smooth px-8',
          ]"
                         ref="scrollRef">
                    <div v-if="!wrapTabs" ref="startTarget" class="w-4 shrink-0"></div>

                    <Tab v-for="({ label, title }, i) in tabListItems"
                         :key="i"
                         :title="title"
                         :class="[
              si === i
                ? 'border-army text-army dark:text-indigo-400'
                : 'border-transparent text-slate-600 dark:text-slate-300',
              'border-b-2 px-1 py-1 text-sm font-medium whitespace-nowrap',
            ]">
                        {{ label }}
                    </Tab>

                    <div v-if="!wrapTabs" ref="endTarget" class="w-4 shrink-0"></div>
                </TabList>
            </div>
        </div>

        <!-- Panels: default to "splay out" (no internal scrollbar) -->
        <TabPanels :class="['w-full px-4', props.scrollPanels ? 'overflow-auto' : 'overflow-visible']">
            <slot />
        </TabPanels>
    </TabGroup>
</template>

<style scoped>
    /* Optional: hide scrollbar while still allowing scroll; used only in non-wrapping tabs mode. */
    .no-scrollbar::-webkit-scrollbar {
        display: none;
    }

    .no-scrollbar {
        -ms-overflow-style: none;
        scrollbar-width: none;
    }
</style>
