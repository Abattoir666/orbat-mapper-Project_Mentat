// src/modules/scenarioeditor/ExtendedScenarioEvents/parseExternalMedia.ts
// ASCII-only. No BOM.

export type ExternalMediaProvider =
    | "image"
    | "video"
    | "youtube"
    | "twitter"
    | "telegram"
    | "unknown";

export type ExternalMediaKind =
    | "image"
    | "video-file"
    | "youtube"
    | "tweet"
    | "telegram"
    | "unknown";

export interface ExternalMediaItem {
    kind: ExternalMediaKind;
    provider: ExternalMediaProvider;

    // Canonical URL (no "| note")
    originalUrl: string;

    // Optional description parsed from "URL | note"
    note?: string;

    // For rendering
    src?: string;      // image/video file src
    embedUrl?: string; // iframe src (ONLY for youtube)
    thumbUrl?: string; // optional thumbnail

    // Helpful derived fields
    titleHint?: string;
}

const DEBUG_MEDIA_PARSE = false;

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?.*)?$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|ogg|ogv|mov|m4v)(\?.*)?$/i;

function safeUrlParse(raw: string): URL | null {
    try {
        return new URL(raw);
    } catch {
        return null;
    }
}

// Accept "URL | note"
function splitUrlAndNote(raw: string): { url: string; note?: string } {
    const s = String(raw ?? "").trim();
    if (!s) return { url: "" };

    const idx = s.indexOf("|");
    if (idx < 0) return { url: s };

    const url = s.slice(0, idx).trim();
    const note = s.slice(idx + 1).trim();
    return { url, note: note || undefined };
}

function isLikelyImageUrl(u: URL): boolean {
    if (IMAGE_EXT_RE.test(u.pathname)) return true;

    // twitter images: https://pbs.twimg.com/media/... ?format=jpg&name=...
    if (u.hostname.toLowerCase().includes("twimg.com") && u.pathname.includes("/media/")) return true;

    const fmt = u.searchParams.get("format");
    if (fmt && /^(png|jpe?g|gif|webp|avif)$/i.test(fmt)) return true;

    return false;
}

function isLikelyVideoUrl(u: URL): boolean {
    if (VIDEO_EXT_RE.test(u.pathname)) return true;
    return false;
}

function isYouTubeHost(host: string): boolean {
    const h = host.toLowerCase();
    return h === "youtube.com" || h.endsWith(".youtube.com") || h === "youtu.be";
}

function parseYouTubeId(u: URL): string | null {
    const host = u.hostname.toLowerCase();

    // youtu.be/<id>
    if (host === "youtu.be") {
        const id = (u.pathname || "").replace("/", "").trim();
        return id || null;
    }

    // youtube.com/watch?v=<id>
    const v = u.searchParams.get("v");
    if (v) return v;

    // youtube.com/shorts/<id>
    const m1 = (u.pathname || "").match(/\/shorts\/([^\/\?]+)/i);
    if (m1 && m1[1]) return m1[1];

    // youtube.com/embed/<id>
    const m2 = (u.pathname || "").match(/\/embed\/([^\/\?]+)/i);
    if (m2 && m2[1]) return m2[1];

    return null;
}

function isTwitterHost(host: string): boolean {
    const h = host.toLowerCase();
    return h === "twitter.com" || h.endsWith(".twitter.com") || h === "x.com" || h.endsWith(".x.com");
}

function isTelegramHost(host: string): boolean {
    const h = host.toLowerCase();
    return h === "t.me" || h.endsWith(".t.me") || h === "telegram.me" || h.endsWith(".telegram.me");
}

function parseExternalMediaUrl(rawUrl: string): ExternalMediaItem | null {
    const raw = String(rawUrl ?? "").trim();
    if (!raw) return null;

    const { url, note } = splitUrlAndNote(raw);
    if (!url) return null;

    if (!/^https?:\/\//i.test(url)) return null;

    const u = safeUrlParse(url);
    if (!u) return null;

    // 1) Direct image
    if (isLikelyImageUrl(u)) {
        return {
            kind: "image",
            provider: "image",
            originalUrl: url,
            note,
            src: url,
            titleHint: "Image",
        };
    }

    // 2) Direct video file
    if (isLikelyVideoUrl(u)) {
        return {
            kind: "video-file",
            provider: "video",
            originalUrl: url,
            note,
            src: url,
            titleHint: "Video",
        };
    }

    // 3) YouTube (ONLY embeddable provider)
    if (isYouTubeHost(u.hostname)) {
        const id = parseYouTubeId(u);
        if (id) {
            return {
                kind: "youtube",
                provider: "youtube",
                originalUrl: url,
                note,
                embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`,
                titleHint: "YouTube",
            };
        }
        return {
            kind: "unknown",
            provider: "youtube",
            originalUrl: url,
            note,
            titleHint: "YouTube link",
        };
    }

    // 4) Twitter/X (NOT embeddable here - return as link card)
    if (isTwitterHost(u.hostname)) {
        return {
            kind: "tweet",
            provider: "twitter",
            originalUrl: url,
            note,
            titleHint: "Tweet",
        };
    }

    // 5) Telegram (NOT embeddable here - return as link card)
    if (isTelegramHost(u.hostname)) {
        return {
            kind: "telegram",
            provider: "telegram",
            originalUrl: url,
            note,
            titleHint: "Telegram",
        };
    }

    // 6) Generic link
    return {
        kind: "unknown",
        provider: "unknown",
        originalUrl: url,
        note,
        titleHint: "Link",
    };
}

export function parseExternalMediaUrls(urls: string[]): ExternalMediaItem[] {
    const list = Array.isArray(urls) ? urls : [];
    const items: ExternalMediaItem[] = [];
    const seen = new Set<string>();

    for (const entry of list) {
        const raw = String(entry ?? "").trim();
        if (!raw) continue;

        const item = parseExternalMediaUrl(raw);
        if (!item) continue;

        const key = item.originalUrl;
        if (seen.has(key)) continue;
        seen.add(key);

        items.push(item);
    }

    if (DEBUG_MEDIA_PARSE) {
        // eslint-disable-next-line no-console
        console.log("[ExternalMedia] parsed items:", items);
    }

    return items;
}
