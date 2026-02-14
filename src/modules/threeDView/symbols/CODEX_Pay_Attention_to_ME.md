# CODEX Pay Attention To Me

This is the 3D SIDC shape-override playbook for `threeDView`.

## Source Of Truth
- Shape matching rules live in `shapeOverrides.ts`.
- Keep rules data-driven and ordered from most-specific to least-specific.
- LandEquipment category/subcategory resolution lives under `landEquipment/`.
- MIL-STD-2525 source data comes from `src/symbology/standards/milstd2525.ts` section `"15"`.
- Generic non-weapon/non-vehicle landEquipment rendering now uses:
- `landEquipment/landEquipmentRecipeEngine.ts` (recipe parser/layout)
- `landEquipment/shapeOverrideMapping.ts` (tokens + override rows)
- Current intended rules:
- `15:11:05..09,14` -> `weaponTriangle`
- `15:11:11` -> `weaponDualTubeLauncher` (vehicle-sized box + two tube cylinders)
- `15:11:16` -> `weaponSixTubeLauncher` (vehicle-sized box + 2x3 tube rack, slanted)
- `15:11:13,15` -> `weaponSingleLargeTubeLauncher` (vehicle-sized box + one large rear tube)
- `15:11:*` -> `weaponCylinder`
- `15:12:01:03` -> `vehicleApcModule` (vehicle hull + rear APC module block)
- `15:12:01:04,07` -> `vehicleApcAmbulance` (vehicle hull + rear module + roof medical pod)
- `15:12:01:11` -> `vehicleReconMast` (vehicle hull + raised recon mast)
- `15:12:01:09` -> `vehicleCargoModule` (vehicle hull + larger rear cargo/service module)
- `15:12:01:02` -> `vehicleCommandMast` (vehicle hull + command module + comms mast head)
- `15:12:01:06,08` -> `vehicleRecoveryRig` (vehicle hull + rear recovery boom + tow hook block)
- `15:12:01:01` -> `vehicleIfvTurret` (vehicle hull + smaller IFV turret + short/light barrel)
- `15:12:02` -> `vehicleTankTurret` (vehicle hull + turret box + forward barrel cylinder)
- `15:12:01` -> `vehicleArmoredTurret` (vehicle hull + compact turret + short barrel)
- `15:12:03` -> `vehicleRecoveryBoom` (vehicle hull + angled recovery boom)
- `15:12:*` -> `vehicleBox`
- Tank subtypes (`15:12:02:01/02/03`) now auto-scale hull/turret/barrel (light/medium/heavy) using SIDC subtype.
- Vehicle hull dimensions in `globeAdapter.ts` now resolve by SIDC class from exemplar platforms:
  - tank: M1 Abrams baseline
  - IFV: M2 Bradley baseline
  - APC/ambulance: M113 baseline
  - command post: M577 baseline
  - recovery: M88 baseline
  - recon: LAV-25 baseline
  - cargo/support: M939 baseline
- Civilian `15:16:*` now has type/subtype-specific dimension profiles:
  - compact/midsize/sedan, pickups/open-bed, vans/buses, SUVs/box-trucks, jeep-type, tractor-trailer/flatbed.
- Armored vehicle hulls across `15:12:*` (including tank `15:12:02:*` and recovery `15:12:03:*`) now use the split hull:
  - lower hull uses full footprint
  - upper hull shrinks width/length by 25%
  - upper hull trapezoid-prism height is additionally scaled to 50% of previous value
  - IFV/armored turrets are anchored on top of the upper hull (not mid-hull)
- Generic `vehicleBox` render path now supports SIDC-class hull add-on superstructures (`__hull_addon_*`)
  so non-armored vehicle families can get multi-block silhouettes without per-SIDC bespoke meshes.
- Recipe-rendered land-vehicle categories now also apply the same `__hull_addon_*` superstructures
  (in addition to mobility add-ons), not just `15:12:*` vehicle-box units.
- Vehicle hull size and hull-addon SIDC mapping logic is now centralized in:
  - `landEquipment/vehicleSizingController.ts`
  Keep new size/profile edits there, and keep `globeAdapter.ts` focused on rendering/lifecycle.
- Latest truck/civilian refinement source note:
  - `CHATGPTsuggestions/civilian_utility_vehicle_hull_descriptions.txt` guidance has been folded into
    `vehicleSizingController.ts` for `15:14`, `15:16`, `15:17`, and `15:23` subtypes.

Modifier-driven vehicle auto-addons (applies across vehicle blocks/composites):
- SIDC `modifierOne` (`[16..18]`) now drives mobility overlays: wheeled/tracked/wheeled+tracked/towed/rail/snow/sled/amphibious.
- SIDC `modifierTwo` (`[18..20]`) now recognizes towed-array (`61`,`62`) and adds a rear tow-array tail element.
- Parser: `landEquipment/mobilityModifiers.ts`
- Renderer hookup: `globeAdapter.ts` via `applyVehicleMobilityAddons(...)`
- Debug:
  - `window.__3dMobilityDebug = true`
  - optional unit filter: `window.__3dMobilityDebugUnitId = "<unitId>"`
  - latest parsed payload cache: `window.__3dMobilityLastProfileByUnit`

## How To Implement New Shape Overrides
- Add/adjust SIDC rule(s) in `shapeOverrides.ts`.
- Ensure `globeAdapter.ts` has a render branch for the resolved shape type.
- Ensure ground-shape branches call the shared cleanup path before drawing:
- `clearGroundOverrideArtifacts(...)`
- `clearGroundOverrideEntityGraphics(...)`
- Ensure label styling for ground primitives uses:
- `applyGroundPrimitiveLabelOffset(...)`
- For composite child entities (launcher tubes), always:
- tag with `tagEntityWithUnitId(child, parentUnitId)` for selection safety
- preserve them in `setUnitsInner` prune (`isLauncherTubeId/baseIdFromLauncherTubeId`)
- remove them in `removeUnit(...)`

