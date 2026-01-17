import * as signalR from "@microsoft/signalr";
import type { EntityId } from "@/types/base";
import type { Position } from "@/types/scenarioGeoModels";

export type MoveUnitMessage = {
    scenarioId: string; // room id from server (sessionId)
    opId: string;
    clientId: string;
    sessionId: string; // per-tab client session id
    unitId: EntityId;
    t: number;
    location: Position | null;
};

type JsonPatchOp = { op: string; path: string; value?: any };

type ScenarioPatch = {
    scenarioId: string; // room id from server (sessionId)
    rev: number;
    causedByClientId?: string | null;
    causedByOpId?: string | null;
    appliedAtMs: number;
    patch: JsonPatchOp[];
};

type OpAck = {
    scenarioId: string; // room id from server (sessionId)
    opId: string;
    accepted: boolean;
    rev?: number | null;
    reason?: string | null;
    serverTimeMs: number;
    latestRev: number;
};

export type PresenceHello = {
    scenarioId: string; // room id from server (sessionId)
    clientId: string;
    sessionId: string; // per-tab client session id
    displayName: string;
    color?: string | null;
    device?: string | null;
    sentAtMs: number;
};

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

type ScenarioCollabOptions = {
    serverBaseUrl: string;

    /**
     * Room key used for routing on the server.
     * For the new lobby system, this MUST be the sessionId returned by POST /api/sessions.
     */
    roomId: string;

    /** Optional: your local scenario content id (not used for routing). */
    scenarioContentId?: string;

    forceWebSockets?: boolean;
};

function normalizeBaseUrl(url: string): string {
    return url.replace(/\/+$/, "");
}

function getOrCreateStableId(storage: Storage, key: string): string {
    const existing = storage.getItem(key);
    if (existing) return existing;
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    storage.setItem(key, id);
    return id;
}

function pathToUnitIdIfUnitState(path: string): string | null {
    // Expect: /units/<unitId>/state
    if (!path || !path.startsWith("/units/")) return null;
    const parts = path.split("/").filter(Boolean); // ["units", "<unitId>", "state"]
    if (parts.length !== 3) return null;
    if (parts[0] !== "units" || parts[2] !== "state") return null;
    return parts[1] ?? null;
}

function toPositionMaybe(arr: any): Position | null {
    if (arr == null) return null;
    if (!Array.isArray(arr)) return null;
    if (arr.length === 2 && typeof arr[0] === "number" && typeof arr[1] === "number")
        return [arr[0], arr[1]];
    if (
        arr.length === 3 &&
        typeof arr[0] === "number" &&
        typeof arr[1] === "number" &&
        typeof arr[2] === "number"
    )
        return [arr[0], arr[1], arr[2]];
    return null;
}

export class ScenarioCollab {
    public readonly clientId: string;
    public readonly sessionId: string; // per-tab client session id (sessionStorage)

    private readonly roomId: string;
    private readonly scenarioContentId?: string;

    private readonly conn: signalR.HubConnection;

    public latestRev = 0;

    private readonly recentOps = new Map<string, number>();
    private readonly recentOpTtlMs = 30_000;

    constructor(opts: ScenarioCollabOptions) {
        const baseUrl = normalizeBaseUrl(opts.serverBaseUrl);

        this.roomId = opts.roomId;
        this.scenarioContentId = opts.scenarioContentId;

        this.clientId = getOrCreateStableId(window.localStorage, "mentat_collab_client_id");
        this.sessionId = getOrCreateStableId(window.sessionStorage, "mentat_collab_session_id");

        const hubUrl = `${baseUrl}/hubs/scenario`;

        // IMPORTANT: accessTokenFactory must be on the connection options
        const urlOptions: signalR.IHttpConnectionOptions = {
            accessTokenFactory: () => window.localStorage.getItem("mentat_auth_jwt") ?? "",
        };

        if (opts.forceWebSockets ?? true) {
            urlOptions.transport = signalR.HttpTransportType.WebSockets;
            urlOptions.skipNegotiation = true;
        }

        this.conn = new signalR.HubConnectionBuilder()
            .withUrl(hubUrl, urlOptions)
            .withAutomaticReconnect()
            .build();
    }

