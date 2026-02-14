import type { LandEquipmentSubcategoryDefinition } from "../types";

export const CIVILIAN_VEHICLES_SUBCATEGORY_DEFINITIONS: LandEquipmentSubcategoryDefinition[] = [
  { id: "civilian-vehicle-automobile", name: "Automobile", symbolSet: "15", entityCode: "16", entityTypeCode: "01" },
  { id: "civilian-vehicle-compact", name: "Compact", symbolSet: "15", entityCode: "16", entityTypeCode: "01", entitySubtypeCode: "01" },
  { id: "civilian-vehicle-midsize", name: "Midsize", symbolSet: "15", entityCode: "16", entityTypeCode: "01", entitySubtypeCode: "02" },
  { id: "civilian-vehicle-sedan", name: "Sedan", symbolSet: "15", entityCode: "16", entityTypeCode: "01", entitySubtypeCode: "03" },

  { id: "civilian-vehicle-open-bed-truck", name: "Open Bed Truck", symbolSet: "15", entityCode: "16", entityTypeCode: "02" },
  { id: "civilian-vehicle-pickup", name: "Pickup", symbolSet: "15", entityCode: "16", entityTypeCode: "02", entitySubtypeCode: "01" },
  { id: "civilian-vehicle-open-bed-small", name: "Open Bed Truck Small", symbolSet: "15", entityCode: "16", entityTypeCode: "02", entitySubtypeCode: "02" },
  { id: "civilian-vehicle-open-bed-large", name: "Open Bed Truck Large", symbolSet: "15", entityCode: "16", entityTypeCode: "02", entitySubtypeCode: "03" },

  { id: "civilian-vehicle-multiple-passenger", name: "Multiple Passenger Vehicle", symbolSet: "15", entityCode: "16", entityTypeCode: "03" },
  { id: "civilian-vehicle-van", name: "Van", symbolSet: "15", entityCode: "16", entityTypeCode: "03", entitySubtypeCode: "01" },
  { id: "civilian-vehicle-small-bus", name: "Small Bus", symbolSet: "15", entityCode: "16", entityTypeCode: "03", entitySubtypeCode: "02" },
  { id: "civilian-vehicle-large-bus", name: "Large Bus", symbolSet: "15", entityCode: "16", entityTypeCode: "03", entitySubtypeCode: "03" },

  { id: "civilian-vehicle-utility", name: "Utility Vehicle", symbolSet: "15", entityCode: "16", entityTypeCode: "04" },
  { id: "civilian-vehicle-suv", name: "Sport Utility Vehicle (SUV)", symbolSet: "15", entityCode: "16", entityTypeCode: "04", entitySubtypeCode: "01" },
  { id: "civilian-vehicle-small-box-truck", name: "Small Box Truck", symbolSet: "15", entityCode: "16", entityTypeCode: "04", entitySubtypeCode: "02" },
  { id: "civilian-vehicle-large-box-truck", name: "Large Box Truck", symbolSet: "15", entityCode: "16", entityTypeCode: "04", entitySubtypeCode: "03" },

  { id: "civilian-vehicle-jeep", name: "Jeep Type Vehicle", symbolSet: "15", entityCode: "16", entityTypeCode: "05" },
  { id: "civilian-vehicle-jeep-small", name: "Jeep Type Vehicle Small/Light", symbolSet: "15", entityCode: "16", entityTypeCode: "05", entitySubtypeCode: "01" },
  { id: "civilian-vehicle-jeep-medium", name: "Jeep Type Vehicle Medium", symbolSet: "15", entityCode: "16", entityTypeCode: "05", entitySubtypeCode: "02" },
  { id: "civilian-vehicle-jeep-large", name: "Jeep Type Vehicle Large/Heavy", symbolSet: "15", entityCode: "16", entityTypeCode: "05", entitySubtypeCode: "03" },

  { id: "civilian-vehicle-tractor-trailer", name: "Tractor Trailer Truck with Box", symbolSet: "15", entityCode: "16", entityTypeCode: "06" },
  { id: "civilian-vehicle-tractor-trailer-small", name: "Tractor Trailer Truck with Box Small/Light", symbolSet: "15", entityCode: "16", entityTypeCode: "06", entitySubtypeCode: "01" },
  { id: "civilian-vehicle-tractor-trailer-medium", name: "Tractor Trailer Truck with Box Medium", symbolSet: "15", entityCode: "16", entityTypeCode: "06", entitySubtypeCode: "02" },
  { id: "civilian-vehicle-tractor-trailer-large", name: "Tractor Trailer Truck with Box Large/Heavy", symbolSet: "15", entityCode: "16", entityTypeCode: "06", entitySubtypeCode: "03" },

  { id: "civilian-vehicle-tractor-trailer-flatbed", name: "Tractor Trailer Truck with Flatbed Trailer", symbolSet: "15", entityCode: "16", entityTypeCode: "07" },
  { id: "civilian-vehicle-flatbed-small", name: "Tractor Trailer Flatbed Small/Light", symbolSet: "15", entityCode: "16", entityTypeCode: "07", entitySubtypeCode: "01" },
  { id: "civilian-vehicle-flatbed-medium", name: "Tractor Trailer Flatbed Medium", symbolSet: "15", entityCode: "16", entityTypeCode: "07", entitySubtypeCode: "02" },
  { id: "civilian-vehicle-flatbed-large", name: "Tractor Trailer Flatbed Large/Heavy", symbolSet: "15", entityCode: "16", entityTypeCode: "07", entitySubtypeCode: "03" },
  { id: "civilian-vehicle-known-insurgent", name: "Known Insurgent Vehicle", symbolSet: "15", entityCode: "16", entityTypeCode: "08" },
  { id: "civilian-vehicle-drug", name: "Drug Vehicle", symbolSet: "15", entityCode: "16", entityTypeCode: "09" },
];
