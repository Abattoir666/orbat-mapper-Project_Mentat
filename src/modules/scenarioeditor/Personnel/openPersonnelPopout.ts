import { createApp, h, type App } from "vue";
import PersonnelSpreadsheetPopout from "./PersonnelSpreadsheetPopout.vue";
import type { PersonnelRow } from "./personnelTypes";

let popoutWindow: Window | null = null;
let popoutApp: App | null = null;

function copyStyles(source: Document, target: Document) {
    // Copy stylesheets + style tags so Tailwind/etc works in the new window.
    const nodes = source.querySelectorAll('link[rel="stylesheet"], style');
    nodes.forEach((n) => target.head.appendChild(n.cloneNode(true)));
}

function ensureHead(targetDoc: Document) {
    if (!targetDoc.head) {
        const head = targetDoc.createElement("head");
        targetDoc.documentElement.insertBefore(head, targetDoc.body);
    }
}

export function openPersonnelPopout(args: {
    title: string;
    initialRows: PersonnelRow[];
    isLocked: boolean;
    onApply: (rows: PersonnelRow[]) => void;
    onSave: (rows: PersonnelRow[]) => void;
}) {
    // Reuse existing window if it’s already open
    if (popoutWindow && !popoutWindow.closed) {
        popoutWindow.focus();
        return;
    }

    popoutWindow = window.open(
        "",
        "PersonnelSpreadsheetPopout",
        "width=1100,height=750,noopener=false",
    );

    if (!popoutWindow) return;

    // Basic document scaffold
    popoutWindow.document.open();
    popoutWindow.document.write("<!doctype html><html><body><div id='app'></div></body></html>");
    popoutWindow.document.close();

    ensureHead(popoutWindow.document);

    // Title + styling
    popoutWindow.document.title = args.title;
    copyStyles(document, popoutWindow.document);

    // Mount Vue into the new window
    const mountEl = popoutWindow.document.getElementById("app");
    if (!mountEl) return;

    popoutApp = createApp({
        render: () =>
            h(PersonnelSpreadsheetPopout, {
                title: args.title,
                initialRows: args.initialRows,
                isLocked: args.isLocked,

                onApply: (rows: PersonnelRow[]) => args.onApply(rows),
                onSave: (rows: PersonnelRow[]) => args.onSave(rows),
                onClose: () => {
                    try {
                        popoutApp?.unmount();
                    } catch {
                        /* ignore */
                    }
                    popoutApp = null;
                    popoutWindow?.close();
                    popoutWindow = null;
                },
            }),
    });

    popoutApp.mount(mountEl);

    // Cleanup if user closes popout manually
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