    /**
     * Connect and join the routing group.
     * Prefer JoinSession(roomId); fall back to JoinScenario(roomId) for older servers.
     */
    async startAndJoin(): Promise<void> {
        await this.conn.start();

        try {
            await this.conn.invoke("JoinSession", this.roomId);
        } catch {
            // Back-compat: older server build may not have JoinSession
            await this.conn.invoke("JoinScenario", this.roomId);
        }
    }

    stop(): Promise<void> {
        return this.conn.stop();
    }

    onAck(cb: (ack: OpAck) => void): void {
        this.conn.on("Ack", (ack: OpAck) => {
            this.latestRev = Math.max(this.latestRev, ack.latestRev ?? 0);
            cb(ack);
        });
    }

    onPatch(cb: (patch: ScenarioPatch) => void): void {
        this.conn.on("Patch", (p: ScenarioPatch) => {
            this.latestRev = Math.max(this.latestRev, p.rev ?? 0);
            cb(p);
        });
    }

    onMoveUnitApplied(cb: (msg: MoveUnitMessage) => void): void {
        this.conn.on("Patch", (p: ScenarioPatch) => {
            this.latestRev = Math.max(this.latestRev, p.rev ?? 0);

            // Ignore our own echo
            const causedByClientId = p.causedByClientId ?? null;
            if (causedByClientId && causedByClientId === this.clientId) return;

            const causedByOpId = p.causedByOpId ?? null;
            if (causedByOpId && this.isRecentLocalOp(causedByOpId)) return;

            for (const op of p.patch ?? []) {
                if (!op || op.op !== "replace") continue;

                const unitId = pathToUnitIdIfUnitState(op.path);
                if (!unitId) continue;

                const t = Number(op.value?.t);
                if (!Number.isFinite(t)) continue;

                const loc = toPositionMaybe(op.value?.location);

                cb({
                    scenarioId: p.scenarioId, // room id
                    opId: (p.causedByOpId ?? "") as any,
                    clientId: (p.causedByClientId ?? "") as any,
                    sessionId: "", // server patch doesn’t include per-tab session; presence does
                    unitId: unitId as any,
                    t,
                    location: loc,
                });
            }
        });
    }

    async sendMoveUnit(unitId: EntityId, t: number, location: Position | null): Promise<string> {
        const opId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
        const sentAtMs = Date.now();

        const env = {
            // IMPORTANT: scenarioId is the ROOM KEY on the server (sessionId)
            scenarioId: this.roomId,
            opId,
            clientId: this.clientId,
            sessionId: this.sessionId,
            baseRev: this.latestRev ?? 0,
            sentAtMs,
            op: {
                type: "MoveUnit",
                unitId: String(unitId),
                t: Number(t),
                location: location ? Array.from(location as any) : null,
            },
            // Optional metadata you can use later (doesn't affect server)
            scenarioContentId: this.scenarioContentId ?? null,
        };

        this.noteLocalOp(opId);
        await this.conn.invoke("SubmitOp", env);
        return opId;
    }

    // Presence
    onPresenceSnapshot(cb: (snap: PresenceSnapshot) => void): void {
        this.conn.on("PresenceSnapshot", cb);
    }

    onPresenceChanged(cb: (chg: PresenceChanged) => void): void {
        this.conn.on("PresenceChanged", cb);
    }

    async getPresence(): Promise<PresenceSnapshot> {
        return await this.conn.invoke("GetPresence", this.roomId);
    }

    async setPresence(displayName: string, color?: string | null, device?: string | null): Promise<void> {
        const hello: PresenceHello = {
            scenarioId: this.roomId, // room key
            clientId: this.clientId,
            sessionId: this.sessionId,
            displayName,
            color: color ?? null,
            device: device ?? null,
            sentAtMs: Date.now(),
        };
        await this.conn.invoke("SetPresence", hello);
    }

    isRecentLocalOp(opId: string): boolean {
        this.cleanupRecentOps();
        return this.recentOps.has(opId);
    }

    private noteLocalOp(opId: string) {
        this.cleanupRecentOps();
        this.recentOps.set(opId, Date.now());
    }

    private cleanupRecentOps() {
        const now = Date.now();
        for (const [id, ts] of this.recentOps) {
            if (now - ts > this.recentOpTtlMs) this.recentOps.delete(id);
        }
    }
}
