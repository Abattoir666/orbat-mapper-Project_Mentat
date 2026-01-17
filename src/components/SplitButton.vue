<script setup lang="ts">
import { computed, ref } from "vue";
import { type ButtonGroupItem } from "./types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-vue-next";
import { cn } from "@/lib/utils.ts";

    interface Props {
        items: ButtonGroupItem[];
        static?: boolean;
        activeItem?: ButtonGroupItem | null | undefined;
        triggerClass?: string;

        menuSide?: "top" | "bottom" | "left" | "right";
        menuClass?: string;
        itemClass?: string;

        /** Optional extra classes for the main (left) button. */
        buttonClass?: string;

        /** Optional extra classes for the chevron (right) button. If omitted, buttonClass is used. */
        caretButtonClass?: string;
    }

    const props = withDefaults(defineProps<Props>(), {
        static: false,
        menuSide: "bottom",
        menuClass: "",
        itemClass: "",
        buttonClass: "",
        caretButtonClass: "",
    });
const emit = defineEmits(["update:activeItem"]);

const _activeItem = ref(props.items[0]);

const activeItemRef = computed({
  get() {
    return props.activeItem || _activeItem.value;
  },
  set(v) {
    _activeItem.value = v;
    emit("update:activeItem", v);
  },
});

const menuItems = computed(() =>
  props.items.filter((e) => e.label !== activeItemRef.value?.label),
);

const onClick = (item: ButtonGroupItem) => {
  if (!props.static) activeItemRef.value = item;
  item.onClick();
};
</script>

<template>
  <div class="flex items-center">
      <Button variant="outline"
              @click="onClick(activeItemRef)"
              :disabled="activeItemRef.disabled"
              :class="cn('rounded-r-none text-left ring-inset', props.buttonClass)"
              :title="activeItemRef.label">
          <span :class="cn('truncate', triggerClass)">{{ activeItemRef.label }}</span>
      </Button>

    <DropdownMenu>
      <DropdownMenuTrigger as-child>
          <Button variant="outline"
                  size="icon"
                  :class="cn(
    'rounded-l-none border-l-0 px-2 ring-inset',
    props.caretButtonClass || props.buttonClass
  )">
              <ChevronDown />
          </Button>
      </DropdownMenuTrigger>

      <!--
        IMPORTANT: DropdownMenuContent is typically teleported. We set explicit
        background + text colors here so it remains readable even if the app
        enforces white text globally.
      -->
      <DropdownMenuContent align="end"
                           :side="props.menuSide"
                           :class="cn('z-[10000] bg-gray-200 text-black shadow-lg border border-gray-300', props.menuClass)">
          <DropdownMenuItem v-for="item in menuItems"
                            :key="item.label"
                            :disabled="item.disabled"
                            @select="onClick(item)"
                            :class="cn('text-black hover:bg-black/10 focus:bg-black/10', props.itemClass)">
              {{ item.label }}
          </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
