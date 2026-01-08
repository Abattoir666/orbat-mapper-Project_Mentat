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

    // Ensure UTF-8 + viewport so text renders correctly and layout behaves.
    if (!targetDoc.querySelector('meta[charset]')) {
        const meta = targetDoc.createElement("meta");
        meta.setAttribute("charset", "utf-8");
        targetDoc.head.appendChild(meta);
    }

    if (!targetDoc.querySelector('meta[name="viewport"]')) {
        const meta = targetDoc.createElement("meta");
        meta.setAttribute("name", "viewport");
        meta.setAttribute("content", "width=device-width, initial-scale=1");
        targetDoc.head.appendChild(meta);
    }
}

function syncThemeClasses(source: Document, target: Document) {
    // Critical: preserve "dark" (and any other layout/theme classes) in the popout
    target.documentElement.className = source.documentElement.className || "";
    target.body.className = source.body.className || "";
}

export function openPersonnelPopout(args: {
    title: string;
    initialRows: PersonnelRow[];
    isLocked: boolean;
    /** Current scenario time in ms since epoch (UTC). Used to preview/edit time-sensitive statuses. */
    scenarioTimeMs: number;
    onApply: (rows: PersonnelRow[]) => void;
    onSave: (rows: PersonnelRow[]) => void;
}) {
    // Reuse existing window if it is already open
    if (popoutWindow && !popoutWindow.closed) {
        try {
            popoutWindow.focus();
        } catch {
            /* ignore */
        }
    } else {
        popoutWindow = window.open(
            "",
            "personnel-spreadsheet-popout",
            [
                "popup=yes",
                "width=1100",
                "height=760",
                "left=120",
                "top=80",
            ].join(",")
        );
    }

    if (!popoutWindow) return;

    // Basic document scaffold
    popoutWindow.document.open();
    popoutWindow.document.write(
        "<!doctype html><html><head></head><body><div id='app'></div></body></html>"
    );
    popoutWindow.document.close();

    ensureHead(popoutWindow.document);

    // Title + styling
    popoutWindow.document.title = args.title;
    copyStyles(document, popoutWindow.document);

    // Theme/classes (e.g., "dark") must be mirrored or the UI can render invisible.
    syncThemeClasses(document, popoutWindow.document);

    const mountEl = popoutWindow.document.getElementById("app");
    if (!mountEl) return;

    popoutApp = createApp({
        render() {
            return h(PersonnelSpreadsheetPopout, {
                title: args.title,
                initialRows: args.initialRows,
                isLocked: args.isLocked,
                scenarioTimeMs: args.scenarioTimeMs,
                onApply: (rows: PersonnelRow[]) => args.onApply(rows),
                onSave: (rows: PersonnelRow[]) => args.onSave(rows),
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
            });
        },
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
