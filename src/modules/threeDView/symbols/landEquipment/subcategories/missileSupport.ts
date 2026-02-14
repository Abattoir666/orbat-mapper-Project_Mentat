import type { LandEquipmentSubcategoryDefinition } from "../types";

export const MISSILE_SUPPORT_SUBCATEGORY_DEFINITIONS: LandEquipmentSubcategoryDefinition[] = [
  { id: "missile-support-transloader", name: "Transloader", symbolSet: "15", entityCode: "19", entityTypeCode: "01" },
  { id: "missile-support-transporter", name: "Transporter", symbolSet: "15", entityCode: "19", entityTypeCode: "02" },
  { id: "missile-support-crane-loading-device", name: "Crane/Loading Device", symbolSet: "15", entityCode: "19", entityTypeCode: "03" },
  {
    id: "missile-support-propellant-transporter",
    name: "Propellant Transporter",
    symbolSet: "15",
    entityCode: "19",
    entityTypeCode: "04",
  },
  { id: "missile-support-warhead-transporter", name: "Warhead Transporter", symbolSet: "15", entityCode: "19", entityTypeCode: "05" },
];
