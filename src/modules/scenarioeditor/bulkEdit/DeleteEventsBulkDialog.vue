<template>
  <div v-if="modelValue" class="bulk-dialog-backdrop">
    <div class="bulk-dialog">
      <header class="bulk-dialog__header">
        <h3>Delete events in time range</h3>
        <button
          type="button"
          class="bulk-dialog__close"
          @click="close"
        >
          X
        </button>
      </header>

      <section class="bulk-dialog__body">
        <DeleteEventsBulkPanel
          :selected-unit-ids="selectedUnitIds"
        />
      </section>

      <footer class="bulk-dialog__footer">
        <button type="button" class="bulk-dialog__button" @click="close">
          Close
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import DeleteEventsBulkPanel from "./DeleteEventsBulkPanel.vue";

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
  background: rgba(0, 0, 0, 0.4);
  z-index: 5000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.bulk-dialog {
  background: #1f1f1f;
  color: #f5f5f5;
  min-width: 360px;
  max-width: 520px;
  border-radius: 6px;
  box-shadow: 0 0 24px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
}

.bulk-dialog__header,
.bulk-dialog__footer {
  padding: 0.5rem 0.75rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.bulk-dialog__body {
  padding: 0.75rem;
}

.bulk-dialog__close {
  border: none;
  background: transparent;
  color: inherit;
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
