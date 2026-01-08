import type { Unit } from "@/types/scenarioModels";
import type { DoctrinalToeTemplate } from "./doctrinalTypes";

export type DoctrinalMatchResult = {
    template: DoctrinalToeTemplate;
    score: number;
    reasons: string[];
};

function safeToLower(s: unknown): string {
    return typeof s === "string" ? s.toLowerCase() : "";
}

function getUnitTags(unit: Unit): string[] {
    // Future-friendly: accept multiple likely locations without enforcing schema today
    const anyUnit = unit as any;
    const tags = anyUnit?.tags ?? anyUnit?.properties?.tags ?? [];
    if (Array.isArray(tags)) return tags.filter((t) => typeof t === "string");
    if (typeof tags === "string") return [tags];
    return [];
}

export function scoreTemplateMatch(unit: Unit, template: DoctrinalToeTemplate): DoctrinalMatchResult {
    const reasons: string[] = [];
    let score = 0;

    const sidc = unit.sidc ?? "";
    const unitName = unit.name ?? "";
    const unitNameLc = safeToLower(unitName);

    const sidcPrefixes = template.match?.sidcPrefix ?? [];
    if (sidcPrefixes.length > 0) {
        const hit = sidcPrefixes.find((p) => typeof p === "string" && p.length > 0 && sidc.startsWith(p));
        if (hit) {
            score += 100;
            reasons.push(`sidcPrefix:${hit}`);
        } else {
            // If template declares sidcPrefix and none match, treat as a hard miss
            return { template, score: -Infinity, reasons: ["sidcPrefix:miss"] };
        }
    }

    const nameRegexes = template.match?.nameRegex ?? [];
    for (const rx of nameRegexes) {
        try {
            const re = new RegExp(rx, "i");
            if (re.test(unitName)) {
                score += 25;
                reasons.push(`nameRegex:${rx}`);
                break;
            }
        } catch {
            // ignore invalid regex strings in library
        }
    }

    const needTags = template.match?.tags ?? [];
    if (needTags.length > 0) {
        const unitTagsLc = getUnitTags(unit).map((t) => t.toLowerCase());
        const hits = needTags.filter((t) => unitTagsLc.includes(safeToLower(t)));
        if (hits.length > 0) {
            score += 5 * hits.length;
            reasons.push(`tags:${hits.join(",")}`);
        }
    }

    // Slight nudge if the unit name contains the template name (helps manual naming conventions)
    const templateNameLc = safeToLower(template.name);
    if (templateNameLc && unitNameLc.includes(templateNameLc)) {
        score += 3;
        reasons.push("nameContainsTemplateName");
    }

    return { template, score, reasons };
}

export function matchTemplateForUnit(
    unit: Unit,
    templates: DoctrinalToeTemplate[],
): DoctrinalToeTemplate | null {
    const ranked = templates
        .map((t) => scoreTemplateMatch(unit, t))
        .filter((r) => Number.isFinite(r.score) && r.score > -Infinity)
        .sort((a, b) => b.score - a.score);

    if (ranked.length === 0) return null;

    // If top is tied, return null (forces user choice)
    if (ranked.length > 1 && ranked[0].score === ranked[1].score) return null;

    return ranked[0].template;
}

export function rankTemplatesForUnit(unit: Unit, templates: DoctrinalToeTemplate[]): DoctrinalMatchResult[] {
    return templates
        .map((t) => scoreTemplateMatch(unit, t))
        .filter((r) => Number.isFinite(r.score) && r.score > -Infinity)
        .sort((a, b) => b.score - a.score);
}
