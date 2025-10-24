import type { ExportSettings } from "@/types/convert";
import type { Folder, Root } from "@tmcw/togeojson";
import type { NUnit } from "@/types/internalModels";
import { saveBlobToLocalFile } from "@/utils/files";
import { useSymbolSettingsStore } from "@/stores/settingsStore";
import { useGeoJsonConverter } from "@/importexport/export/geojsonConverter";
import type { TScenario } from "@/scenariostore";
import { symbolGenerator } from "@/symbology/milsymbwrapper";
import { useSelectedItems } from "@/stores/selectedStore.ts";
import type { UnitSymbolOptions } from "@/types/scenarioModels.ts";

const walkUnitTree = (rootId: string, visit: (u: any) => void, state: any) => {
    const m = state?.unitMap ?? {};
    const stack = [rootId];
    const seen = new Set<string>();
    while (stack.length) {
        const id = stack.pop()!;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const u = m[id];
        if (u) visit(u);
        const kids = (u?.subUnits ?? []) as string[];
        for (const k of kids) stack.push(k);
    }
};

type RenderSymbolSettings = {
  sidc: string;
  symbolOptions: UnitSymbolOptions;
  cacheKey: string;
};

type OffsetItem = {
  x: number;
  y: number;
};

// This composable provides KML/KMZ export functions, parameterized with required dependencies.
export function useKmlExport(scenario: TScenario) {
  const { convertUnitsToGeoJson, convertScenarioFeaturesToGeoJson } =
    useGeoJsonConverter(scenario);
  const { geo, store, unitActions } = scenario;
  const { sideMap } = store.state;

  const symbolSettings = useSymbolSettingsStore();
  const { selectedUnitIds } = useSelectedItems();

  function createKMLString(opts: KmlKmzExportSettings) {
    const root: Root = { type: "root", children: [] };
    const symbolDataCache = new Map<string, RenderSymbolSettings>();

    function createUnitsFolder(units: NUnit[], name: string): Folder {
      const { features } = convertUnitsToGeoJson(units, {
        includeIdInProperties: true,
      });
      return {
        type: "folder",
        meta: { name },
        children: features.map((unit: any) => {
          const { name, shortName, description, id, sidc, fillColor } = unit.properties;
          const nUnit = scenario.helpers.getUnitById(id)!;
          const s = createRenderSymbolSettings(nUnit, opts);
          symbolDataCache.set(s.cacheKey, s);
          const styleUrl = `#sidc${s.cacheKey}`;

          return {
            ...unit,
            properties: {
              name: opts.useShortName ? shortName || name : name,
              description,
              styleUrl,
            },
          };
        }),
      };
    }

    function writeFolders(parentFolder: Folder | Root) {
      if (opts.includeUnits) {
        if (opts.folderMode === "side") {
          for (const sideId of Object.keys(sideMap)) {
            const side = sideMap[sideId];
            const units: NUnit[] = [];
            unitActions.walkSide(sideId, (unit: any) => {
              if (
                unit._state?.location &&
                (opts.includeSelectedUnitsOnly
                  ? selectedUnitIds.value.has(unit.id)
                  : true)
              )
                units.push(unit);
            });
            if (units.length) {
              parentFolder.children.push(createUnitsFolder(units, side.name));
            }
          }
        } else if (opts.folderMode === "sideGroup") {
          for (const sideId of Object.keys(sideMap)) {
            const side = sideMap[sideId];
            if (!side) continue;
            const sideFolder: Folder = {
              type: "folder",
              meta: { name: side.name },
              children: [],
            };
            for (const groupId of side.groups) {
              const group = store.state.sideGroupMap[groupId];
              if (!group) continue;
              const sideGroupUnits: NUnit[] = [];
                walkUnitTree(group.id, (unit: any) => {
                if (
                  unit._state?.location &&
                  (opts.includeSelectedUnitsOnly
                    ? selectedUnitIds.value.has(unit.id)
                    : true)
                )
                  sideGroupUnits.push(unit);
                }, state);
              if (sideGroupUnits.length) {
                sideFolder.children.push(createUnitsFolder(sideGroupUnits, group.name));
              }
            }
            const sideUnits: NUnit[] = [];
              for (const rootUnitId of ((side as any).units ?? (side as any).subUnits ?? [])) {
                  walkUnitTree(rootUnitId, (unit: any) => {
                if (
                  unit._state?.location &&
                  (opts.includeSelectedUnitsOnly
                    ? selectedUnitIds.value.has(unit.id)
                    : true)
                )
                  sideUnits.push(unit);
                  }, state);
            }
            if (sideUnits.length) {
              const tempFolder = createUnitsFolder(sideUnits, "Root units");
              sideFolder.children.push(...tempFolder.children);
            }
            if (sideFolder.children.length) {
              parentFolder.children.push(sideFolder);
            }
          }
        } else {
          parentFolder.children.push(
            createUnitsFolder(geo.everyVisibleUnit.value, "Units"),
          );
        }
      }
    }
    if (opts.timeMode === "multiple" && opts.exportEventIds.length) {
      const currentTime = store.state.currentTime;
      const events = store.state.events
        .filter((e) => opts.exportEventIds.includes(e))
        .map((id) => store.state.eventMap[id]);
      for (const event of events) {
        const eventFolder: Folder = {
          type: "folder",
          meta: { name: event.title || "Event" },
          children: [],
        };
        scenario.time.setCurrentTime(event.startTime);
        writeFolders(eventFolder);
        root.children.push(eventFolder);
      }
      scenario.time.setCurrentTime(currentTime);
    } else {
      if (opts.timeMode === "event") {
        const currentTime = store.state.currentTime;
        const event = store.state.eventMap[opts.exportEventId || ""];
        if (event) {
          scenario.time.setCurrentTime(event.startTime);
          writeFolders(root);
          scenario.time.setCurrentTime(currentTime);
        } else {
          writeFolders(root);
        }
      }
    }

    const features = opts.includeFeatures
      ? convertScenarioFeaturesToGeoJson().features
      : [];

    if (opts.includeFeatures) {
      root.children.push({
        type: "folder",
        meta: { name: "Scenario features" },
        children: features,
      });
    }

    return { root, symbolDataCache };
  }

  async function downloadAsKML(opts: KmlKmzExportSettings) {
    const { foldersToKML } = await import("@/extlib/tokml");
    const { root } = createKMLString(opts);
    const kmlString = foldersToKML(root, []);
    await saveBlobToLocalFile(
      new Blob([kmlString], {
        type: "application/vnd.google-earth.kml+xml",
      }),
      "scenario.kml",
      { mimeTypes: ["application/vnd.google-earth.kml+xml"], extensions: [".kml"] },
    );
  }

  function createRenderSymbolSettings(
    unit: NUnit,
    opts: KmlKmzExportSettings,
  ): RenderSymbolSettings {
    const sidc = unit._state?.sidc || unit.sidc;
    let symbolOptions = unitActions.getCombinedSymbolOptions(unit);

    if (opts.renderAmplifiers) {
      const { uniqueDesignation = unit.shortName || unit.name, ...textAmplifiers } =
        unit.textAmplifiers || {};
      symbolOptions = { ...symbolOptions, uniqueDesignation, ...textAmplifiers };
    }
    const cacheKey = `${sidc}-${hashObject(symbolOptions)}`;
    return { sidc, symbolOptions, cacheKey };
  }

  async function downloadAsKMZ(opts: KmlKmzExportSettings) {
    const { zipSync } = await import("fflate");
    const { foldersToKML } = await import("@/extlib/tokml");
    const data: Record<string, Uint8Array> = {};
    const offsetCache = new Map<string, OffsetItem>();
    const { root, symbolDataCache } = createKMLString(opts);

    if (opts.embedIcons) {
      for (const [cacheKey, symbolData] of symbolDataCache) {
        const { sidc } = symbolData;

        const outlineOptions = opts.drawSymbolOutline
          ? { outlineWidth: opts.outlineWidth, outlineColor: opts.outlineColor }
          : {};

        const symb = symbolGenerator(sidc, {
          ...symbolSettings.symbolOptions,
          ...symbolData.symbolOptions,
          ...outlineOptions,
        });
        const { x, y } = symb.getOctagonAnchor();
        const size = symb.getSize();

        offsetCache.set(cacheKey, { x: size.width - x, y });

        const blob: Blob | null = await new Promise((resolve) =>
          symb.asCanvas().toBlob(resolve),
        );
        if (blob) {
          data[`icons/${cacheKey}.png`] = new Uint8Array(await blob.arrayBuffer());
        }
      }
    }

    const kmlString = foldersToKML(
      root,
      [...symbolDataCache.keys()].map((cacheKey) => ({
        sidc: cacheKey,
        labelScale: opts.labelScale,
        iconScale: opts.iconScale,
        xOffset: offsetCache?.get(cacheKey)?.x,
        yOffset: offsetCache?.get(cacheKey)?.y,
      })),
    );

    data["doc.kml"] = new TextEncoder().encode(kmlString);
    const zipData = zipSync(data);
    await saveBlobToLocalFile(
      new Blob([zipData as BlobPart], {
        type: "application/vnd.google-earth.kmz",
      }),
      "scenario.kmz",
      { mimeTypes: ["application/vnd.google-earth.kmz"], extensions: [".kmz"] },
    );
  }

  return {
    downloadAsKML,
    downloadAsKMZ,
  };
}
