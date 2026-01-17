import * as signalR from "@microsoft/signalr";
import { applyPatch } from "fast-json-patch";

export type ScenarioPatch = {
    scenarioId: string;
    rev: number;
    patch: { op: string; path: string; value?: any }[];
};

export class ScenarioSync {
    private conn: signalR.HubConnection;
    public rev = 0;

    constructor(private serverBaseUrl: string) {
        this.conn = new signalR.HubConnectionBuilder()
            .withUrl(`${serverBaseUrl}/hubs/scenario`, {
                transport: signalR.HttpTransportType.WebSockets,
                skipNegotiation: true
            })
            .withAutomaticReconnect()
            .build();
    }

    onPatch(cb: (p: ScenarioPatch) => void) { this.conn.on("Patch", cb); }
    onAck(cb: (a: any) => void) { this.conn.on("Ack", cb); }

    async start() { await this.conn.start(); }
    async joinScenario(scenarioId: string) { await this.conn.invoke("JoinScenario", scenarioId); }

    async submitMoveUnit(scenarioId: string, clientId: string, sessionId: string, unitId: string, lat: number, lon: number, altM?: number) {
        const env = {
            scenarioId,
            opId: crypto.randomUUID(),
            clientId,
            sessionId,
            baseRev: this.rev,
            sentAtMs: Date.now(),
            op: { type: "MoveUnit", unitId, lat, lon, altM }
        };
        await this.conn.invoke("SubmitOp", env);
    }

    applyPatchToState(state: any, patchMsg: ScenarioPatch) {
        // MVP: assume ordered. Later add buffering/resync.
        applyPatch(state, patchMsg.patch, false);
        this.rev = patchMsg.rev;
    }
}
