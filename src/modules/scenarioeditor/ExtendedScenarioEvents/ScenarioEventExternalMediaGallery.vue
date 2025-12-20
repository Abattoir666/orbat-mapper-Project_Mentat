<script setup lang="ts">
    import { computed, ref, watch } from "vue";
    import {
        parseExternalMediaUrls,
        type ExternalMediaItem,
    } from "@/modules/scenarioeditor/ExtendedScenarioEvents/parseExternalMedia";

    interface Props {
        urls: string[];
        maxHeightPx?: number;
    }

    const props = withDefaults(defineProps<Props>(), {
        maxHeightPx: 360,
    });

    const DEBUG_MEDIA_GALLERY = true;

    const items = computed<ExternalMediaItem[]>(() => parseExternalMediaUrls(props.urls ?? []));
    const selectedIndex = ref(0);
    const showDescription = ref(false);

    watch(
        () => items.value.length,
        (n) => {
            if (!n) {
                selectedIndex.value = 0;
                showDescription.value = false;
                return;
            }
            if (selectedIndex.value < 0) selectedIndex.value = 0;
            if (selectedIndex.value >= n) selectedIndex.value = n - 1;
        },
        { immediate: true }
    );

    const selected = computed<ExternalMediaItem | null>(() => {
        const n = items.value.length;
        if (!n) return null;
        const idx = Math.min(Math.max(0, selectedIndex.value), n - 1);
        return items.value[idx] || null;
    });

    watch(selectedIndex, () => {
        showDescription.value = false;
    });

    watch(
        selected,
        (it) => {
            if (!DEBUG_MEDIA_GALLERY) return;
            if (!it) return;
            // eslint-disable-next-line no-console
            console.log("[MediaGallery] selected:", {
                kind: it.kind,
                provider: it.provider,
                originalUrl: it.originalUrl,
                src: it.src,
                embedUrl: it.embedUrl,
            });
            if (it.embedUrl && it.kind !== "youtube") {
                // eslint-disable-next-line no-console
                console.warn("[MediaGallery] WARNING: embedUrl present for non-youtube item. This should not happen.", it);
            }
        },
        { immediate: true }
    );

    const viewerStyle = computed(() => ({
        height: `${props.maxHeightPx}px`,
    }));

    const canPrev = computed(() => selectedIndex.value > 0);
    const canNext = computed(() => selectedIndex.value < items.value.length - 1);

    const selectedNote = computed(() => (selected.value?.note ?? "").trim());
    const hasSelectedNote = computed(() => selectedNote.value.length > 0);

    function select(idx: number) {
        const n = items.value.length;
        if (!n) return;
        selectedIndex.value = Math.min(Math.max(0, idx), n - 1);
    }

    function prev() {
        if (!canPrev.value) return;
        select(selectedIndex.value - 1);
    }

    function next() {
        if (!canNext.value) return;
        select(selectedIndex.value + 1);
    }

    function openInNewTab(url: string) {
        if (!url) return;
        window.open(url, "_blank", "noopener,noreferrer");
    }

    async function copyToClipboard(text: string) {
        try {
            if (!text) return;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
            }
        } catch {
            // ignore
        }
    }

    function isYouTubeEmbeddable(it: ExternalMediaItem | null): boolean {
        return !!it && it.kind === "youtube" && !!it.embedUrl;
    }
</script>

<template>
    <div v-if="items.length" class="space-y-2">
        <div class="relative w-full overflow-hidden rounded border" :style="viewerStyle">
            <div v-if="selected" class="h-full w-full">
                <img v-if="selected.kind === 'image'"
                     :src="selected.src"
                     class="h-full w-full object-contain bg-black/5"
                     loading="lazy"
                     referrerpolicy="no-referrer"
                     :alt="selected.titleHint || 'Image'" />

                <video v-else-if="selected.kind === 'video-file'"
                       class="h-full w-full bg-black"
                       controls
                       playsinline
                       :src="selected.src" />

                <!-- ONLY YouTube is allowed to iframe -->
                <iframe v-else-if="isYouTubeEmbeddable(selected)"
                        class="h-full w-full"
                        :src="selected.embedUrl"
                        frameborder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowfullscreen
                        referrerpolicy="no-referrer" />

                <!-- Everything else: never iframe -->
                <div v-else class="h-full w-full p-3 text-xs bg-black/5">
                    <div class="text-sm font-medium">
                        {{ selected.titleHint || selected.provider || "Link" }}
                    </div>

                    <div class="mt-1 break-all text-muted-foreground">
                        {{ selected.originalUrl }}
                    </div>

                    <div class="mt-2 flex items-center gap-2">
                        <button type="button"
                                class="rounded border px-2 py-1 text-xs"
                                @click="openInNewTab(selected.originalUrl)">
                            Open in new tab
                        </button>

                        <button type="button"
                                class="rounded border px-2 py-1 text-xs"
                                @click="copyToClipboard(selected.originalUrl)"
                                title="Copy URL">
                            Copy
                        </button>
                    </div>

                    <div class="mt-2 text-muted-foreground">
                        Preview disabled: site may block embedding via X-Frame-Options or CSP frame-ancestors.
                    </div>
                </div>
            </div>

            <button type="button"
                    class="absolute left-2 top-1/2 -translate-y-1/2 rounded bg-white/80 px-2 py-1 text-xs disabled:opacity-50 dark:bg-slate-900/70"
                    :disabled="!canPrev"
                    @click="prev">
                Prev
            </button>

            <button type="button"
                    class="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-white/80 px-2 py-1 text-xs disabled:opacity-50 dark:bg-slate-900/70"
                    :disabled="!canNext"
                    @click="next">
                Next
            </button>

            <div class="absolute bottom-1 right-2 rounded bg-black/60 px-2 py-0.5 text-[11px] text-white">
                {{ selectedIndex + 1 }} / {{ items.length }}
            </div>
        </div>

        <div class="flex flex-wrap gap-2">
            <button v-for="(it, idx) in items"
                    :key="it.originalUrl + '-' + idx"
                    type="button"
                    class="rounded border px-2 py-1 text-xs"
                    :class="idx === selectedIndex ? 'bg-muted/50' : ''"
                    @click="select(idx)"
                    :title="it.titleHint || it.provider">
                {{ it.provider }}
            </button>
        </div>

        <div class="flex items-center justify-between">
            <button v-if="hasSelectedNote"
                    type="button"
                    class="rounded border px-2 py-1 text-xs"
                    @click="showDescription = !showDescription">
                {{ showDescription ? "Hide description" : "Show description" }}
            </button>

            <span v-else class="text-xs text-muted-foreground">
                No description for this item.
            </span>
        </div>

        <div v-if="showDescription && hasSelectedNote" class="rounded border p-2 text-sm whitespace-pre-wrap">
            {{ selectedNote }}
        </div>
    </div>

    <p v-else class="text-xs text-muted-foreground">
        No internet media added.
    </p>
</template>
