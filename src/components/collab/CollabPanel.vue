<script setup lang="ts">
    import { computed, onMounted, ref } from "vue";
    import { useCollabConnectionStore } from "@/stores/collabConnectionStore";
    import { useCollabPresenceStore } from "@/stores/collabPresenceStore";

    const props = defineProps<{
        scenarioContentId: string; // active scenario id from ORBAT
    }>();

    const emit = defineEmits<{
        (e: "close"): void;
    }>();

    const conn = useCollabConnectionStore();
    const presence = useCollabPresenceStore();

    const joinRoomId = ref("");
    const hostTitle = ref("");
    const hostPublic = ref(true);

    const displayName = ref(conn.profile.displayName);
    const color = ref(conn.profile.color ?? "");
    const device = ref(conn.profile.device ?? "");

    const userCount = computed(() => presence.onlineList.length);

    // NEW: guard + UI state
    const scenarioIdTrimmed = computed(() => (props.scenarioContentId ?? "").trim());
    const canHost = computed(() => scenarioIdTrimmed.value.length > 0);
    const localError = ref<string | null>(null);

    async function refreshRooms() {
        localError.value = null;
        await conn.refreshPublicRooms();
    }

    async function host() {
        localError.value = null;

        // Guard: cannot host unless a scenario is loaded
        if (!canHost.value) {
            localError.value = "Load a scenario first (no scenario id is available yet), then host a session.";
            return;
        }

        await conn.hostSession({
            scenarioId: scenarioIdTrimmed.value,
            isPublic: hostPublic.value,
            title: hostTitle.value || null,
        });

        // Push presence right away
        await conn.updateProfileAndPresence({
            displayName: displayName.value,
            color: color.value || null,
            device: device.value || null,
        });
    }

    async function join() {
        localError.value = null;

        const rid = joinRoomId.value.trim();
        if (!rid) return;

        await conn.joinSession(rid);

        await conn.updateProfileAndPresence({
            displayName: displayName.value,
            color: color.value || null,
            device: device.value || null,
        });
    }

    async function disconnect() {
        localError.value = null;
        await conn.disconnect();
    }

    async function saveProfile() {
        localError.value = null;
        await conn.updateProfileAndPresence({
            displayName: displayName.value,
            color: color.value || null,
            device: device.value || null,
        });
    }

    async function copyRoom() {
        if (!conn.roomId) return;
        try {
            await navigator.clipboard.writeText(conn.roomId);
        } catch {
            // ignore; clipboard can fail depending on permissions
        }
    }

    onMounted(() => {
        refreshRooms();
    });
</script>

