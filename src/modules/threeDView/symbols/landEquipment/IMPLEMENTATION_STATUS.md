# LandEquipment Recipe Integration Status

## Completed
- Added recipe compiler:
  - `src/modules/threeDView/symbols/landEquipment/landEquipmentRecipeEngine.ts`
- Added shape grammar + override table:
  - `src/modules/threeDView/symbols/landEquipment/shapeOverrideMapping.ts`
- Integrated generic renderer into:
  - `src/modules/threeDView/globeAdapter.ts`

## Runtime behavior now
- Existing tuned branches remain:
  - `15:11` weapons (cylinders/triangles/launcher composites)
  - `15:12` vehicles (vehicle blocks)
- Generic recipe branch now covers non-weapon/non-vehicle landEquipment families:
  - entity codes `13,14,15,16,17,19,20,21,22,23`
- Recipe-backed SIDCs are treated as ground primitives for:
  - pedestal/icon cleanup
  - helper entity lifecycle handling
- Vehicle mobility/towed modifiers now parse from SIDC and auto-apply reusable add-on parts:
  - parser: `mobilityModifiers.ts`
  - hook: `applyVehicleMobilityAddons(...)` in `globeAdapter.ts`
  - sources: modifierOne (`[16..18]`) and modifierTwo (`[18..20]`)
  - tuned by family (tank/IFV/general vehicle/utility-truck/train-like lengths)
  - applied to both `vehicles` and recipe-based vehicle-like categories:
    `engineer-vehicles-and-equipment`, `utility-vehicles`, `civilian-vehicles`,
    `law-enforcement`, `missile-support`, `emergency-operation`, `trains`
- Armored vehicle base hull (`15:12:01:*`) now renders as a two-box stacked hull with a reduced upper footprint
  to approximate a trapezoidal vehicle body without introducing custom primitive geometry.
- Vehicle hull dimensions are now SIDC-class driven from real-world exemplar platforms
  (M1 Abrams, M2 Bradley, M113, M577, M88, LAV-25, M939) instead of one shared fixed box.
- Generic `vehicleBox` now adds SIDC-class superstructure hull blocks (`__hull_addon_*`)
  for non-armored families (recon/engineer/utility/emergency/missile-support), staying wheel-free.
- Recipe-backed vehicle-like categories now also receive `__hull_addon_*` superstructures with
  full preserve/prune/remove lifecycle handling.
- Civilian vehicle classes (`15:16:*`) now resolve by type/subtype with car/truck/bus/tractor-trailer
  size bands and matching hull superstructure patterns.
- Size/profile source for vehicle hulls and hull add-on blocks is now factored into:
  - `src/modules/threeDView/symbols/landEquipment/vehicleSizingController.ts`
- Incorporated the latest plain-English hull guidance for:
  - utility semis (tanker/dump/lowboy style), tow trucks (light/heavy),
  - utility medical/evac/emergency physician,
  - law-enforcement patrol vehicles (light bar cue),
  - emergency ambulance/fire-engine stepped profiles.
- Civilian vehicles (`15:16:*`) now intentionally suppress mobility add-on geometry
  (no wheel/track cylinders on civilian hull renders).
- Civilian/utility/law/emergency categories now route through the vehicle-hull pipeline
  (same renderer used by `vehicleBox`) instead of recipe-body fallback, improving car/truck silhouettes.

## Helper entity lifecycle
- Recipe helpers are created as:
  - `${unitId}__le_part_${i}`
- Preserved during prune when base unit exists.
- Removed during `removeUnit(...)`.
- Cleanup supports preserve lists to avoid flicker/disappearing helpers.

## Added tests
- `src/modules/threeDView/symbols/landEquipment/landEquipmentRecipeEngine.spec.ts`
  - parser behavior
  - compiled instances
  - subtype/wildcard override selection
- `src/modules/threeDView/symbols/landEquipment/shapeOverrideMapping.spec.ts`
  - category fallback coverage
  - subcategory-to-override coverage
  - SIDC string resolution sanity checks

## Latest test result
- `vitest` targeted tests are passing (7/7 tests).

## Notes
- `CHATGPTsuggestions/globeAdapter_landEquipment_recipe_renderer_snippet.ts` was renamed to `.txt`
  to keep it as reference without polluting TS build output.
- The full repo `type-check` still has many unrelated baseline errors outside this integration area.

## Next suggested pass
- Promote more category-specific shapes from fallback to type/subtype-specific rows in
  `shapeOverrideMapping.ts` based on your next spec.
- Add real triangular-prism geometry (currently `triangularPrism` renders as box fallback).
- Start introducing composite sensor/radar and mine-family variants by subtype where available.

## Pinned Milestone (2026-02-14)
- Added generalized `Products` layer under `src/modules/threeDView/symbols/Products`:
  - cached product aggregation
  - reusable terrain ground-conform controller
- Integrated product-based corner sampling into ground primitive placement.
- Upgraded from height-only snapping to rigid terrain-conform pose (orientation + anchor height).
- Converted helper part offsets to parent local oriented frame, fixing subcomponent separation/flexing.
- Updated armored barrel orientation to inherit local parent pose.
- Updated man-portable SIDC cap/decal to orient with pillar tilt.
- Current state: suitable to pause and shift to another repo area without losing 3D terrain/aggregation context.
