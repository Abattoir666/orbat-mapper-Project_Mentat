export interface LandEquipmentCategoryDefinition {
  id: string;
  name: string;
  symbolSet: "15";
  entityCode: string;
}

export interface LandEquipmentSubcategoryDefinition {
  id: string;
  name: string;
  symbolSet: "15";
  entityCode: string;
  entityTypeCode: string;
  entitySubtypeCode?: string;
}
