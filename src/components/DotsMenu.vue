<script setup lang="ts">
    import { computed, ref, toRefs } from "vue";
    import { Button } from "@/components/ui/button";
    import { EllipsisVertical } from "lucide-vue-next";
    import type { MenuItemData } from "@/components/types";
    import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

    type LayoutMode = "list" | "grid";

    const props = withDefaults(
        defineProps<{
            items: MenuItemData[];

            /**
             * Layout for the action list.
             * - "list": one item per row
             * - "grid": multi-column (better when this menu is acting as a "hidden tabs" overflow)
             */
            layout?: LayoutMode;

            /**
             * Used only when layout="grid".
             */
            columns?: 2 | 3;

            /**
             * Optional: constrain popout height and allow scrolling if the list is extremely long.
             * Leave undefined to let it fully "splay out".
             */
            maxHeightPx?: number;

            /**
             * Optional: set to true to disable the trigger.
             */
            disabled?: boolean;

            /**
             * Optional: tooltip/title for the trigger button.
             */
            title?: string;

            /**
             * Optional: size tweak so the three-dots matches Unit State's affordance.
             * - "sm": smaller icon button
             * - "md": default
             */
            size?: "sm" | "md";
        }>(),
        {
            layout: "grid",
            columns: 2,
            disabled: false,
            title: "More actions",
            size: "sm",
        },
    );

    const emit = defineEmits<{
        (e: "select", action: unknown, item: MenuItemData): void;
    }>();

    const { items, layout, columns, maxHeightPx, disabled, title, size } = toRefs(props);

    const isOpen = ref(false);

    const gridWrapClass = computed(() => {
        if (layout.value !== "grid") return "flex flex-col";
        return columns.value === 3 ? "grid grid-cols-3 gap-1" : "grid grid-cols-2 gap-1";
    });

    const triggerClass = computed(() => {
        // Unit State controls are visually compact; match that.
        return size.value === "sm" ? "h-8 w-8" : "h-9 w-9";
    });

    const iconClass = computed(() => {
        return size.value === "sm" ? "size-5" : "size-5";
    });

    const contentStyle = computed(() => {
        if (!maxHeightPx.value) return undefined;
        return {
            maxHeight: `${maxHeightPx.value}px`,
            overflowY: "auto",
        } as Record<string, string>;
    });

    function onItemClick(item: MenuItemData) {
        if ((item as any)?.disabled) return;

        const onClick = (item as any)?.onClick;
        if (typeof onClick === "function") {
            onClick();
            isOpen.value = false;
            return;
        }

        const action = (item as any)?.action;

        if (typeof action === "function") {
            action();
            isOpen.value = false;
            return;
        }

        emit("select", action, item);
        isOpen.value = false;
    }
</script>

<template>
    <div class="flex justify-end">
        <!-- Popover behaves like Unit State's popout window and escapes clipped panels -->
        <Popover v-model:open="isOpen">
            <PopoverTrigger as-child>
                <Button variant="ghost"
                        size="icon"
                        :title="title"
                        :aria-label="title"
                        :disabled="disabled"
                        :class="triggerClass">
                    <EllipsisVertical :class="iconClass" />
                </Button>
            </PopoverTrigger>

            <PopoverContent class="z-[4000] w-[min(36rem,calc(100vw-1.25rem))] p-2 shadow-lg"
                            :style="contentStyle"
                            @click.stop>
                <div :class="gridWrapClass">
                    <button v-for="item in items"
                            :key="item.label"
                            type="button"
                            class="w-full rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800"
                            :class="(item as any).destructive ? 'text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30' : ''"
                            :disabled="(item as any).disabled"
                            @click="onItemClick(item)">
                        <span class="block truncate">{{ item.label }}</span>
                    </button>
                </div>
            </PopoverContent>
        </Popover>
    </div>
</template>