## What Worked
- Using a centralized SIDC resolver (`resolveSidcShapeOverride`) removed brittle scattered checks.
- Re-evaluating shape on `upsertUnit` and in `updateAllUnitsAtTime` made ORBAT updates apply quickly.
- Aggressive cleanup of helper entities (`<unitId>__*`, underbar/pedestal/cap/decal) removed stale artifacts.
- Override-aware SIDC precedence fixed mismatch cases where event SIDC and unit SIDC disagree.
- Preserving launcher child entities during prune stopped "all tubes disappear until refresh" regressions.
- Prioritizing `properties.unitId` in selection extraction stopped UI crashes from child-entity picks.

## What Did Not Work (Do Not Repeat)
- Relying only on event SIDC for shape decisions caused missed overrides on newly edited ORBAT units.
- Cleaning only a subset of helper entities left SIDC icon/pedestal artifacts behind.
- Applying label offsets ad hoc in each branch caused drift/inconsistent behavior.
- Letting cleanup sweep remove active launcher children (`<unitId>__*`) caused transient disappearance.
- Returning raw child entity IDs to selection (instead of parent `unitId`) caused `unit.sidc` undefined errors.

## SIDC Precedence Rule (Important)
- Prefer event SIDC for timeline correctness.
- If unit SIDC has a shape override and event SIDC does not, prefer unit SIDC for render/cleanup branching.
- Keep this consistent across:
- initial render
- `upsertUnit`
- `updateAllUnitsAtTime`

## Quick Add Recipe
- User says: "Use shape X for SIDC family Y".
- Update `shapeOverrides.ts`.
- If new shape type: add renderer branch in `globeAdapter.ts`.
- Ensure cleanup + label helper are applied.
- Ensure prune/selection lifecycle is wired for child entities (keep/remove/tag).
- Verify:
- unit appears with intended shape
- no legacy SIDC icon/pedestal remains
- labels stay visible and correctly offset
- adding a new unit does not make existing launcher tubes disappear
- selecting/clicking child geometry resolves to parent unit ID (no panel errors)

## LandEquipment Mapping Workflow
- Add new category roots in `landEquipment/definitions/*.ts` (entityCode-level).
- Add subcategory files in `landEquipment/subcategories/*.ts` using:
- `entityTypeCode` for `xx00` codes (type-level fallback)
- `entitySubtypeCode` for `xxxx` codes where subtype is non-zero
- Keep both type-level and subtype-level definitions so:
- subtype-specific rendering can exist
- generic type rendering still works when subtype is unknown
- Wire new subcategory files in:
- `landEquipment/subcategories/index.ts`
- `landEquipment/index.ts` (`LAND_EQUIPMENT_SUBCATEGORY_DEFINITIONS`)
- Resolver precedence (already implemented): `entity + type + subtype` first, then `entity + type`.
- For rendering overrides:
- `globeAdapter.ts` keeps tuned branches for `15:11` and `15:12`.
- Other `15:*` categories can flow through `applyLandEquipmentRecipeOverride(...)`.
- Use helper child IDs `${unitId}__le_part_${i}` for composite parts.
- Preserve/remove helper IDs in lifecycle:
- prune (`setUnitsInner`) keep when base unit exists
- removeUnit remove by prefix
- cleanup path preserve active IDs to avoid flicker/disappearing parts

## What Worked For LandEquipment Expansion
- Expanding `LandEquipmentSubcategoryDefinition` with optional `entitySubtypeCode`.
- Matching subtype first then falling back to type prevented regressions for existing overrides.
- Keeping IDs stable and explicit by category makes shape rules easier to target.
- Using recipe caching (`recipe -> compiled instances`) avoided repeated parse cost.
- Treating recipe-backed SIDCs as ground primitives centralized pedestal/icon suppression.
- Focused unit tests under `landEquipment/*.spec.ts` caught coverage gaps quickly.
- SIDC->override memoization in `shapeOverrideMapping.ts` reduced repeated resolver work during ticks.

## What Did Not Work For LandEquipment Expansion
- Creating subcategory files without exporting/wiring them into the aggregate list had no runtime effect.
- Regex extraction without handling wrapped strings missed long multiline `entityType` values.
- Allowing static-tick position writes to overwrite callback positions causes helper parts to disappear.
- Keeping `.ts` snippet/reference files under `CHATGPTsuggestions/` caused avoidable typecheck noise.

## Pinned Checkpoint (2026-02-14)
- `symbols/Products` now exists as the shared foundation for aggregated shape handling:
  - `Products/types.ts`
  - `Products/productAggregator.ts`
  - `Products/groundConformController.ts`
- Ground placement for 3D ground primitives is no longer center-only. It now uses corner-aware terrain sampling via product footprint.
- Ground conform now computes a terrain plane and applies rigid model pose (position + orientation) rather than only vertical lift.
- Child component offsets now run in parent local oriented space (`offsetFromEntityLocal`), so assembled models move as wholes and do not "flex apart" on slopes.
- Vehicle/radar/recovery/launcher/recipe helper parts are now on this same rigid local-offset path.
- Armored barrels now derive orientation from parent local orientation (not standalone world HPR), so they tilt with the aggregate model.
- Man-portable/rifleman SIDC top icon cap/decal now attaches in local oriented space and no longer stays world-horizontal when pillar tilts.
- Status at pin:
  - aggregation/caching: working
  - rigid assembly behavior: working
  - terrain conform orientation: working in latest user validation rounds
  - this is a safe context-switch point for non-3D tasks
