import type { DoctrinalToeLibraryFile, DoctrinalToeTemplate } from "./doctrinalTypes";

function assertTemplateShape(t: any): t is DoctrinalToeTemplate {
    return Boolean(t && typeof t.key === "string" && typeof t.name === "string" && Array.isArray(t.personnel));
}

export function parseTemplatesFromJson(text: string): DoctrinalToeTemplate[] {
    const obj = JSON.parse(text);

    if (Array.isArray(obj)) {
        return obj.filter(assertTemplateShape);
    }

    if (obj && typeof obj === "object") {
        const maybeFile = obj as Partial<DoctrinalToeLibraryFile>;
        if (Array.isArray(maybeFile.templates)) {
            return maybeFile.templates.filter(assertTemplateShape);
        }
    }

    return [];
}

/**
 * Very small CSV/TSV reader with quote handling.
 * Expected columns (case-insensitive):
 * - templateKey, templateName, sidcPrefix, nameRegex, tags, roleName/name, count, description, source
 *
 * Multiple rows with same templateKey will be grouped into one template.
 */
export function parseTemplatesFromDelimited(text: string, delimiter?: "," | "\t"): DoctrinalToeTemplate[] {
    const rows = parseDelimited(text, delimiter);
    if (rows.length === 0) return [];

    const header = rows[0].map((h) => h.trim());
    const idx = indexHeader(header);

    const byKey = new Map<string, DoctrinalToeTemplate>();

    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const key = getCell(r, idx, ["templatekey", "key"]);
        const name = getCell(r, idx, ["templatename", "name"]) || key;

        if (!key) continue;

        let t = byKey.get(key);
        if (!t) {
            t = {
                key,
                name,
                match: {},
                personnel: [],
                source: getCell(r, idx, ["source"]) || undefined,
            };

            const sidcPrefixRaw = getCell(r, idx, ["sidcprefix"]);
            if (sidcPrefixRaw) t.match.sidcPrefix = splitList(sidcPrefixRaw);

            const nameRegexRaw = getCell(r, idx, ["nameregex"]);
            if (nameRegexRaw) t.match.nameRegex = splitList(nameRegexRaw);

            const tagsRaw = getCell(r, idx, ["tags"]);
            if (tagsRaw) t.match.tags = splitList(tagsRaw);

            byKey.set(key, t);
        }

        const roleName = getCell(r, idx, ["rolename", "role", "personnelname", "namepersonnel", "personnel"]);
        const countRaw = getCell(r, idx, ["count", "authorized", "auth"]);
        if (!roleName && !countRaw) continue;

        const count = Number(countRaw) || 0;
        const description = getCell(r, idx, ["description", "desc"]) || undefined;

        if (roleName) {
            t.personnel.push({
                name: roleName,
                count,
                description,
                onHand: undefined,
            });
        }
    }

    return [...byKey.values()];
}

function splitList(s: string): string[] {
    return s
        .split(/[;,|]/g)
        .map((x) => x.trim())
        .filter(Boolean);
}

function indexHeader(header: string[]): Record<string, number> {
    const map: Record<string, number> = {};
    header.forEach((h, i) => {
        map[h.replace(/\s+/g, "").toLowerCase()] = i;
    });
    return map;
}

function getCell(row: string[], idx: Record<string, number>, keys: string[]): string {
    for (const k of keys) {
        const i = idx[k];
        if (typeof i === "number" && i >= 0 && i < row.length) {
            const v = row[i]?.trim() ?? "";
            if (v) return v;
        }
    }
    return "";
}

function parseDelimited(text: string, delimiter?: "," | "\t"): string[][] {
    const cleaned = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    if (!cleaned) return [];

    // heuristic delimiter if not provided
    const firstLine = cleaned.split("\n", 1)[0] ?? "";
    const d: "," | "\t" = delimiter ?? (firstLine.includes("\t") ? "\t" : ",");

    const lines = cleaned.split("\n");
    return lines.map((line) => parseDelimitedLine(line, d));
}

function parseDelimitedLine(line: string, delimiter: "," | "\t"): string[] {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];

        if (ch === '"') {
            // escaped quote
            if (inQuotes && line[i + 1] === '"') {
                cur += '"';
                i++;
                continue;
            }
            inQuotes = !inQuotes;
            continue;
        }

        if (!inQuotes && ch === delimiter) {
            out.push(cur);
            cur = "";
            continue;
        }

        cur += ch;
    }

    out.push(cur);
    return out.map((x) => x.trim());
}
