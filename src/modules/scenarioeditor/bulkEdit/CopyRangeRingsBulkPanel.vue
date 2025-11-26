<template>
  <div class="bulk-panel">
    <h3 class="bulk-panel__title">
      Copy range-rings between selected units
    </h3>

    <p class="bulk-panel__note">
      Choose a source unit from the current selection. Its
      <code>rangeRings</code> configuration (radii, styles, heights, etc.)
      will be applied to the other selected units. Unit positions are not
      changed.
    </p>

    <div class="bulk-panel__field">
      <label class="bulk-panel__label">
        Source unit
        <select
          v-model="sourceUnitId"
          class="bulk-panel__select"
        >
          <option disabled value="">(select a unit)</option>
          <option
            v-for="u in availableUnits"
            :key="u.id"
            :value="u.id"
          >
            {{ u.name }} ({{ u.id }})
          </option>
        </select>
      </label>
    </div>

    <div class="bulk-panel__field">
      <label class="bulk-panel__label">
        Copy mode
        <select
          v-model="mode"
          class="bulk-panel__select"
        >
          <option value="replace">
            Replace existing range-rings on destination units
          </option>
          <option value="append">
            Append source range-rings to existing ones
          </option>
        </select>
      </label>
    </div>

    <p class="bulk-panel__note">
      Affects the other {{ targetCount }} selected unit(s).
      This operation is undoable via the scenario history.
    </p>

    <div class="bulk-panel__actions">
      <button
        type="button"
        class="bulk-panel__button"
        :disabled="!canApply"
        @click="apply"
      >
        Apply
      </button>
      <span
        v-if="error"
        class="bulk-panel__error"
      >
        {{ error }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { injectStrict } from "@/utils";
import { activeScenarioKey } from "@/components/injects";
import {
  copyRangeRingsFromUnitToUnitsBulk,
  type RangeRingsBulkCopyMode,
} from "@/modules/scenarioeditor/bulkEdit/quickBulkActions";

const props = defineProps<{
  selectedUnitIds: string[];
}>();

const { store } = injectStrict(activeScenarioKey);

const sourceUnitId = ref<string>(props.selectedUnitIds[0] ?? "");
const mode = ref<RangeRingsBulkCopyMode>("replace");
const isWorking = ref(false);
const error = ref<string | null>(null);

// Keep source in sync with selection
watch(
  () => props.selectedUnitIds.slice(),
  (ids) => {
    if (!ids.includes(sourceUnitId.value)) {
      sourceUnitId.value = ids[0] ?? "";
    }
  }
);

type UnitOption = { id: string; name: string };

const availableUnits = computed<UnitOption[]>(() => {
  const out: UnitOption[] = [];

  const umRaw =
    (store as any)?.state?.unitMap ??
    (store as any)?.unitMap ??
    (store as any)?.unitMap?.value;

  const getFromMapLike = (id: string): any => {
    if (!umRaw) return undefined;
    if (typeof umRaw.get === "function") return umRaw.get(id);
    if (Array.isArray(umRaw)) {
      return umRaw.find((u: any) => u?.id === id);
    }
    if (typeof umRaw === "object") {
      return (umRaw as any)[id];
    }
    return undefined;
  };

  for (const id of props.selectedUnitIds ?? []) {
    const u = getFromMapLike(id);
    if (!u) continue;
    const name = (u as any).name ?? (u as any).info?.name ?? id;
    out.push({ id, name });
  }

  return out;
});

const targetCount = computed(() => {
  const ids = props.selectedUnitIds ?? [];
  if (!sourceUnitId.value) return ids.length;
  return ids.filter((id) => id !== sourceUnitId.value).length;
});

const canApply = computed(
  () =>
    !!sourceUnitId.value &&
    (props.selectedUnitIds?.length ?? 0) > 1 &&
    targetCount.value > 0 &&
    !isWorking.value
);

async function apply() {
  if (!canApply.value) return;

  error.value = null;
  isWorking.value = true;
  try {
    const ids = (props.selectedUnitIds ?? []).filter(
      (id) => id !== sourceUnitId.value
    );
    copyRangeRingsFromUnitToUnitsBulk(store, sourceUnitId.value, ids, {
      mode: mode.value,
    });
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
  margin: 0 0 0.25rem 0;
  font-size: 1rem;
}

.bulk-panel__note {
  font-size: 0.85rem;
  color: #ccc;
}

.bulk-panel__field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.bulk-panel__label {
  font-size: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.bulk-panel__select {
  padding: 0.25rem 0.4rem;
  font-size: 0.85rem;
  background: #222;
  color: #f5f5f5;
  border: 1px solid #555;
  border-radius: 3px;
}

.bulk-panel__actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.bulk-panel__button {
  padding: 0.25rem 0.75rem;
  font-size: 0.85rem;
  border-radius: 4px;
  border: 1px solid #555;
  background-color: #444;
  color: #f5f5f5;
  cursor: pointer;
}

.bulk-panel__button[disabled] {
  opacity: 0.6;
  cursor: default;
}

.bulk-panel__error {
  color: #c62828;
  font-size: 0.85rem;
}
</style>
