<script setup lang="ts">
    import { computed, ref, watch, unref, onBeforeUnmount, nextTick } from "vue";
    import { injectStrict } from "@/utils";
    import { activeScenarioKey, timeModalKey } from "@/components/injects";
    import type { EntityId } from "@/types/base";

    import EditableLabel from "@/components/EditableLabel.vue";
    import { useUiStore } from "@/stores/uiStore";
    import ScenarioEventDropdownMenu from "@/modules/scenarioeditor/ScenarioEventDropdownMenu.vue";
    import { useTimeFormatStore } from "@/stores/timeFormatStore";
    import type { ScenarioEventAction } from "@/types/constants";
    import { useSelectedItems } from "@/stores/selectedStore";

    import TabWrapper from "@/components/TabWrapper.vue";
    import { TabPanel } from "@headlessui/vue";
    import EditMetaForm from "@/modules/scenarioeditor/EditMetaForm.vue";
    import { useToggle } from "@vueuse/core";
    import type { ScenarioEventUpdate } from "@/types/internalModels";

    import DescriptionItem from "@/components/DescriptionItem.vue";
    import { renderMarkdown } from "@/composables/formatting";

    import { IconCrosshairsGps, IconCalendarClock } from "@iconify-prerendered/vue-mdi";
    import IconButton from "@/components/IconButton.vue";
    import SimpleSelect from "@/components/SimpleSelect.vue";

    import type { ScenarioEventCategory } from "@/modules/scenarioeditor/ExtendedScenarioEvents/eventIconRegistry";
    import { useScenarioEventLocation } from "@/modules/scenarioeditor/ExtendedScenarioEvents/useScenarioEventLocation";
    import ScenarioEventUnitsTab from "@/modules/scenarioeditor/ExtendedScenarioEvents/ScenarioEventUnitsTab.vue";

    interface Props {
        eventId: EntityId;
    }
    const props = defineProps<Props>();

    const activeScenario = injectStrict(activeScenarioKey);
    const {
        time: { updateScenarioEvent },
        time,
        store,
    } = activeScenario;

    const { getModalTimestamp } = injectStrict(timeModalKey);

    const ui = useUiStore();
    const fmt = useTimeFormatStore();
    const { clear: clearSelected } = useSelectedItems();

    const scenarioEvent = computed(() => time.getEventById(props.eventId));

    // ---- Location picker + display ----
    const { startGetLocation, eventLocation, formattedLocation, panToEventLocation } =
        useScenarioEventLocation(props.eventId);

    const hasEventLocation = computed(() => !!unref(eventLocation));

    async function onPanToEventLocation() {
        if (!unref(eventLocation)) return;
        await (panToEventLocation as any)();
    }

    // ---- Event type / icon category ----
    const categoryOptions: { value: ScenarioEventCategory; label: string }[] = [
        { value: "generic", label: "Generic" },
        { value: "battle", label: "Battle / clash" },
        { value: "airstrike", label: "Airstrike" },
        { value: "artillery", label: "Artillery strike" },
        { value: "naval", label: "Naval action" },
        { value: "movement", label: "Movement / maneuver" },
        { value: "political", label: "Political event" },
        { value: "civilian", label: "Civilian crisis" },
        { value: "disaster", label: "Disaster" },
        { value: "intel", label: "Intelligence / detection" },
        { value: "cbrn", label: "CBRN" },
    ];

    const category = computed<ScenarioEventCategory>(() => {
        return (scenarioEvent.value?.category ?? "generic") as ScenarioEventCategory;
    });

    function updateCategory(value: ScenarioEventCategory | string) {
        updateScenarioEvent(props.eventId, { category: value as ScenarioEventCategory } as any);
    }

    // ---- Time formatting ----
    const formattedEventTime = computed(() =>
        fmt.scenarioFormatter.format(scenarioEvent.value?.startTime ?? 0),
    );

    const formattedEndTime = computed(() => {
        const end = (scenarioEvent.value as any)?.endTime as number | undefined;
        if (!end) return "Not set";
        return fmt.scenarioFormatter.format(end);
    });

    function setEndTimeToTimeline() {
        if (!scenarioEvent.value) return;
        const currentTime = (store.state as any).currentTime as number | undefined;
        const fallback = scenarioEvent.value.startTime;
        const endTime = typeof currentTime === "number" ? currentTime : fallback;
        updateScenarioEvent(props.eventId, { endTime } as any);
    }

    async function setEndTimeByCalendar() {
        if (!scenarioEvent.value) return;

        const currentEnd = (scenarioEvent.value as any).endTime ?? scenarioEvent.value.startTime;

        const newTimestamp = await getModalTimestamp(currentEnd, {
            timeZone: store.state.info.timeZone,
            title: "Set event end time",
        });

        if (newTimestamp !== undefined) {
            updateScenarioEvent(props.eventId, { endTime: newTimestamp } as any);
        }
    }

    function clearEndTime() {
        updateScenarioEvent(props.eventId, { endTime: undefined } as any);
    }

    // ---- Title / edit state ----
    const title = ref("");
    const isEditMode = ref(false);
    const toggleEditMode = useToggle(isEditMode);

    watch(
        () => props.eventId,
        () => {
            title.value = scenarioEvent.value?.title ?? "";
        },
        { immediate: true },
    );

    function updateTitle(value: string) {
        updateScenarioEvent(props.eventId, { title: value } as any);
    }

    // ---- Markdown description ----
    const hDescription = computed(() => renderMarkdown(scenarioEvent.value?.description ?? ""));

    // ---- Edit meta form ----
    const onFormSubmit = (eventUpdate: ScenarioEventUpdate) => {
        updateScenarioEvent(props.eventId, eventUpdate as any);
        toggleEditMode();
    };

    // ------------------------------------------
    // External (internet) media: URL | note lines
    // ------------------------------------------
    type ExternalItem =
        | { kind: "image-file"; url: string; src: string; description?: string }
        | { kind: "video-file"; url: string; src: string; description?: string }
        | { kind: "youtube"; url: string; embedUrl: string; description?: string }
        | { kind: "tweet"; url: string; description?: string } // oEmbed (no iframe)
        | { kind: "telegram"; url: string; embedUrl: string; description?: string }
        | { kind: "generic"; url: string; description?: string };

    const isEditExternalMediaMode = ref(false);
    const toggleEditExternalMediaMode = useToggle(isEditExternalMediaMode);

    const externalMediaText = ref<string>("");
    const showExternalMediaSaved = ref(false);
    let savedToastTimer: number | null = null;

    const selectedIndex = ref(0);
    const showSelectedDescription = ref(false);

    function splitLine(line: string): { url: string; description?: string } | null {
        const trimmed = (line ?? "").trim();
        if (!trimmed) return null;

        const parts = trimmed.split("|");
        const url = (parts[0] ?? "").trim();
        if (!url) return null;

        const description = parts.length > 1 ? parts.slice(1).join("|").trim() : undefined;
        return description ? { url, description } : { url };
    }

    function safeUrl(u: string): URL | null {
        try {
            return new URL(u);
        } catch {
            return null;
        }
    }

    function isImageFile(u: URL): boolean {
        const p = u.pathname.toLowerCase();
        return (
            p.endsWith(".jpg") ||
            p.endsWith(".jpeg") ||
            p.endsWith(".png") ||
            p.endsWith(".webp") ||
            p.endsWith(".gif")
        );
    }

    function isVideoFile(u: URL): boolean {
        const p = u.pathname.toLowerCase();
        return p.endsWith(".mp4") || p.endsWith(".webm") || p.endsWith(".mov") || p.endsWith(".m4v");
    }

    function getYouTubeId(u: URL): string | null {
        const host = u.hostname.toLowerCase();
        const path = u.pathname;

        const isYT =
            host === "youtu.be" || host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com");

        if (!isYT) return null;

        if (host === "youtu.be") {
            const id = path.replace(/^\//, "").split("/")[0];
            return id || null;
        }

        const v = u.searchParams.get("v");
        if (v) return v;

        const shorts = path.match(/^\/shorts\/([^/?#]+)/i);
        if (shorts?.[1]) return shorts[1];

        const embed = path.match(/^\/embed\/([^/?#]+)/i);
        if (embed?.[1]) return embed[1];

        const live = path.match(/^\/live\/([^/?#]+)/i);
        if (live?.[1]) return live[1];

        return null;
    }

    function makeYouTubeEmbedUrl(id: string): string {
        return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`;
    }

    function makeTelegramEmbedUrl(messageUrl: URL): string | null {
        const segs = messageUrl.pathname.split("/").filter(Boolean);
        if (segs.length < 2) return null;

        const base = `https://t.me/${segs[0]}/${segs[1]}`;
        return `${base}?embed=1`;
    }

    function isTweetHost(host: string): boolean {
        const h = host.toLowerCase();
        return (
            h === "x.com" ||
            h.endsWith(".x.com") ||
            h === "twitter.com" ||
            h.endsWith(".twitter.com") ||
            h === "mobile.twitter.com" ||
            h.endsWith(".mobile.twitter.com")
        );
    }

    const externalItems = computed<ExternalItem[]>(() => {
        const raw = ((scenarioEvent.value as any)?.externalMediaUrls ?? []) as any[];
        const lines = Array.isArray(raw) ? raw : [];

        // Do not overwrite the textarea while editing (prevents editor jumping)
        if (!isEditExternalMediaMode.value) {
            externalMediaText.value = lines.join("\n");
        }

        const out: ExternalItem[] = [];

        for (const line of lines) {
            const parsed = splitLine(String(line ?? ""));
            if (!parsed) continue;

            const urlStr = parsed.url;
            const u = safeUrl(urlStr);
            if (!u) {
                out.push({ kind: "generic", url: urlStr, description: parsed.description });
                continue;
            }

            const host = u.hostname.toLowerCase();

            if (isImageFile(u)) {
                out.push({ kind: "image-file", url: urlStr, src: urlStr, description: parsed.description });
                continue;
            }
            if (isVideoFile(u)) {
                out.push({ kind: "video-file", url: urlStr, src: urlStr, description: parsed.description });
                continue;
            }

            const yt = getYouTubeId(u);
            if (yt) {
                out.push({
                    kind: "youtube",
                    url: urlStr,
                    embedUrl: makeYouTubeEmbedUrl(yt),
                    description: parsed.description,
                });
                continue;
            }

            // Tweet status URL: oEmbed preview (no iframe)
            if (isTweetHost(host)) {
                out.push({
                    kind: "tweet",
                    url: urlStr,
                    description: parsed.description,
                });
                continue;
            }

            // Telegram (iframe embed)
            if (host === "t.me" || host.endsWith(".t.me") || host === "telegram.me" || host.endsWith(".telegram.me")) {
                const embedUrl = makeTelegramEmbedUrl(u);
                if (embedUrl) {
                    out.push({
                        kind: "telegram",
                        url: urlStr,
                        embedUrl,
                        description: parsed.description,
                    });
                    continue;
                }
            }

            out.push({ kind: "generic", url: urlStr, description: parsed.description });
        }

        return out;
    });

    const selected = computed(() => externalItems.value[selectedIndex.value] ?? null);
    const hasSelectedDescription = computed(() => !!selected.value?.description?.trim());
    const selectedDescription = computed(() => selected.value?.description ?? "");

    watch(
        () => externalItems.value.length,
        (n) => {
            if (n <= 0) selectedIndex.value = 0;
            else if (selectedIndex.value >= n) selectedIndex.value = n - 1;
        },
        { immediate: true },
    );

    watch(selectedIndex, () => {
        showSelectedDescription.value = false;
    });

    function prevMedia() {
        const n = externalItems.value.length;
        if (!n) return;
        selectedIndex.value = (selectedIndex.value - 1 + n) % n;
    }

    function nextMedia() {
        const n = externalItems.value.length;
        if (!n) return;
        selectedIndex.value = (selectedIndex.value + 1) % n;
    }

    function pulseSavedToast() {
        showExternalMediaSaved.value = true;

        if (savedToastTimer !== null) {
            window.clearTimeout(savedToastTimer);
            savedToastTimer = null;
        }

        savedToastTimer = window.setTimeout(() => {
            showExternalMediaSaved.value = false;
            savedToastTimer = null;
        }, 2000);
    }

    onBeforeUnmount(() => {
        if (savedToastTimer !== null) window.clearTimeout(savedToastTimer);
    });

    function saveExternalMediaUrls() {
        const lines = externalMediaText.value
            .split(/\r?\n/g)
            .map((s) => s.trim())
            .filter(Boolean);

        updateScenarioEvent(props.eventId, { externalMediaUrls: lines } as any);
        isEditExternalMediaMode.value = false;
        pulseSavedToast();
    }

    // ------------------------------------------
    // Tweet previews (oEmbed + widgets.js), no iframe
    // ------------------------------------------
    const tweetHtmlByUrl = ref<Record<string, string>>({});
    const tweetErrByUrl = ref<Record<string, string>>({});
    const tweetLoadingByUrl = ref<Record<string, boolean>>({});
    const tweetContainerEl = ref<HTMLElement | null>(null);

    let twitterScriptPromise: Promise<void> | null = null;

    function ensureTwitterWidgets(): Promise<void> {
        if (twitterScriptPromise) return twitterScriptPromise;

        twitterScriptPromise = new Promise<void>((resolve) => {
            const existing = document.querySelector('script[data-orbat-twitter-widgets="1"]') as HTMLScriptElement | null;
            if (existing) {
                resolve();
                return;
            }

            const s = document.createElement("script");
            s.src = "https://platform.twitter.com/widgets.js";
            s.async = true;
            s.defer = true;
            s.setAttribute("data-orbat-twitter-widgets", "1");
            s.onload = () => resolve();
            s.onerror = () => resolve(); // still resolve; fallback will remain
            document.head.appendChild(s);
        });

        return twitterScriptPromise;
    }

    async function loadTweetEmbed(url: string) {
        if (!url) return;
        if (tweetHtmlByUrl.value[url] || tweetErrByUrl.value[url]) return;
        if (tweetLoadingByUrl.value[url]) return;

        tweetLoadingByUrl.value = { ...tweetLoadingByUrl.value, [url]: true };

        try {
            const oembedUrl =
                "https://publish.twitter.com/oembed?omit_script=1&dnt=true&url=" + encodeURIComponent(url);

            const res = await fetch(oembedUrl, { method: "GET" });
            if (!res.ok) {
                tweetErrByUrl.value = { ...tweetErrByUrl.value, [url]: `oEmbed HTTP ${res.status}` };
                return;
            }

            const data = (await res.json()) as { html?: string };
            const html = String(data?.html ?? "").trim();
            if (!html) {
                tweetErrByUrl.value = { ...tweetErrByUrl.value, [url]: "oEmbed returned empty html" };
                return;
            }

            tweetHtmlByUrl.value = { ...tweetHtmlByUrl.value, [url]: html };

            await ensureTwitterWidgets();
            await nextTick();

            const w = (window as any).twttr;
            if (w && w.widgets && typeof w.widgets.load === "function" && tweetContainerEl.value) {
                try {
                    w.widgets.load(tweetContainerEl.value);
                } catch {
                    // ignore
                }
            }
        } catch (e: any) {
            const msg = e?.message ? String(e.message) : "oEmbed fetch failed";
            tweetErrByUrl.value = { ...tweetErrByUrl.value, [url]: msg };
        } finally {
            tweetLoadingByUrl.value = { ...tweetLoadingByUrl.value, [url]: false };
        }
    }

    watch(
        selected,
        (it) => {
            if (!it) return;
            if (it.kind === "tweet") {
                void loadTweetEmbed(it.url);
            }
        },
        { immediate: true },
    );

    // Tabs
    const tabList = computed(() => (ui.debugMode ? ["Media", "Units", "Details", "Debug"] : ["Media", "Units", "Details"]));

    function onAction(action: ScenarioEventAction) {
        switch (action) {
            case "setStartTime": {
                const currentStart = scenarioEvent.value?.startTime ?? 0;
                getModalTimestamp(currentStart, {
                    timeZone: store.state.info.timeZone,
                    title: "Set event start time",
                }).then((newTimestamp) => {
                    if (newTimestamp !== undefined) {
                        updateScenarioEvent(props.eventId, { startTime: newTimestamp } as any);
                    }
                });
                break;
            }
            case "delete":
                time.deleteScenarioEvent(props.eventId);
                clearSelected();
                break;
            case "editMeta":
                toggleEditMode();
                break;
            default:
                break;
        }
    }
</script>

<template>
    <div v-if="scenarioEvent">
        <header class="flex flex-col gap-1">
            <EditableLabel v-model="title" @updateValue="updateTitle" />
            <nav class="mt-1 flex items-center justify-between gap-2">
                <div class="text-xs font-medium text-muted-foreground">
                    {{ formattedEventTime }}
                </div>
                <div class="flex items-center gap-1">
                    <IconButton title="Set event location on map" @click="startGetLocation()">
                        <IconCrosshairsGps class="h-4 w-4" aria-hidden="true" />
                    </IconButton>

                    <ScenarioEventDropdownMenu @action="onAction" />
                </div>
            </nav>
        </header>

        <TabWrapper :tabList="tabList">
            <!-- MEDIA TAB -->
            <TabPanel>
                <div class="mt-4 space-y-4">
                    <div class="flex items-center justify-between">
                        <p class="text-xs font-medium text-muted-foreground">
                            Internet media ({{ externalItems.length }})
                        </p>

                        <div class="flex items-center gap-2">
                            <p v-if="showExternalMediaSaved" class="text-xs text-muted-foreground">
                                Saved.
                            </p>
                            <button type="button"
                                    class="rounded border px-2 py-1 text-xs"
                                    @click="toggleEditExternalMediaMode()">
                                {{ isEditExternalMediaMode ? "Close editor" : "Edit internet media" }}
                            </button>
                        </div>
                    </div>

                    <!-- Viewer -->
                    <div v-if="!isEditExternalMediaMode">
                        <div v-if="externalItems.length" class="space-y-3">
                            <div class="relative w-full overflow-hidden rounded border bg-muted/20">
                                <div class="aspect-video w-full">
                                    <img v-if="selected?.kind === 'image-file'"
                                         class="h-full w-full object-contain"
                                         :src="selected.src"
                                         alt="Image" />

                                    <video v-else-if="selected?.kind === 'video-file'"
                                           class="h-full w-full"
                                           controls
                                           playsinline
                                           :src="selected.src" />

                                    <iframe v-else-if="selected?.kind === 'youtube' && selected.embedUrl"
                                            class="h-full w-full"
                                            :src="selected.embedUrl"
                                            frameborder="0"
                                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                            allowfullscreen
                                            referrerpolicy="strict-origin-when-cross-origin" />

                                    <!-- Tweet preview (oEmbed; no iframe) -->
                                    <div v-else-if="selected?.kind === 'tweet'"
                                         class="h-full w-full overflow-auto p-2"
                                         ref="tweetContainerEl">
                                        <div v-if="tweetHtmlByUrl[selected.url]" v-html="tweetHtmlByUrl[selected.url]"></div>

                                        <div v-else class="flex h-full w-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                                            <div v-if="tweetLoadingByUrl[selected.url]">Loading tweet preview...</div>
                                            <div v-else-if="tweetErrByUrl[selected.url]" class="text-xs">
                                                Preview failed: {{ tweetErrByUrl[selected.url] }}
                                            </div>
                                            <a class="underline" target="_blank" rel="noopener noreferrer" :href="selected.url">
                                                Open tweet
                                            </a>
                                        </div>
                                    </div>

                                    <iframe v-else-if="selected?.kind === 'telegram' && selected.embedUrl"
                                            class="h-full w-full"
                                            :src="selected.embedUrl"
                                            frameborder="0"
                                            referrerpolicy="no-referrer" />

                                    <div v-else class="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
                                        <a class="underline" target="_blank" rel="noopener noreferrer" :href="selected?.url">
                                            Open link
                                        </a>
                                    </div>
                                </div>

                                <button type="button"
                                        class="absolute left-2 top-1/2 -translate-y-1/2 rounded border bg-background/80 px-2 py-1 text-xs"
                                        @click="prevMedia"
                                        title="Previous">
                                    Prev
                                </button>

                                <button type="button"
                                        class="absolute right-2 top-1/2 -translate-y-1/2 rounded border bg-background/80 px-2 py-1 text-xs"
                                        @click="nextMedia"
                                        title="Next">
                                    Next
                                </button>

                                <div class="absolute bottom-2 right-2 rounded border bg-background/80 px-2 py-1 text-[11px] text-muted-foreground">
                                    {{ selectedIndex + 1 }} / {{ externalItems.length }}
                                </div>
                            </div>

                            <div class="flex items-center justify-between">
                                <button v-if="hasSelectedDescription"
                                        type="button"
                                        class="rounded border px-2 py-1 text-xs"
                                        @click="showSelectedDescription = !showSelectedDescription">
                                    {{ showSelectedDescription ? "Hide description" : "Show description" }}
                                </button>

                                <span v-else class="text-xs text-muted-foreground">
                                    No description for this item.
                                </span>
                            </div>

                            <div v-if="showSelectedDescription && hasSelectedDescription" class="rounded border p-2 text-sm whitespace-pre-wrap">
                                {{ selectedDescription }}
                            </div>
                        </div>

                        <p v-else class="text-xs text-muted-foreground">
                            No internet media added.
                        </p>
                    </div>

                    <!-- Editor -->
                    <div v-if="isEditExternalMediaMode" class="space-y-2">
                        <textarea v-model="externalMediaText"
                                  rows="7"
                                  class="w-full rounded border p-2 text-xs"
                                  spellcheck="false"
                                  placeholder="One entry per line. You can add a description after a pipe.

YouTube:
https://youtu.be/VIDEO_ID | Your description

Tweet status URL (preview via oEmbed):
https://x.com/user/status/123 | Optional note

Tweet media-only (recommended if you only want an image/video):
https://pbs.twimg.com/media/XYZ?format=jpg&name=large | Paste tweet text here
https://video.twimg.com/ext_tw_video/...mp4 | Paste tweet text here

Telegram:
https://t.me/channel/123 | Description / transcript / context" />

                        <div class="flex items-center justify-end gap-2">
                            <button type="button" class="rounded border px-2 py-1 text-xs" @click="toggleEditExternalMediaMode()">
                                Cancel
                            </button>
                            <button type="button" class="rounded border px-2 py-1 text-xs" @click="saveExternalMediaUrls">
                                Save internet media
                            </button>
                        </div>
                    </div>
                </div>
            </TabPanel>

            <!-- UNITS TAB (symbol-based selector) -->
            <TabPanel>
                <div class="mt-4">
                    <ScenarioEventUnitsTab :eventId="props.eventId" />
                </div>
            </TabPanel>

            <!-- DETAILS TAB -->
            <TabPanel>
                <EditMetaForm class="mt-4"
                              v-if="isEditMode"
                              :item="scenarioEvent"
                              @update="onFormSubmit"
                              @cancel="toggleEditMode()" />

                <div v-else class="mt-4 space-y-4">
                    <div v-if="scenarioEvent.description">
                        <div class="prose prose-sm dark:prose-invert" v-html="hDescription"></div>
                    </div>

                    <DescriptionItem label="Event type">
                        <SimpleSelect :modelValue="category" :items="categoryOptions" @update:modelValue="updateCategory" />
                    </DescriptionItem>

                    <DescriptionItem label="Location">
                        <div class="flex items-center justify-between">
                            <p>
                                <span v-if="eventLocation">{{ formattedLocation }}</span>
                                <span v-else class="text-muted-foreground">Not set</span>
                            </p>
                            <IconButton title="Pan map to event" :disabled="!hasEventLocation" @click="onPanToEventLocation">
                                <IconCrosshairsGps class="h-4 w-4" />
                            </IconButton>
                        </div>
                    </DescriptionItem>

                    <DescriptionItem label="End time (visibility window)">
                        <div class="flex items-center justify-between gap-2">
                            <p class="text-sm">
                                {{ formattedEndTime }}
                            </p>

                            <div class="flex items-center gap-1">
                                <button type="button"
                                        class="rounded border px-2 py-1 text-xs"
                                        title="Set end time to the current timeline time"
                                        @click="setEndTimeToTimeline">
                                    Set
                                </button>

                                <IconButton title="Set end time with calendar" @click="setEndTimeByCalendar">
                                    <IconCalendarClock class="h-4 w-4" />
                                </IconButton>

                                <button type="button"
                                        class="rounded border px-2 py-1 text-xs"
                                        title="Clear end time"
                                        @click="clearEndTime">
                                    Clear
                                </button>
                            </div>
                        </div>
                    </DescriptionItem>

                    <DescriptionItem v-if="scenarioEvent.externalUrl" label="External URL" dd-class="truncate" class="mt-4">
                        <a target="_blank" draggable="false" class="underline" :href="scenarioEvent.externalUrl">
                            {{ scenarioEvent.externalUrl }}
                        </a>
                    </DescriptionItem>
                </div>
            </TabPanel>

            <TabPanel v-if="ui.debugMode">
                <pre v-if="ui.debugMode">{{ scenarioEvent }}</pre>
            </TabPanel>
        </TabWrapper>
    </div>

    <div v-else class="p-3 text-sm text-muted-foreground">
        No event selected.
    </div>
</template>
