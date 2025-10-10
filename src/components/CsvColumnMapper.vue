<template>
    <div class="space-y-4">
        <!-- File picker -->
        <div class="flex items-center gap-3" v-if="!props.initialFile">
            <input type="file" accept=".csv" @change="onPick" />
            <span v-if="fileName" class="text-sm opacity-70">Loaded: {{ fileName }}</span>
        </div>

        <!-- When the parent passes an initialFile, show its name instead of input -->
        <div v-else class="text-sm opacity-70">
            Loaded: {{ fileName || props.initialFile?.name }}
        </div>

        <!-- Column mapping controls -->
        <div v-if="headers.length" class="grid gap-3 md:grid-cols-2">
            <div v-for="f in fields" :key="f" class="flex items-center gap-2">
                <label class="w-40 text-sm">{{ labelOf(f) }}</label>
                <select v-model="mapping[f]" class="border rounded px-2 py-1 w-full">
                    <option value="">-- None --</option>
                    <option v-for="h in headers" :key="h" :value="h">{{ h }}</option>
                </select>
            </div>
        </div>

        <!-- Validation -->
        <div v-if="errors.length" class="text-red-600 text-sm">
            <div v-for="e in errors" :key="e">• {{ e }}</div>
        </div>

        <!-- Preview -->
        <div v-if="preview.length" class="border rounded p-3 overflow-auto">
            <div class="text-xs opacity-70 mb-2">Preview (first 5 rows)</div>
            <table class="w-full text-sm">
                <thead>
                    <tr>
                        <th v-for="f in fields" :key="f" class="text-left p-1">
                            {{ labelOf(f) }}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="(r,i) in preview.slice(0,5)" :key="i">
                        <td v-for="f in fields" :key="f" class="p-1">
                            {{ r[f] ?? "" }}
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- Actions -->
        <div class="flex gap-2">
            <button class="border rounded px-3 py-1"
                    :disabled="rows.length===0"
                    @click="$emit('cancel')"
                    type="button">
                Cancel
            </button>

            <button class="border rounded px-3 py-1"
                    :disabled="errors.length>0 || rows.length===0"
                    @click="onConfirm"
                    type="button">
                Use Mapping
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
    import Papa from "papaparse";
    import { ref, computed, onMounted } from "vue";
    import type { ImportRow } from "@/importexport/importUnits";

onMounted(() => {
  console.log("[CsvColumnMapper] initialFile:", props.initialFile);
  if (props.initialFile) parseFile(props.initialFile);
});

   const props = defineProps<{
   initialFile?: File | null;
   }>();

    /* Target fields we can map to */
    type ImportField =
        | "id" | "name" | "sidc" | "side" | "group" | "parent_id"
        | "lat" | "lon" | "t" | "fillColor";

    /* Emits */
    const emit = defineEmits<{
        (e: "mapped", rows: ImportRow[]): void;
        (e: "cancel"): void;
    }>();

    const REQUIRED: ImportField[] = ["name"];
    const NUMERIC: ImportField[] = ["lat", "lon", "t"];
    const fields: ImportField[] = [
        "id", "name", "sidc", "side", "group", "parent_id", "lat", "lon", "t", "fillColor"
    ];

    const fileName = ref<string>("");
    const headers = ref<string[]>([]);
    const rows = ref<any[]>([]);
    const mapping = ref<Partial<Record<ImportField, string>>>({});

    /* Labels */
    function labelOf(f: ImportField): string {
        switch (f) {
            case "id": return "ID (preserve if present)";
            case "name": return "Unit name";
            case "sidc": return "SIDC";
            case "side": return "Side";
            case "group": return "Group";
            case "parent_id": return "Parent ID";
            case "lat": return "Latitude";
            case "lon": return "Longitude";
            case "t": return "Time (epoch ms)";
            case "fillColor": return "Fill color (#RRGGBB)";
            default: return f;
        }
    }

/* File handler */
function parseFile(file: File) {
  fileName.value = file.name;

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: (res) => {
      rows.value = (res.data as any[]).filter(Boolean);
      headers.value = res.meta.fields ?? Object.keys(rows.value[0] ?? {});
      autoMap();
    },
    error: (err) => {
      console.error("CSV parse error", err);
      rows.value = [];
      headers.value = [];
      mapping.value = {};
      fileName.value = "";
    }
  });
}

function onPick(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) parseFile(file);
}

onMounted(() => {
  if (props.initialFile) {
    parseFile(props.initialFile);
  }
});

    /* Simple automap guesses */
    function autoMap() {
        const lower = (s: string) => s.toLowerCase();
        const pick = (...cands: string[]) => {
            for (const c of cands) {
                const h = headers.value.find(h => lower(h) === lower(c));
                if (h) return h;
            }
            return "";
        };
        mapping.value.name = pick("name", "unit", "title");
        mapping.value.id = pick("id", "uid", "unit_id");
        mapping.value.sidc = pick("sidc", "symbol", "code");
        mapping.value.side = pick("side", "faction", "team");
        mapping.value.group = pick("group", "folder", "collection");
        mapping.value.parent_id = pick("parent_id", "parent", "pid");
        mapping.value.lat = pick("lat", "latitude", "y");
        mapping.value.lon = pick("lon", "longitude", "x");
        mapping.value.t = pick("t", "time", "timestamp", "epoch");
        mapping.value.fillColor = pick("fillColor", "fill", "color");
    }

    /* Validation */
    const errors = computed(() => {
        const out: string[] = [];
        for (const f of REQUIRED) {
            if (!mapping.value[f]) out.push(`Required field "${labelOf(f)}" is not mapped.`);
        }
        for (const f of NUMERIC) {
            const h = mapping.value[f];
            if (!h) continue;
            const bad = rows.value.slice(0, 50).find(r => r[h] !== "" && isNaN(Number(r[h])));
            if (bad) out.push(`Column "${h}" for "${labelOf(f)}" contains non-numeric values.`);
        }
        return out;
    });

    /* Preview */
    const preview = computed<ImportRow[]>(() =>
        rows.value.slice(0, 20).map(r => mapRow(r, mapping.value))
    );

    /* Row mapper */
    function mapRow(r: any, m: Partial<Record<ImportField, string>>): ImportRow {
        const g = (f: ImportField) => (m[f] ? r[m[f]!] : undefined);
        return {
            id: g("id"),
            name: (g("name") ?? "").toString(),
            sidc: g("sidc"),
            side: (g("side") ?? "").toString(),
            group: (g("group") ?? "").toString(),
            parent_id: g("parent_id"),
            fillColor: g("fillColor"),
            t: g("t") != null ? Number(g("t")) : undefined,
            lat: g("lat") != null ? Number(g("lat")) : undefined,
            lon: g("lon") != null ? Number(g("lon")) : undefined,
        };
    }

    /* Emit mapped rows */
    function onConfirm() {
        const mapped = rows.value.map(r => mapRow(r, mapping.value));
        emit("mapped", mapped);
    }
onMounted(() => {
  if (props.initialFile) {
    parseFile(props.initialFile);
  }
});
</script>