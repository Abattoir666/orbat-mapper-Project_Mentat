import type { DoctrinalToeLibraryFile, DoctrinalToeTemplate } from "./doctrinalTypes";

const STORAGE_KEY = "orbat.doctrinalToeLibrary.v1";

function normalizeTemplate(t: DoctrinalToeTemplate): DoctrinalToeTemplate {
    return {
        key: String(t.key).trim(),
        name: String(t.name ?? t.key).trim(),
        match: {
            sidcPrefix: (t.match?.sidcPrefix ?? []).filter(Boolean),
            nameRegex: (t.match?.nameRegex ?? []).filter(Boolean),
            tags: (t.match?.tags ?? []).filter(Boolean),
        },
        personnel: (t.personnel ?? []).map((p) => ({
            name: String(p.name ?? "").trim(),
            count: Number(p.count) || 0,
            description: p.description ? String(p.description) : undefined,
            onHand: undefined,
        })),
        source: t.source ? String(t.source) : undefined,
    };
}

export function loadDoctrinalToeLibrary(): DoctrinalToeLibraryFile {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { version: 1, templates: [] };

        const parsed = JSON.parse(raw) as Partial<DoctrinalToeLibraryFile>;
        const templates = Array.isArray(parsed.templates) ? parsed.templates : [];
        return { version: 1, templates: templates.map(normalizeTemplate) };
    } catch {
        return { version: 1, templates: [] };
    }
}

export function saveDoctrinalToeLibrary(file: DoctrinalToeLibraryFile) {
    const normalized: DoctrinalToeLibraryFile = {
        version: 1,
        templates: (file.templates ?? []).map(normalizeTemplate),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}

export function getDoctrinalTemplates(): DoctrinalToeTemplate[] {
    return loadDoctrinalToeLibrary().templates;
}

export function upsertDoctrinalTemplates(incoming: DoctrinalToeTemplate[]) {
    const current = loadDoctrinalToeLibrary();
    const map = new Map<string, DoctrinalToeTemplate>();

    for (const t of current.templates) map.set(t.key, t);
    for (const t of incoming) map.set(normalizeTemplate(t).key, normalizeTemplate(t));

    saveDoctrinalToeLibrary({ version: 1, templates: [...map.values()] });
}

export function removeDoctrinalTemplate(key: string) {
    const current = loadDoctrinalToeLibrary();
    saveDoctrinalToeLibrary({
        version: 1,
        templates: current.templates.filter((t) => t.key !== key),
    });
}

export function clearDoctrinalToeLibrary() {
    localStorage.removeItem(STORAGE_KEY);
}
