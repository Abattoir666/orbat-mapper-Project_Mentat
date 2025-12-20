<template>
    <div class="space-y-4">
        <!-- File picker shows until we actually have a parsed/selected name -->
        <div class="flex items-center gap-3" v-if="!fileName">
            <input type="file" accept=".csv" @change="onPick" />
        </div>

        <!-- After parse/pick, show the name -->
        <div v-else class="text-sm opacity-70">
            Loaded: {{ fileName }}
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
        <!-- Debug toggle -->
        <div class="mt-2 text-xs">
            <label class="inline-flex items-center gap-2">
                <input type="checkbox" v-model="showDebug" />
                <span>Show parse debug (first 10 rows)</span>
            </label>
        </div>

        <!-- Debug table -->
        <div v-if="showDebug && debugRows.length" class="mt-2 overflow-auto border rounded">
            <table class="min-w-[900px] w-full text-xs">
                <thead class="bg-black/5 dark:bg-white/10">
                    <tr>
                        <th class="p-1 text-left">#</th>
                        <th class="p-1 text-left">rawLat</th>
                        <th class="p-1 text-left">rawLon</th>
                        <th class="p-1 text-left">lat lead codes</th>
                        <th class="p-1 text-left">lon lead codes</th>
                        <th class="p-1 text-left">normLat</th>
                        <th class="p-1 text-left">normLon</th>
                        <th class="p-1 text-left">parsedLat</th>
                        <th class="p-1 text-left">parsedLon</th>
                        <th class="p-1 text-left">rawT</th>
                        <th class="p-1 text-left">normT</th>
                        <th class="p-1 text-left">parsedT</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="r in debugRows" :key="r.row">
                        <td class="p-1">{{ r.row }}</td>
                        <td class="p-1">{{ r.rawLat }}</td>
                        <td class="p-1">{{ r.rawLon }}</td>
                        <td class="p-1 whitespace-nowrap">{{ r.latLead }}</td>
                        <td class="p-1 whitespace-nowrap">{{ r.lonLead }}</td>
                        <td class="p-1">{{ r.normLat }}</td>
                        <td class="p-1">{{ r.normLon }}</td>
                        <td class="p-1">{{ r.parsedLat }}</td>
                        <td class="p-1">{{ r.parsedLon }}</td>
                        <td class="p-1">{{ r.rawT }}</td>
                        <td class="p-1">{{ r.normT }}</td>
                        <td class="p-1">{{ r.parsedT }}</td>
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


            <!-- Make sure it's NOT hidden/disabled unexpectedly -->
            <BaseButton id="useMappingBtn" type="button" :disabled="!hasRows" @click.stop="onConfirm">
                Use Mapping
            </BaseButton>
        </div>
        <div class="mt-4 rounded border p-3">
            <div class="font-medium mb-2">Timestamp source</div>
            <label class="flex items-center gap-2 mb-1">
                <input type="radio" value="csv" v-model="timestampMode" />
                <span>Use CSV time (preferred)</span>
            </label>
            <label class="flex items-center gap-2 mb-1">
                <input type="radio" value="scenario-current" v-model="timestampMode" />
                <span>Scenario current time</span>
            </label>
            <label class="flex items-center gap-2">
                <input type="radio" value="scenario-start" v-model="timestampMode" />
                <span>Scenario start time</span>
            </label>

            <p v-if="timestampMode==='csv' && !mapping.t" class="text-xs text-red-600 mt-2">
                CSV time selected but no time column mapped — will fall back to scenario start.
            </p>
        </div>
    </div>
</template>

