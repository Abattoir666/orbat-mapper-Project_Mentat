// src/modules/scenarioeditor/doctrinalToe/targetPicker/openDoctrinalToeTargetPickerPopout.ts
import { createApp, h, type App } from "vue";
import DoctrinalToeTargetPickerPopout from "./DoctrinalToeTargetPickerPopout.vue";
import type { EntityId } from "@/types/base";
import type { DoctrinalUnitIndexRow } from "./doctrinalTargetTypes";

let popoutWindow: Window | null = null;
let popoutApp: App | null = null;

function copyStyles(source: Document, target: Document) {
    const nodes = source.querySelectorAll('link[rel="stylesheet"], style');
    nodes.forEach((n) => target.head.appendChild(n.cloneNode(true)));
}

function ensureHead(targetDoc: Document) {
    if (!targetDoc.head) {
        const head = targetDoc.createElement("head");
        targetDoc.documentElement.prepend(head);
    }
}

export function openDoctrinalToeTargetPickerPopout(args: {
    title?: string;
    units: DoctrinalUnitIndexRow[];
    initialSelectedIds?: EntityId[];
    contextSubtreeIds?: EntityId[];
    onConfirm: (unitIds: EntityId[]) => void;
}) {
    // Reuse existing popout if open
    if (!popoutWindow || popoutWindow.closed) {
        popoutWindow = window.open("", "DoctrinalToeTargetPicker", "width=1050,height=850");
    }
    if (!popoutWindow) return;

    const doc = popoutWindow.document;
    doc.title = args.title ?? "Select target units";

    doc.body.innerHTML = `<div id="doctrinal-toe-target-picker-root"></div>`;
    ensureHead(doc);
    copyStyles(document, doc);

    const mountEl = doc.getElementById("doctrinal-toe-target-picker-root");
    if (!mountEl) return;

    try {
        popoutApp?.unmount();
    } catch {
        /* ignore */
    }

    popoutApp = createApp({
        render: () =>
            h(DoctrinalToeTargetPickerPopout, {
                title: args.title,
                units: args.units,
                initialSelectedIds: args.initialSelectedIds,
                contextSubtreeIds: args.contextSubtreeIds,
                onConfirm: (unitIds: EntityId[]) => {
                    args.onConfirm(unitIds);
                    try {
                        popoutApp?.unmount();
                    } catch { /* ignore */ }
                    popoutApp = null;
                    popoutWindow?.close();
                    popoutWindow = null;
                },
                onCancel: () => {
                    try {
                        popoutApp?.unmount();
                    } catch { /* ignore */ }
                    popoutApp = null;
                    popoutWindow?.close();
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