<template>
    <div class="w-[420px] max-w-[92vw] rounded-xl bg-gray-900/95 text-gray-100 shadow-xl ring-1 ring-gray-700">
        <div class="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <div class="text-sm font-semibold">
                Collaboration
                <span class="ml-2 text-xs font-normal text-gray-300">
                    <span v-if="conn.enabled && conn.status === 'connected'">Connected · {{ userCount }} online</span>
                    <span v-else-if="conn.enabled && conn.status === 'connecting'">Connecting…</span>
                    <span v-else-if="conn.enabled && conn.status === 'error'">Error</span>
                    <span v-else>Solo</span>
                </span>
            </div>

            <button class="text-gray-300 hover:text-gray-100 text-sm" @click="emit('close')">✕</button>
        </div>

        <!-- Errors -->
        <div v-if="localError" class="px-4 py-2 text-xs text-red-300 border-b border-gray-800">
            {{ localError }}
        </div>

        <!-- Current session -->
        <div class="px-4 py-3 border-b border-gray-800">
            <div class="text-xs text-gray-300">Current room</div>
            <div class="mt-1 flex items-center gap-2">
                <code class="text-xs bg-gray-800/80 px-2 py-1 rounded w-full overflow-hidden text-ellipsis">
                    {{ conn.roomId ?? "—" }}
                </code>
                <button class="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-50"
                        @click="copyRoom"
                        :disabled="!conn.roomId">
                    Copy
                </button>
                <button class="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-50"
                        @click="disconnect"
                        :disabled="!conn.enabled">
                    Leave
                </button>
            </div>
            <div v-if="conn.lastError" class="mt-2 text-xs text-red-300">
                {{ conn.lastError }}
            </div>
        </div>

        <!-- Profile -->
        <div class="px-4 py-3 border-b border-gray-800">
            <div class="text-sm font-semibold">Profile</div>
            <div class="mt-2 grid grid-cols-2 gap-2">
                <input v-model="displayName"
                       class="col-span-2 rounded bg-gray-800 px-2 py-1 text-sm outline-none ring-1 ring-gray-700 focus:ring-gray-500"
                       placeholder="Display name (e.g., James)" />
                <input v-model="color"
                       class="rounded bg-gray-800 px-2 py-1 text-sm outline-none ring-1 ring-gray-700 focus:ring-gray-500"
                       placeholder="Color (e.g., #66ccff)" />
                <input v-model="device"
                       class="rounded bg-gray-800 px-2 py-1 text-sm outline-none ring-1 ring-gray-700 focus:ring-gray-500"
                       placeholder="Device (e.g., Desktop)" />
            </div>
            <button class="mt-2 w-full rounded bg-gray-800 hover:bg-gray-700 px-3 py-2 text-sm" @click="saveProfile">
                Save profile
            </button>
        </div>

        <!-- Host -->
        <div class="px-4 py-3 border-b border-gray-800">
            <div class="text-sm font-semibold">Host</div>

            <div class="mt-1 text-xs text-gray-400">
                scenario id:
                <code class="text-gray-300">{{ scenarioIdTrimmed || "—" }}</code>
            </div>

            <div v-if="!canHost" class="mt-1 text-xs text-amber-200/90">
                Load a scenario to host a session.
            </div>

            <div class="mt-2 flex items-center gap-2">
                <input v-model="hostTitle"
                       class="flex-1 rounded bg-gray-800 px-2 py-1 text-sm outline-none ring-1 ring-gray-700 focus:ring-gray-500"
                       placeholder="Optional room title" />
                <label class="flex items-center gap-2 text-xs text-gray-300 select-none">
                    <input type="checkbox" v-model="hostPublic" />
                    Public
                </label>
            </div>

            <button class="mt-2 w-full rounded bg-gray-800 hover:bg-gray-700 px-3 py-2 text-sm disabled:opacity-50 disabled:hover:bg-gray-800"
                    @click="host"
                    :disabled="!canHost">
                Create & host session
            </button>
        </div>

        <!-- Join -->
        <div class="px-4 py-3 border-b border-gray-800">
            <div class="text-sm font-semibold">Join</div>
            <div class="mt-2 flex items-center gap-2">
                <input v-model="joinRoomId"
                       class="flex-1 rounded bg-gray-800 px-2 py-1 text-sm outline-none ring-1 ring-gray-700 focus:ring-gray-500"
                       placeholder="Paste room code (sessionId)" />
                <button class="rounded bg-gray-800 hover:bg-gray-700 px-3 py-2 text-sm" @click="join">Join</button>
            </div>
        </div>

        <!-- Public rooms -->
        <div class="px-4 py-3">
            <div class="flex items-center justify-between">
                <div class="text-sm font-semibold">Public rooms</div>
                <button class="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700" @click="refreshRooms">
                    Refresh
                </button>
            </div>

            <div class="mt-2 space-y-2 max-h-[240px] overflow-auto pr-1">
                <div v-if="!conn.publicRooms.length" class="text-xs text-gray-400">No public rooms found.</div>

                <div v-for="r in conn.publicRooms" :key="r.sessionId" class="rounded bg-gray-800/60 px-3 py-2">
                    <div class="flex items-center justify-between gap-2">
                        <div class="min-w-0">
                            <div class="text-sm font-medium truncate">
                                {{ r.title || `Room ${r.sessionId.slice(0, 8)}…` }}
                            </div>
                            <div class="text-xs text-gray-300 truncate">
                                scenario: {{ r.scenarioId }} · host: {{ r.hostClientId }}
                            </div>
                        </div>
                        <button class="text-xs px-2 py-1 rounded bg-gray-900 hover:bg-gray-700" @click="joinRoomId = r.sessionId; join();">
                            Join
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
