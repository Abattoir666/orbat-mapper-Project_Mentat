<script setup lang="ts">
const props = defineProps<{
  item: {
    id: string
    category: "Coordinates"
    lat: number
    lon: number
    zoom?: number
    label: string
  }
  active: boolean
}>();
</script>

<template>
  <li
    class="flex cursor-default select-none items-center px-4 py-2"
    :class="active ? 'bg-indigo-600 text-white' : 'text-gray-900'"
  >
    <!-- icon -->
    <svg class="mr-3 h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z"/>
    </svg>

    <div class="flex flex-col">
      <span class="font-medium">
        Zoom to {{ item.lat.toFixed(5) }}, {{ item.lon.toFixed(5) }}
        <span v-if="item.zoom"> @{{ item.zoom }}</span>
      </span>
      <span class="text-xs opacity-80">{{ item.label }}</span>
    </div>
  </li>
</template>