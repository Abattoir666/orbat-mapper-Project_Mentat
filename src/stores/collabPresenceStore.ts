import { defineStore } from "pinia";

export type PresenceInfo = {
    clientId: string;
    sessionId: string;
    displayName: string;
    color?: string | null;
    device?: string | null;
    firstSeenAtMs: number;
    lastSeenAtMs: number;
};

export type PresenceSnapshot = {
    scenarioId: string; // room id (sessionId)
    users: PresenceInfo[];
};

export type PresenceChanged = {
    scenarioId: string; // room id (sessionId)
    kind: "upsert" | "remove" | string;
    user: PresenceInfo;
};

export const useCollabPresenceStore = defineStore("collabPresence", {
    state: () => ({
        roomId: null as string | null,
        onlineList: [] as PresenceInfo[],
    }),
    actions: {
        applySnapshot(snap: PresenceSnapshot) {
            this.roomId = snap.scenarioId ?? null;
            this.onlineList = Array.isArray(snap.users) ? snap.users : [];
        },
        applyChange(chg: PresenceChanged) {
            if (!chg) return;
            this.roomId = chg.scenarioId ?? this.roomId;

            const user = chg.user;
            const key = `${user.clientId}:${user.sessionId}`;

            if (chg.kind === "remove") {
                this.onlineList = this.onlineList.filter(u => `${u.clientId}:${u.sessionId}` !== key);
                return;
            }

            // upsert
            const i = this.onlineList.findIndex(u => `${u.clientId}:${u.sessionId}` === key);
            if (i >= 0) this.onlineList[i] = user;
            else this.onlineList.push(user);
        },
        clear() {
            this.roomId = null;
            this.onlineList = [];
        },
    },
});
