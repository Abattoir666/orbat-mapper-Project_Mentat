import type { LandEquipmentSubcategoryDefinition } from "../types";

export const LAND_MINES_SUBCATEGORY_DEFINITIONS: LandEquipmentSubcategoryDefinition[] = [
  { id: "land-mine", name: "Land Mine", symbolSet: "15", entityCode: "21", entityTypeCode: "01" },
  { id: "land-mine-antipersonnel", name: "Antipersonnel Land Mine (APL)", symbolSet: "15", entityCode: "21", entityTypeCode: "02" },
  { id: "land-mine-antitank", name: "Antitank Mine", symbolSet: "15", entityCode: "21", entityTypeCode: "03" },
  {
    id: "land-mine-ied",
    name: "Improvised Explosives Device (IED)",
    symbolSet: "15",
    entityCode: "21",
    entityTypeCode: "04",
  },
  { id: "land-mine-less-than-lethal", name: "Less Than Lethal", symbolSet: "15", entityCode: "21", entityTypeCode: "05" },
];
