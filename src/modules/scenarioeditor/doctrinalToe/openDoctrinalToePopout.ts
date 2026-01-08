// src/modules/scenarioeditor/doctrinalToe/openDoctrinalToePopout.ts
import { createApp, h, type App } from "vue";
import DoctrinalToeSpreadsheetPopout from "./DoctrinalToeSpreadsheetPopout.vue";
import type { UnitPersonnel } from "@/types/scenarioModels";
import type { EntityId } from "@/types/base";
import type { DoctrinalUnitIndexRow } from "./targetPicker/doctrinalTargetTypes";

export interface OpenDoctrinalToePopoutArgs {
    title: string;
    initialRows: UnitPersonnel[];
    isLocked: boolean;

    // Optional, but required for 'apply to selected units'
    unitIndex?: DoctrinalUnitIndexRow[];
    initialTargetIds?: EntityId[];
    contextSubtreeIds?: EntityId[];

    // Optional rank suggestions for the Role/Rank column
    rankOptions?: string[];

    onApply: (rows: UnitPersonnel[], targetUnitIds: EntityId[]) => void;
    onSave: (rows: UnitPersonnel[], targetUnitIds: EntityId[]) => void;
}

let popoutWindow: Window | null = null;
let popoutApp: App | null = null;

function copyStyles(source: Document, target: Document) {
    const nodes = source.querySelectorAll('link[rel="stylesheet"], style');
    nodes.forEach((n) => target.head.appendChild(n.cloneNode(true)));
}

export function openDoctrinalToePopout(args: OpenDoctrinalToePopoutArgs) {
    const safeUnitIndex = args.unitIndex ?? [];
    const safeInitialTargets =
        (args.initialTargetIds && args.initialTargetIds.length > 0)
            ? args.initialTargetIds
            : [];

    if (popoutWindow && !popoutWindow.closed) {
        try {
            popoutWindow.focus();
        } catch {
            /* ignore */
        }
    }

    if (!popoutWindow || popoutWindow.closed) {
        popoutWindow = window.open("", "_blank", "width=1200,height=900");
        if (!popoutWindow) return;

        popoutWindow.document.open();
        popoutWindow.document.write("<!doctype html><html><body><div id='app'></div></body></html>");
        popoutWindow.document.close();

        try {
            copyStyles(document, popoutWindow.document);
        } catch {
            /* ignore */
        }
    }

    const mountEl = popoutWindow.document.getElementById("app");
    if (!mountEl) return;

    try {
        popoutApp?.unmount();
    } catch {
        /* ignore */
    }
    popoutApp = null;

    popoutApp = createApp({
        render: () =>
            h(DoctrinalToeSpreadsheetPopout, {
                title: args.title,
                initialRows: args.initialRows,
                isLocked: args.isLocked,

                unitIndex: safeUnitIndex,
                initialTargetIds: safeInitialTargets,
                contextSubtreeIds: args.contextSubtreeIds,
                rankOptions: args.rankOptions,

                onApply: (rows: UnitPersonnel[], targetUnitIds: EntityId[]) => {
                    args.onApply(rows, targetUnitIds);
                },
                onSave: (rows: UnitPersonnel[], targetUnitIds: EntityId[]) => {
                    args.onSave(rows, targetUnitIds);
                },
                onClose: () => {
                    try {
                        popoutApp?.unmount();
                    } catch {
                        /* ignore */
                    }
                    popoutApp = null;

                    try {
                        popoutWindow?.close();
                    } catch {
                        /* ignore */
                    }
                    popoutWindow = null;
                },
            }),
    });

    popoutApp.mount(mountEl);

    popoutWindow.addEventListener("beforeunload", () => {
        try {
            popoutApp?.unmount();
        } catch {
            /* ignore */
        }
        popoutApp = null;
        popoutWindow = null;
    });
}
