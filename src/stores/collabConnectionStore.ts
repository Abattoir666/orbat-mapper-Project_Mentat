import { defineStore } from "pinia";
import { ScenarioCollab } from "@/net/scenarioCollab";
import { useCollabPresenceStore } from "./collabPresenceStore";

type PublicRoom = {
    sessionId: string;
    scenarioId: string;
    isPublic: boolean;
    title?: string | null;
    hostClientId: string;
    createdAtMs: number;
};

type Profile = {
    displayName: string;
    color?: string | null;
    device?: string | null;
};

function normalizeBaseUrl(url: string): string {
    return (url ?? "").replace(/\/+$/, "");
}

function getOrCreateStableId(storage: Storage, key: string): string {
    const existing = storage.getItem(key);
    if (existing) return existing;
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    storage.setItem(key, id);
    return id;
}

const PROFILE_KEY = "mentat_collab_profile";
const SERVER_URL_KEY = "mentat_collab_server_url";

function loadProfile(): Profile {
    try {
        const raw = window.localStorage.getItem(PROFILE_KEY);
        if (!raw) return { displayName: "Anonymous", color: null, device: null };
        const p = JSON.parse(raw);
        return {
            displayName: String(p.displayName || "Anonymous"),
            color: p.color ?? null,
            device: p.device ?? null,
        };
    } catch {
        return { displayName: "Anonymous", color: null, device: null };
    }
}

function saveProfile(p: Profile) {
    try {
        window.localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    } catch {
        // ignore
    }
}

function loadServerBaseUrlFromStorage(): string | null {
    try {
        const raw = window.localStorage.getItem(SERVER_URL_KEY);
        return raw ? normalizeBaseUrl(raw) : null;
    } catch {
        return null;
    }
}

function saveServerBaseUrlToStorage(url: string) {
    try {
        window.localStorage.setItem(SERVER_URL_KEY, normalizeBaseUrl(url));
    } catch {
        // ignore
    }
}

function resolveInitialServerBaseUrl(): string {
    // 1) allow runtime override stored in localStorage
    const stored = loadServerBaseUrlFromStorage();
    if (stored) return stored;

    // 2) fall back to build-time env
    const envUrl = normalizeBaseUrl((import.meta as any).env?.VITE_COLLAB_SERVER_URL ?? "");
    return envUrl;
}

export const useCollabConnectionStore = defineStore("collabConnection", {
    state: () => ({
        enabled: false,
        status: "idle" as "idle" | "connecting" | "connected" | "error",
        lastError: null as string | null,

        // room id == server sessionId
        roomId: null as string | null,

        // optional metadata (scenario content id in ORBAT)
        scenarioContentId: null as string | null,

        // server
        serverBaseUrl: resolveInitialServerBaseUrl(),

        // collab instance
        collab: null as ScenarioCollab | null,

        // discovery
        publicRooms: [] as PublicRoom[],

        // profile
        profile: loadProfile(),
    }),

    actions: {
        setServerBaseUrl(url: string) {
            const norm = normalizeBaseUrl(url);
            this.serverBaseUrl = norm;
            saveServerBaseUrlToStorage(norm);
        },

        async refreshPublicRooms(): Promise<void> {
            if (!this.serverBaseUrl) return;

            try {
                const res = await fetch(`${this.serverBaseUrl}/api/sessions/public?limit=50`);
                if (!res.ok) throw new Error(`GET /api/sessions/public failed (${res.status})`);
                this.publicRooms = await res.json();
                this.lastError = null;
            } catch (e: any) {
                // do not hard-fail UI
                this.publicRooms = [];
                this.lastError = String(e?.message ?? e);
            }
        },

        async hostSession(args: { scenarioId: string; isPublic: boolean; title?: string | null }): Promise<void> {
            if (!this.serverBaseUrl) throw new Error("VITE_COLLAB_SERVER_URL not set (and no runtime override set)");

            const scenarioId = String(args.scenarioId ?? "").trim();
            if (!scenarioId) throw new Error("ScenarioId is required to host a session");

            const hostClientId = getOrCreateStableId(window.localStorage, "mentat_collab_client_id");

            const res = await fetch(`${this.serverBaseUrl}/api/sessions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    scenarioId,
                    isPublic: !!args.isPublic,
                    title: args.title ?? null,
                    hostClientId,
                }),
            });

            if (!res.ok) throw new Error(`POST /api/sessions failed (${res.status})`);
            const data = await res.json();
            const roomId = String(data.sessionId).trim();
            if (!roomId) throw new Error("Server returned empty sessionId");

            await this.connectToRoom(roomId, scenarioId);
        },

        async joinSession(roomId: string): Promise<void> {
            if (!this.serverBaseUrl) throw new Error("VITE_COLLAB_SERVER_URL not set (and no runtime override set)");

            const rid = String(roomId).trim();
            if (!rid) throw new Error("RoomId is required");

            // Optional: look up scenarioId for display/debug
            let scenarioId: string | null = null;
            try {
                const res = await fetch(`${this.serverBaseUrl}/api/sessions/${encodeURIComponent(rid)}`);
                if (res.ok) {
                    const info = await res.json();
                    scenarioId = info?.scenarioId != null ? String(info.scenarioId) : null;
                }
            } catch {
                // ignore
            }

            await this.connectToRoom(rid, scenarioId);
        },

        async connectToRoom(roomId: string, scenarioContentId: string | null): Promise<void> {
            const rid = String(roomId ?? "").trim();
            if (!rid) throw new Error("RoomId is required");

            this.enabled = true;
            this.status = "connecting";
            this.lastError = null;

            this.roomId = rid;
            this.scenarioContentId = scenarioContentId;

            const presence = useCollabPresenceStore();

            // Clear presence immediately so the top-bar doesn't show stale users while connecting
            presence.clear();

            // disconnect previous
            if (this.collab) {
                try {
                    await this.collab.stop();
                } catch {
                    /* ignore */
                }
                this.collab = null;
            }

            const collab = new ScenarioCollab({
                serverBaseUrl: this.serverBaseUrl,
                roomId: rid,
                scenarioContentId: scenarioContentId ?? undefined,
            });

            // Wire presence
            collab.onPresenceSnapshot((snap: any) => presence.applySnapshot(snap));
            collab.onPresenceChanged((chg: any) => presence.applyChange(chg));

            try {
                await collab.startAndJoin();
                this.collab = collab;
                this.status = "connected";
                this.lastError = null;

                // Push our stored profile to the room automatically on connect
                await this.updateProfileAndPresence(this.profile);
            } catch (e: any) {
                this.status = "error";
                this.lastError = String(e?.message ?? e);
                this.collab = null;
                throw e;
            }
        },

        async disconnect(): Promise<void> {
            const presence = useCollabPresenceStore();
            presence.clear();

            if (this.collab) {
                try {
                    await this.collab.stop();
                } catch {
                    /* ignore */
                }
            }

            this.collab = null;
            this.enabled = false;
            this.status = "idle";
            this.roomId = null;
            this.scenarioContentId = null;
            this.lastError = null;
        },

        async updateProfileAndPresence(p: Profile): Promise<void> {
            const next: Profile = {
                displayName: String(p.displayName || "Anonymous"),
                color: p.color ?? null,
                device: p.device ?? null,
            };

            this.profile = next;
            saveProfile(next);

            if (this.collab) {
                await this.collab.setPresence(next.displayName, next.color ?? null, next.device ?? null);
            }
        },
    },
});
