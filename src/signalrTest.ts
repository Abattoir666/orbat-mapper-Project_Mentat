import * as signalR from "@microsoft/signalr";

export async function runSignalRTest() {
    const conn = new signalR.HubConnectionBuilder()
        .withUrl("https://localhost:7169/hubs/scenario") // <-- CHANGE PORT
        .withAutomaticReconnect()
        .build();

    conn.on("Receive", (m: string) => console.log("Receive:", m));

    await conn.start();
    console.log("Connected");

    await conn.invoke("JoinScenario", "demo");
    await conn.invoke("SendToScenario", "demo", "Hello from MENTAT");
}
