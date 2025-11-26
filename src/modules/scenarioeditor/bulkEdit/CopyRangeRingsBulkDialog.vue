<template>
  <div v-if="modelValue" class="bulk-dialog-backdrop">
    <div class="bulk-dialog">
      <header class="bulk-dialog__header">
        <h3>Copy range-rings (bulk)</h3>
        <button
          type="button"
          class="bulk-dialog__close"
          @click="close"
        >
          X
        </button>
      </header>

      <section class="bulk-dialog__body">
        <CopyRangeRingsBulkPanel :selectedUnitIds="selectedUnitIds" />
      </section>

      <footer class="bulk-dialog__footer">
        <button
          type="button"
          class="bulk-dialog__button"
          @click="close"
        >
          Close
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import CopyRangeRingsBulkPanel from "./CopyRangeRingsBulkPanel.vue";

const props = defineProps<{
  modelValue: boolean;
  selectedUnitIds: string[];
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
}>();

function close() {
  emit("update:modelValue", false);
}
</script>

<style scoped>
.bulk-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
}

.bulk-dialog {
  width: 480px;
  max-width: 100vw;
  max-height: 90vh;
  background: #222;
  color: #f5f5f5;
  border-radius: 4px;
  box-shadow: 0 0 20px rgba(0, 0, 0, 0.7);
  display: flex;
  flex-direction: column;
}

.bulk-dialog__header {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #444;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.bulk-dialog__body {
  padding: 0.75rem;
  overflow-y: auto;
}

.bulk-dialog__footer {
  padding: 0.5rem 0.75rem;
  border-top: 1px solid #444;
  display: flex;
  justify-content: flex-end;
}

.bulk-dialog__close {
  border: none;
  background: transparent;
  color: #f5f5f5;
  cursor: pointer;
  font-size: 1rem;
}

.bulk-dialog__button {
  padding: 0.25rem 0.75rem;
  font-size: 0.85rem;
  border-radius: 4px;
  border: 1px solid #555;
  background: #333;
  color: #f5f5f5;
  cursor: pointer;
}
</style>
