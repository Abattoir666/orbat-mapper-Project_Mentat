import type { UnitUpdate } from "@/types/internalModels";
import type { DoctrinalToeTemplate } from "./doctrinalTypes";

export function buildApplyToeBaselineUpdate(template: DoctrinalToeTemplate): UnitUpdate {
    return {
        toeBaseline: {
            personnel: template.personnel.map((p) => ({
                name: p.name,
                count: Number(p.count) || 0,
                description: p.description,
                // doctrinal authorized baseline should not carry onHand
                onHand: undefined,
            })),
            templateKey: template.key,
            source: template.source,
        },
    };
}
