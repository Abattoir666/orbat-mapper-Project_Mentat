<template>
  <div class="bulk-panel">
    <h3 class="bulk-panel__title">
      Delete events in time range (selected units)
    </h3>

    <p class="bulk-panel__note">
      This will remove events from the currently selected units only.
      Events are matched by their time fields (time, t, date, or at).
      This operation is undoable via the scenario history.
    </p>

    <div class="bulk-panel__field">
      <label class="bulk-panel__label">
        From
        <input
          v-model="from"
          type="datetime-local"
          class="bulk-panel__input"
        />
      </label>
    </div>

    <div class="bulk-panel__field">
      <label class="bulk-panel__label">
        To
        <input
          v-model="to"
          type="datetime-local"
          class="bulk-panel__input"
        />
      </label>
    </div>

    <div class="bulk-panel__field bulk-panel__field--summary">
      <div>Selected units: {{ selectedCount }}</div>
      <div v-if="error" class="bulk-panel__error">{{ error }}</div>
    </div>

    <div class="bulk-panel__actions">
      <button
        type="button"
        class="bulk-panel__button bulk-panel__button--danger"
        :disabled="isWorking || selectedCount === 0"
        @click="onDeleteClick"
      >
        <span v-if="isWorking">Deleting...</span>
        <span v-else>Delete events in range</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { injectStrict } from "@/utils";
import { activeScenarioKey } from "@/components/injects";
import { deleteEventsInTimeRangeForUnitsBulk } from "@/modules/scenarioeditor/bulkEdit/quickBulkActions";

const props = defineProps<{
  selectedUnitIds: string[];
}>();

const { store } = injectStrict(activeScenarioKey);

const from = ref<string>("");
const to = ref<string>("");
const isWorking = ref(false);
const error = ref<string | null>(null);

const selectedCount = computed(() => props.selectedUnitIds?.length ?? 0);

function onDeleteClick() {
  error.value = null;

  if (!selectedCount.value) {
    error.value = "No units selected.";
    return;
  }

  if (!from.value || !to.value) {
    error.value = "Please set both start and end times.";
    return;
  }

  const range = {
    from: from.value,
    to: to.value,
  };

  isWorking.value = true;
  try {
    deleteEventsInTimeRangeForUnitsBulk(store, props.selectedUnitIds, range);
  } catch (e: any) {
    console.error(e);
    error.value = e?.message ?? String(e);
  } finally {
    isWorking.value = false;
  }
}
</script>

<style scoped>
.bulk-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.bulk-panel__title {
  font-size: 0.95rem;
  font-weight: 600;
}

.bulk-panel__note {
  font-size: 0.8rem;
  opacity: 0.8;
}

.bulk-panel__field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.bulk-panel__field--summary {
  font-size: 0.85rem;
}

.bulk-panel__label {
  display: flex;
  flex-direction: column;
  font-size: 0.85rem;
  gap: 0.25rem;
}

.bulk-panel__input {
  font-size: 0.85rem;
  padding: 0.25rem 0.4rem;
  color: #f5f5f5;
  background-color: #1f1f1f;
  border: 1px solid #555;
  border-radius: 4px;
}

.bulk-panel__actions {
  display: flex;
  justify-content: flex-start;
  margin-top: 0.5rem;
}

.bulk-panel__button {
  padding: 0.35rem 0.75rem;
  font-size: 0.85rem;
  border-radius: 4px;
  border: 1px solid transparent;
  cursor: pointer;
}

.bulk-panel__button--danger {
  background-color: #c62828;
  color: #fff;
}

.bulk-panel__button[disabled] {
  opacity: 0.6;
  cursor: default;
}

.bulk-panel__error {
  color: #c62828;
}
</style>