<script setup lang="ts">
    import Papa from "papaparse";
    import { ref, computed, onMounted, watchEffect } from "vue";
    import type { ImportRow } from "@/importexport/importUnits";
    import BaseButton from "@/components/BaseButton.vue";


    type TimestampMode = "csv" | "scenario-current" | "scenario-start";
    const timestampMode = ref<TimestampMode>("csv");
    const DEFAULT_SIDC = "10061000001211000000";
    const mappedRows = ref<ImportRow[]>([]);

    const props = defineProps<{
        onMapped?: (payload: { rows: ImportRow[]; timestampMode: "csv" | "scenario-current" | "scenario-start" }) => void;
        onCancel?: () => void;
        initialFile?: File | Blob | {
            file?: File | Blob;
            name?: string;
            dataAsText?: string;
            text?: string;
        } | any;
    }>();

    function normalizeRows(rows: Record<string, unknown>[]) {
        return rows.map((row) => {
            const out: Record<string, unknown> = {};
            for (const key in row) {
                // strip BOM + trim on header names
                const cleanKey = key.replace(/\uFEFF/g, "").trim();
                let v = row[key];

                // if value is a string, strip BOM + NBSP and trim
                if (typeof v === "string") {
                    v = v.replace(/\uFEFF/g, "").replace(/\u00A0/g, " ").trim();
                }
                out[cleanKey] = v;
            }
            return out;
        });
    }

    // --- STRICT decimal-only CSV number parsing (no DMS, no hemisphere letters) ---
    const csvNum = {
        coerce(val: unknown): number | undefined {
            if (val == null) return undefined;

            // Already a number
            if (typeof val === "number") return Number.isFinite(val) ? val : undefined;

            // Stringify + strip BOM / odd spaces
            let s = String(val)
                .replace(/\uFEFF/g, "")                                // BOM
                .replace(/[\u2000-\u200D\u202F\u2060\u2066-\u2069]/g, "") // invisible format chars
                .replace(/\u00A0/g, " ")                               // NBSP → space
                .trim();

            if (!s) return undefined;

            // Normalize Unicode dashes (– — −) to ASCII hyphen-minus
            s = s.replace(/[\u2212\u2010-\u2015]/g, "-");

            // Optional: support decimal comma only when no dot is present
            if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");

            // Accept ONLY plain decimals:  -12  |  -12.34  |  12.34
            // (no grouping separators, no units/letters)
            if (!/^[+-]?\d+(?:\.\d+)?$/.test(s)) return undefined;

            const n = Number(s);
            return Number.isFinite(n) ? n : undefined;
        },

        lat(val: unknown): number | undefined {
            const n = csvNum.coerce(val);
            return n == null || n < -90 || n > 90 ? undefined : n;
        },

        lon(val: unknown): number | undefined {
            const n = csvNum.coerce(val);
            return n == null || n < -180 || n > 180 ? undefined : n;
        },
    };

    // --- Debug helpers ---
    const showDebug = ref(false);

    /** show code points for leading characters (helps spot en-dash, NBSP, etc.) */
    function leadingCodes(v: unknown, take = 3): string {
        if (v == null) return "";
        const s = String(v);
        return [...s].slice(0, take).map(ch => {
            const cp = ch.codePointAt(0)!;
            return `${ch} U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
        }).join(" | ");
    }

    /** apply just the sign/space normalization from csvNum.coerce so we can see the effect */
    function normalizeForParse(v: unknown): string {
        if (v == null) return "";
        let s = String(v).replace(/\uFEFF/g, "").replace(/\u00A0/g, " ").trim();
        // normalize unicode minus/dashes → ASCII hyphen-minus
        s = s.replace(/[\u2212\u2010-\u2015]/g, "-");
        return s;
    }

    /* Target fields we can map to */
    type ImportField =
        | "id" | "name" | "sidc" | "side" | "group" | "parent_id"
        | "lat" | "lon" | "t" | "fillColor";

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
    async function parseCsvFromBlob(blob: Blob, name?: string) {
        if (name) fileName.value = name;
        const text = await blob.text();
        Papa.parse<string>(text, {
            header: true,
            dynamicTyping: false,
            skipEmptyLines: true,
            complete: ({ data, meta }) => {
                const result = { data, meta };
                // normalizeRows is your existing function
                const normalized = normalizeRows(result.data as any[]).filter(Boolean);

                headers.value = result.meta.fields
                    ? result.meta.fields.map((h: string) => h.replace(/\uFEFF/g, "").trim())
                    : [];

                // … whatever you already do next with normalized …
            },
            error: (err: any) => {
                console.error("[CsvColumnMapper] parse error", err);
            },
        });
    }

    function parseCsvFromText(text: string, name?: string) {
        if (name) fileName.value = name;
        Papa.parse(text, {
            header: true,
            skipEmptyLines: true,
            complete: (res) => {
                const normalized = normalizeRows(res.data as any[]).filter(Boolean);
                rows.value = normalized;
                headers.value = res.meta.fields?.map(h => h.replace(/\uFEFF/g, "").trim())
                    ?? Object.keys(normalized[0] ?? {});
                autoMap();
            },
            error: (err) => {
                console.error("CSV parse error (text)", err);
                rows.value = [];
                headers.value = [];
                mapping.value = {};
                fileName.value = "";
            }
        });
    }

    function parseInput(input: any) {
        if (!input) return;

        // Case 1: real File/Blob
        if (input instanceof Blob) {
            parseCsvFromBlob(input as Blob, (input as any)?.name);
            return;
        }

        // Case 2: wrapper object with { file }
        if (input.file instanceof Blob) {
            parseCsvFromBlob(input.file as Blob, input.file.name ?? input.name);
            return;
        }

        // Case 2b (optional): CSV text carried as ArrayBuffer on the wrapper
        if (input?.dialect === "CSV" && input?.dataAsArrayBuffer instanceof ArrayBuffer) {
            try {
                const text = new TextDecoder("utf-8").decode(input.dataAsArrayBuffer);
                parseCsvFromText(text, input.name);
                return;
            } catch (e) {
                console.warn("[CsvColumnMapper] failed to decode dataAsArrayBuffer as text", e);
            }
        }

        // Case 3: wrapper with raw text
        const txt = input.dataAsText ?? input.text;
        if (typeof txt === "string") {
            parseCsvFromText(txt, input.name);
            return;
        }

        console.warn("[CsvColumnMapper] initialFile is not a Blob or text; ignoring.", input);
    }

    function onPick(e: Event) {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) parseInput(file);
    }

    onMounted(() => {
        if (props.initialFile) parseInput(props.initialFile);
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

        // requireds
        for (const f of REQUIRED) {
            if (!mapping.value[f]) out.push(`Required field "${labelOf(f)}" is not mapped.`);
        }

        // numeric columns: sample up to 200 non-empty rows; allow blanks; require >=80% parsable
        for (const f of NUMERIC) {
            const h = mapping.value[f];
            if (!h) continue;

            let seen = 0;
            let ok = 0;
            let badExample: unknown = null;

            for (const r of rows.value) {
                let raw = r[h];

                // treat null/undefined/empty/whitespace-only (incl. NBSP) as "not present" → skip
                if (raw == null) continue;
                if (typeof raw === "string") {
                    raw = raw.replace(/\uFEFF/g, "").replace(/\u00A0/g, " ").trim();
                    if (raw === "") continue;
                }

                seen++;
                const num = csvNum.coerce(raw);
                if (num != null) ok++;
                else if (badExample == null) badExample = r[h];

                if (seen >= 200) break; // enough evidence
            }

            // only flag if we actually saw data and less than 80% parsed
            if (seen > 0 && ok / seen < 0.8) {
                const exampleTxt =
                    badExample == null ? "" : ` Example bad value: "${String(badExample)}".`;
                out.push(
                    `Column "${h}" for "${labelOf(f)}" contains non-numeric values (parsed ${ok}/${seen}).` +
                    exampleTxt
                );
            }
        }

        return out;
    });

    const hasRows = computed(() => {
        // must have data
        if (!Array.isArray(rows.value) || rows.value.length === 0) return false;
        // required fields mapped (currently only "name")
        if (!mapping.value.name) return false;
        // optional: don’t allow if you already computed errors for numeric columns
        if (errors.value.length > 0) return false;
        return true;
    });

    /* Preview */
    const preview = computed<ImportRow[]>(() =>
        rows.value.slice(0, 20).map(r => mapRow(r, mapping.value))
    );

    /* ---------- Robust Row Mapper ---------- */

    /* Row mapper */
    function mapRow(r: any, m: Partial<Record<ImportField, string>>): ImportRow {
        const g = (f: ImportField) => (m[f] ? r[m[f]!] : undefined);
        const sidcRaw = g("sidc");
        const sidc = sidcRaw && String(sidcRaw).trim() ? String(sidcRaw).trim() : "10061000001211000000";
        return {
            id: g("id"),
            name: (g("name") ?? "").toString(),
            sidc,
            side: (g("side") ?? "").toString(),
            group: (g("group") ?? "").toString(),
            parent_id: g("parent_id"),
            fillColor: g("fillColor"),
            t: csvNum.coerce(g("t")),
            lat: csvNum.lat(g("lat")),   // ← range-checked
            lon: csvNum.lon(g("lon")),   // ← range-checked
        };
    }


    function onConfirm() {
        console.debug("[CsvColumnMapper] onConfirm clicked; rows:", rows.value.length, "mapping:", mapping.value);

        if (!hasRows.value) {
            console.warn("[CsvColumnMapper] onConfirm blocked: no rows or mapping invalid");
            return;
        }

        // 1) map every raw row using the current mapping
        const mapped: ImportRow[] = rows.value.map((r) => mapRow(r, mapping.value));

        // 2) final normalization for numeric-like fields
        const toNum = (v: unknown) =>
            v == null || v === "" || Number.isNaN(Number(v)) ? undefined : Number(v);

        const normalized: ImportRow[] = mapped.map((r) => ({
            ...r,
            id: r.id ?? (Date.now().toString(36) + Math.random().toString(36).slice(2)),
            name: String(r.name ?? "").trim(),
            lat: toNum(r.lat as any),
            lon: toNum(r.lon as any),
            t: toNum(r.t as any),
        }));

        console.debug("[CsvColumnMapper] emitting to parent (prop-callback) rows:", normalized.length);
        props.onMapped?.({
            rows: normalized,
            timestampMode: timestampMode.value,
        });
    }

    /** sample first N rows: raw vs normalized vs parsed */
    const debugRows = computed(() => {
        const latH = mapping.value.lat;
        const lonH = mapping.value.lon;
        const tH = mapping.value.t;
        if (!latH && !lonH) return [];

        return rows.value.slice(0, 10).map((r, i) => {
            const rawLat = latH ? r[latH] : undefined;
            const rawLon = lonH ? r[lonH] : undefined;
            const rawT = tH ? r[tH] : undefined;

            const normLat = normalizeForParse(rawLat);
            const normLon = normalizeForParse(rawLon);
            const normT = normalizeForParse(rawT);

            const parsedLat = csvNum.lat(rawLat);
            const parsedLon = csvNum.lon(rawLon);
            const parsedT = csvNum.coerce(rawT);

            return {
                row: i + 1,
                rawLat,
                rawLon,
                latLead: leadingCodes(rawLat),
                lonLead: leadingCodes(rawLon),
                normLat,
                normLon,
                parsedLat,
                parsedLon,
                rawT,
                tLead: leadingCodes(rawT),
                normT,
                parsedT,
                latType: typeof rawLat,
                lonType: typeof rawLon,
            };
        });
    });

    /** dump a console table whenever mapping/rows change */
    watchEffect(() => {
        if (!mapping.value.lat && !mapping.value.lon) return;
        console.table(debugRows.value);
    });
</script>