export type SidcCoreParts = {
  entityCode?: string;
  entityTypeCode?: string;
  entitySubtypeCode?: string;
};

export type VehicleHullSize = {
  x: number;
  y: number;
  z: number;
};

export type VehicleHullAddonSpec = {
  east: number;
  north: number;
  up: number;
  size: { x: number; y: number; z: number };
  alpha?: number;
};

const DEFAULT_VEHICLE_HULL_SIZE: VehicleHullSize = { x: 3.5, y: 6.5, z: 3.0 };

export function parseSidcCoreParts(sidc?: string): SidcCoreParts {
  if (typeof sidc !== "string") return {};
  const s = sidc.trim();
  if (s.length < 16) return {};
  return {
    entityCode: s.slice(10, 12),
    entityTypeCode: s.slice(12, 14),
    entitySubtypeCode: s.slice(14, 16),
  };
}

export function resolveVehicleHullSizeForSidc(
  sidc?: string,
  fallback: VehicleHullSize = DEFAULT_VEHICLE_HULL_SIZE,
): VehicleHullSize {
  const p = parseSidcCoreParts(sidc);
  if (!p.entityCode) return fallback;

  if (p.entityCode === "12") {
    if (p.entityTypeCode === "02") {
      const base = { x: 3.66, y: 9.75, z: 2.44 };
      if (p.entitySubtypeCode === "01") return { x: 3.3, y: 8.6, z: 2.3 };
      if (p.entitySubtypeCode === "03") return { x: 3.8, y: 10.2, z: 2.55 };
      return base;
    }
    if (p.entityTypeCode === "03") {
      return { x: 3.43, y: 8.27, z: 3.12 };
    }
    if (p.entityTypeCode === "01") {
      if (p.entitySubtypeCode === "01") return { x: 3.6, y: 6.55, z: 2.98 };
      if (p.entitySubtypeCode === "02") return { x: 2.69, y: 4.93, z: 2.71 };
      if (p.entitySubtypeCode === "03") return { x: 2.69, y: 4.86, z: 2.5 };
      if (p.entitySubtypeCode === "04" || p.entitySubtypeCode === "07") return { x: 2.69, y: 4.86, z: 2.58 };
      if (p.entitySubtypeCode === "06" || p.entitySubtypeCode === "08") return { x: 3.25, y: 7.9, z: 3.0 };
      if (p.entitySubtypeCode === "09") return { x: 2.49, y: 7.8, z: 2.95 };
      if (p.entitySubtypeCode === "11") return { x: 2.5, y: 6.39, z: 2.69 };
      return { x: 2.72, y: 6.95, z: 2.64 };
    }
  }

  if (p.entityCode === "16") {
    if (p.entityTypeCode === "01") {
      if (p.entitySubtypeCode === "01") return { x: 1.78, y: 4.63, z: 1.44 };
      if (p.entitySubtypeCode === "02") return { x: 1.86, y: 4.97, z: 1.45 };
      if (p.entitySubtypeCode === "03") return { x: 1.84, y: 4.92, z: 1.45 };
      return { x: 1.84, y: 4.8, z: 1.45 };
    }
    if (p.entityTypeCode === "02") {
      if (p.entitySubtypeCode === "01") return { x: 2.03, y: 5.89, z: 1.96 };
      if (p.entitySubtypeCode === "02") return { x: 1.9, y: 5.4, z: 1.8 };
      if (p.entitySubtypeCode === "03") return { x: 2.03, y: 6.25, z: 2.0 };
      return { x: 2.0, y: 5.7, z: 1.9 };
    }
    if (p.entityTypeCode === "03") {
      if (p.entitySubtypeCode === "01") return { x: 2.03, y: 4.97, z: 1.96 };
      if (p.entitySubtypeCode === "02") return { x: 2.47, y: 5.98, z: 2.17 };
      if (p.entitySubtypeCode === "03") return { x: 2.59, y: 12.5, z: 3.05 };
      return { x: 2.2, y: 6.6, z: 2.4 };
    }
    if (p.entityTypeCode === "04") {
      if (p.entitySubtypeCode === "01") return { x: 1.865, y: 4.615, z: 1.742 };
      if (p.entitySubtypeCode === "02") return { x: 2.12, y: 6.2, z: 2.35 };
      if (p.entitySubtypeCode === "03") return { x: 2.55, y: 8.5, z: 3.4 };
      return { x: 2.0, y: 5.1, z: 1.9 };
    }
    if (p.entityTypeCode === "05") {
      if (p.entitySubtypeCode === "01") return { x: 1.8, y: 4.3, z: 1.8 };
      if (p.entitySubtypeCode === "02") return { x: 1.894, y: 4.882, z: 1.828 };
      if (p.entitySubtypeCode === "03") return { x: 2.01, y: 4.81, z: 1.85 };
      return { x: 1.9, y: 4.7, z: 1.82 };
    }
    if (p.entityTypeCode === "06") {
      if (p.entitySubtypeCode === "01") return { x: 2.55, y: 14.0, z: 3.8 };
      if (p.entitySubtypeCode === "02") return { x: 2.59, y: 18.0, z: 4.0 };
      if (p.entitySubtypeCode === "03") return { x: 2.59, y: 21.8, z: 4.11 };
      return { x: 2.59, y: 18.5, z: 4.0 };
    }
    if (p.entityTypeCode === "07") {
      if (p.entitySubtypeCode === "01") return { x: 2.55, y: 12.0, z: 3.6 };
      if (p.entitySubtypeCode === "02") return { x: 2.59, y: 16.0, z: 3.9 };
      if (p.entitySubtypeCode === "03") return { x: 2.59, y: 21.0, z: 4.1 };
      return { x: 2.59, y: 16.5, z: 3.9 };
    }
    if (p.entityTypeCode === "08") return { x: 2.03, y: 5.89, z: 1.96 };
    if (p.entityTypeCode === "09") return { x: 1.86, y: 4.97, z: 1.45 };
    return { x: 1.95, y: 5.2, z: 1.85 };
  }

  if (p.entityCode === "14") {
    if (p.entityTypeCode === "02") return { x: 2.35, y: 5.8, z: 2.5 }; // utility medical
    if (p.entityTypeCode === "03") return { x: 2.5, y: 6.7, z: 3.0 }; // evacuation
    if (p.entityTypeCode === "04") return { x: 1.95, y: 4.9, z: 1.65 }; // emergency physician rapid response
    if (p.entityTypeCode === "05") return { x: 2.55, y: 12.5, z: 3.05 }; // utility bus
    if (p.entityTypeCode === "06") {
      // Utility semi-trailer classes
      if (p.entitySubtypeCode === "01") return { x: 2.55, y: 16.0, z: 3.8 }; // tanker-like
      if (p.entitySubtypeCode === "02") return { x: 2.59, y: 17.0, z: 3.95 }; // dump/tipper-like
      if (p.entitySubtypeCode === "03") return { x: 2.59, y: 18.5, z: 3.75 }; // lowboy-like
      return { x: 2.59, y: 17.2, z: 3.9 };
    }
    if (p.entityTypeCode === "07" || p.entityTypeCode === "08") return { x: 2.5, y: 8.2, z: 3.1 }; // utility truck
    if (p.entityTypeCode === "09" || p.entityTypeCode === "10") return { x: 2.5, y: 8.5, z: 3.2 }; // POL/water
    if (p.entityTypeCode === "12") {
      if (p.entitySubtypeCode === "01") return { x: 2.35, y: 7.2, z: 2.95 }; // tow light
      if (p.entitySubtypeCode === "02") return { x: 2.55, y: 9.0, z: 3.35 }; // tow heavy
      return { x: 2.45, y: 8.1, z: 3.1 };
    }
    return { x: 2.45, y: 7.6, z: 3.0 };
  }

  if (p.entityCode === "17") {
    // Law-enforcement baseline (sedan/SUV-ish)
    if (p.entityTypeCode === "07") return { x: 1.9, y: 4.95, z: 1.55 };
    return { x: 1.95, y: 5.1, z: 1.72 };
  }

  if (p.entityCode === "23") {
    if (p.entityTypeCode === "01") return { x: 2.5, y: 6.7, z: 3.0 }; // ambulance
    if (p.entityTypeCode === "02") return { x: 2.55, y: 9.0, z: 3.4 }; // fire engine
    return { x: 2.5, y: 7.4, z: 3.1 };
  }

  if (p.entityCode === "13") return { x: 2.72, y: 6.95, z: 2.64 };
  if (p.entityCode === "19") return { x: 2.49, y: 7.8, z: 2.95 };
  return fallback;
}

export function buildVehicleHullAddonSpecs(
  sidc: string | undefined,
  hullSize: VehicleHullSize,
  baseBodyHeight?: number,
): VehicleHullAddonSpec[] {
  const p = parseSidcCoreParts(sidc);
  const top = (baseBodyHeight ?? hullSize.z) / 2;
  const specs: VehicleHullAddonSpec[] = [];

  if (!p.entityCode || p.entityCode === "12") return specs;

  if (p.entityCode === "13") {
    specs.push({ east: 0, north: 0.55 * hullSize.y * 0.2, up: top + (hullSize.z * 0.14), size: { x: hullSize.x * 0.58, y: hullSize.y * 0.36, z: hullSize.z * 0.28 } });
    return specs;
  }
  if (p.entityCode === "14") {
    if (p.entityTypeCode === "06" && p.entitySubtypeCode === "01") {
      // Utility semi tanker style: tractor + cylindrical tank trailer surrogate.
      specs.push({ east: 0, north: hullSize.y * 0.34, up: top + (hullSize.z * 0.18), size: { x: hullSize.x * 0.78, y: hullSize.y * 0.14, z: hullSize.z * 0.36 } });
      specs.push({ east: 0, north: hullSize.y * 0.12, up: top + (hullSize.z * 0.16), size: { x: hullSize.x * 0.86, y: hullSize.y * 0.16, z: hullSize.z * 0.32 }, alpha: 0.95 });
      specs.push({ east: 0, north: -(hullSize.y * 0.2), up: top + (hullSize.z * 0.14), size: { x: hullSize.x * 0.84, y: hullSize.y * 0.52, z: hullSize.z * 0.28 }, alpha: 0.94 });
      return specs;
    }
    if (p.entityTypeCode === "06" && p.entitySubtypeCode === "02") {
      // Dump/tipper semi style.
      specs.push({ east: 0, north: hullSize.y * 0.34, up: top + (hullSize.z * 0.2), size: { x: hullSize.x * 0.8, y: hullSize.y * 0.16, z: hullSize.z * 0.38 } });
      specs.push({ east: 0, north: hullSize.y * 0.1, up: top + (hullSize.z * 0.17), size: { x: hullSize.x * 0.86, y: hullSize.y * 0.16, z: hullSize.z * 0.32 }, alpha: 0.95 });
      specs.push({ east: 0, north: -(hullSize.y * 0.2), up: top + (hullSize.z * 0.15), size: { x: hullSize.x * 0.9, y: hullSize.y * 0.5, z: hullSize.z * 0.3 }, alpha: 0.94 });
      return specs;
    }
    if (p.entityTypeCode === "06" && p.entitySubtypeCode === "03") {
      // Lowboy/equipment transport style: raised neck + low deck.
      specs.push({ east: 0, north: hullSize.y * 0.34, up: top + (hullSize.z * 0.2), size: { x: hullSize.x * 0.8, y: hullSize.y * 0.16, z: hullSize.z * 0.38 } });
      specs.push({ east: 0, north: hullSize.y * 0.08, up: top + (hullSize.z * 0.12), size: { x: hullSize.x * 0.84, y: hullSize.y * 0.14, z: hullSize.z * 0.24 }, alpha: 0.95 });
      specs.push({ east: 0, north: -(hullSize.y * 0.22), up: top + (hullSize.z * 0.05), size: { x: hullSize.x * 0.9, y: hullSize.y * 0.5, z: hullSize.z * 0.1 }, alpha: 0.92 });
      return specs;
    }
    if (p.entityTypeCode === "12") {
      // Tow truck light/heavy.
      specs.push({ east: 0, north: hullSize.y * 0.2, up: top + (hullSize.z * 0.18), size: { x: hullSize.x * 0.76, y: hullSize.y * 0.3, z: hullSize.z * 0.36 } });
      specs.push({ east: 0, north: -(hullSize.y * 0.02), up: top + (hullSize.z * 0.12), size: { x: hullSize.x * 0.84, y: hullSize.y * 0.32, z: hullSize.z * 0.24 }, alpha: 0.95 });
      if (p.entitySubtypeCode === "02") {
        specs.push({ east: 0, north: -(hullSize.y * 0.2), up: top + (hullSize.z * 0.22), size: { x: hullSize.x * 0.62, y: hullSize.y * 0.18, z: hullSize.z * 0.44 }, alpha: 0.96 });
        specs.push({ east: 0, north: -(hullSize.y * 0.34), up: top + (hullSize.z * 0.12), size: { x: hullSize.x * 0.5, y: hullSize.y * 0.12, z: hullSize.z * 0.24 }, alpha: 0.94 });
      } else {
        specs.push({ east: 0, north: -(hullSize.y * 0.26), up: top + (hullSize.z * 0.12), size: { x: hullSize.x * 0.46, y: hullSize.y * 0.14, z: hullSize.z * 0.22 }, alpha: 0.93 });
      }
      return specs;
    }
    if (p.entityTypeCode === "02" || p.entityTypeCode === "03") {
      // Utility medical / evacuation (cab + module).
      specs.push({ east: 0, north: hullSize.y * 0.24, up: top + (hullSize.z * 0.18), size: { x: hullSize.x * 0.74, y: hullSize.y * 0.24, z: hullSize.z * 0.36 } });
      specs.push({ east: 0, north: -(hullSize.y * 0.08), up: top + (hullSize.z * 0.2), size: { x: hullSize.x * 0.86, y: hullSize.y * 0.52, z: hullSize.z * 0.4 }, alpha: 0.95 });
      return specs;
    }
    if (p.entityTypeCode === "04") {
      // Emergency physician rapid response + light bar.
      specs.push({ east: 0, north: hullSize.y * 0.08, up: top + (hullSize.z * 0.18), size: { x: hullSize.x * 0.78, y: hullSize.y * 0.46, z: hullSize.z * 0.34 } });
      specs.push({ east: 0, north: 0, up: top + (hullSize.z * 0.33), size: { x: hullSize.x * 0.34, y: hullSize.y * 0.08, z: hullSize.z * 0.06 }, alpha: 0.98 });
      return specs;
    }
    specs.push({ east: 0, north: -hullSize.y * 0.18, up: top + (hullSize.z * 0.16), size: { x: hullSize.x * 0.72, y: hullSize.y * 0.44, z: hullSize.z * 0.32 } });
    specs.push({ east: 0, north: hullSize.y * 0.24, up: top + (hullSize.z * 0.12), size: { x: hullSize.x * 0.42, y: hullSize.y * 0.22, z: hullSize.z * 0.24 }, alpha: 0.95 });
    return specs;
  }
  if (p.entityCode === "16") {
    if (p.entityTypeCode === "01") {
      // Civilian automobile family: hood + cabin + rear deck/hatch.
      specs.push({ east: 0, north: hullSize.y * 0.28, up: top + (hullSize.z * 0.09), size: { x: hullSize.x * 0.8, y: hullSize.y * 0.24, z: hullSize.z * 0.18 } });
      specs.push({ east: 0, north: hullSize.y * 0.02, up: top + (hullSize.z * 0.2), size: { x: hullSize.x * 0.82, y: hullSize.y * 0.42, z: hullSize.z * 0.36 }, alpha: 0.96 });
      if (p.entitySubtypeCode === "03") {
        specs.push({ east: 0, north: -(hullSize.y * 0.24), up: top + (hullSize.z * 0.08), size: { x: hullSize.x * 0.74, y: hullSize.y * 0.28, z: hullSize.z * 0.16 }, alpha: 0.94 });
      } else if (p.entitySubtypeCode === "01") {
        specs.push({ east: 0, north: -(hullSize.y * 0.22), up: top + (hullSize.z * 0.11), size: { x: hullSize.x * 0.72, y: hullSize.y * 0.24, z: hullSize.z * 0.2 }, alpha: 0.94 });
      } else {
        specs.push({ east: 0, north: -(hullSize.y * 0.2), up: top + (hullSize.z * 0.1), size: { x: hullSize.x * 0.72, y: hullSize.y * 0.24, z: hullSize.z * 0.18 }, alpha: 0.94 });
      }
      return specs;
    }
    if (p.entityTypeCode === "02") {
      // Pickup/open-bed trucks: hood + cab + low open bed.
      specs.push({ east: 0, north: hullSize.y * 0.3, up: top + (hullSize.z * 0.1), size: { x: hullSize.x * 0.82, y: hullSize.y * 0.22, z: hullSize.z * 0.2 } });
      specs.push({ east: 0, north: hullSize.y * 0.08, up: top + (hullSize.z * 0.2), size: { x: hullSize.x * 0.84, y: hullSize.y * 0.28, z: hullSize.z * 0.38 }, alpha: 0.96 });
      if (p.entitySubtypeCode === "03") {
        specs.push({ east: 0, north: -(hullSize.y * 0.24), up: top + (hullSize.z * 0.06), size: { x: hullSize.x * 0.9, y: hullSize.y * 0.5, z: hullSize.z * 0.12 }, alpha: 0.92 });
      } else if (p.entitySubtypeCode === "02") {
        specs.push({ east: 0, north: -(hullSize.y * 0.2), up: top + (hullSize.z * 0.06), size: { x: hullSize.x * 0.88, y: hullSize.y * 0.46, z: hullSize.z * 0.12 }, alpha: 0.92 });
      } else {
        specs.push({ east: 0, north: -(hullSize.y * 0.18), up: top + (hullSize.z * 0.06), size: { x: hullSize.x * 0.86, y: hullSize.y * 0.4, z: hullSize.z * 0.12 }, alpha: 0.92 });
      }
      return specs;
    }
    if (p.entityTypeCode === "03") {
      // Vans/buses: front cap + dominant passenger box + optional rear cap.
      specs.push({ east: 0, north: hullSize.y * 0.3, up: top + (hullSize.z * 0.12), size: { x: hullSize.x * 0.86, y: hullSize.y * 0.2, z: hullSize.z * 0.24 } });
      specs.push({ east: 0, north: -(hullSize.y * 0.02), up: top + (hullSize.z * 0.2), size: { x: hullSize.x * 0.94, y: hullSize.y * 0.62, z: hullSize.z * 0.38 }, alpha: 0.95 });
      if (p.entitySubtypeCode === "03") {
        specs.push({ east: 0, north: -(hullSize.y * 0.32), up: top + (hullSize.z * 0.16), size: { x: hullSize.x * 0.9, y: hullSize.y * 0.18, z: hullSize.z * 0.3 }, alpha: 0.94 });
      }
      return specs;
    }
    if (p.entityTypeCode === "04") {
      if (p.entitySubtypeCode === "01") {
        // SUV: hood + tall cabin + hatch cap.
        specs.push({ east: 0, north: hullSize.y * 0.28, up: top + (hullSize.z * 0.1), size: { x: hullSize.x * 0.82, y: hullSize.y * 0.22, z: hullSize.z * 0.2 } });
        specs.push({ east: 0, north: hullSize.y * 0.02, up: top + (hullSize.z * 0.22), size: { x: hullSize.x * 0.9, y: hullSize.y * 0.5, z: hullSize.z * 0.42 }, alpha: 0.96 });
        specs.push({ east: 0, north: -(hullSize.y * 0.24), up: top + (hullSize.z * 0.1), size: { x: hullSize.x * 0.84, y: hullSize.y * 0.2, z: hullSize.z * 0.18 }, alpha: 0.94 });
        return specs;
      }
      if (p.entitySubtypeCode === "02") {
        // Small box truck: cab + short cargo box.
        specs.push({ east: 0, north: hullSize.y * 0.3, up: top + (hullSize.z * 0.18), size: { x: hullSize.x * 0.78, y: hullSize.y * 0.24, z: hullSize.z * 0.34 } });
        specs.push({ east: 0, north: -(hullSize.y * 0.08), up: top + (hullSize.z * 0.22), size: { x: hullSize.x * 0.96, y: hullSize.y * 0.56, z: hullSize.z * 0.44 }, alpha: 0.95 });
        return specs;
      }
      // Large box truck: cab + long dominant cargo box.
      specs.push({ east: 0, north: hullSize.y * 0.34, up: top + (hullSize.z * 0.18), size: { x: hullSize.x * 0.78, y: hullSize.y * 0.2, z: hullSize.z * 0.34 } });
      specs.push({ east: 0, north: -(hullSize.y * 0.1), up: top + (hullSize.z * 0.22), size: { x: hullSize.x * 0.98, y: hullSize.y * 0.64, z: hullSize.z * 0.46 }, alpha: 0.95 });
      return specs;
    }
    if (p.entityTypeCode === "05") {
      // Jeep family: blunt hood + upright cabin + short tailgate block.
      specs.push({ east: 0, north: hullSize.y * 0.3, up: top + (hullSize.z * 0.1), size: { x: hullSize.x * 0.84, y: hullSize.y * 0.2, z: hullSize.z * 0.2 } });
      specs.push({ east: 0, north: hullSize.y * 0.02, up: top + (hullSize.z * 0.22), size: { x: hullSize.x * 0.88, y: hullSize.y * 0.5, z: hullSize.z * 0.4 }, alpha: 0.96 });
      specs.push({ east: 0, north: -(hullSize.y * 0.24), up: top + (hullSize.z * 0.1), size: { x: hullSize.x * 0.8, y: hullSize.y * 0.2, z: hullSize.z * 0.2 }, alpha: 0.94 });
      return specs;
    }
    if (p.entityTypeCode === "06" || p.entityTypeCode === "07") {
      // Tractor trailers: nose + cab + neck + trailer (boxed or flatbed deck).
      specs.push({ east: 0, north: hullSize.y * 0.42, up: top + (hullSize.z * 0.1), size: { x: hullSize.x * 0.78, y: hullSize.y * 0.12, z: hullSize.z * 0.2 } });
      specs.push({ east: 0, north: hullSize.y * 0.25, up: top + (hullSize.z * 0.2), size: { x: hullSize.x * 0.82, y: hullSize.y * 0.14, z: hullSize.z * 0.36 }, alpha: 0.96 });
      specs.push({ east: 0, north: hullSize.y * 0.08, up: top + (hullSize.z * 0.1), size: { x: hullSize.x * 0.68, y: hullSize.y * 0.08, z: hullSize.z * 0.16 }, alpha: 0.92 });
      if (p.entityTypeCode === "06") {
        specs.push({ east: 0, north: -(hullSize.y * 0.06), up: top + (hullSize.z * 0.18), size: { x: hullSize.x * 0.96, y: hullSize.y * 0.28, z: hullSize.z * 0.34 }, alpha: 0.93 });
        specs.push({ east: 0, north: -(hullSize.y * 0.35), up: top + (hullSize.z * 0.18), size: { x: hullSize.x * 0.96, y: hullSize.y * 0.24, z: hullSize.z * 0.34 }, alpha: 0.93 });
      } else {
        specs.push({ east: 0, north: -(hullSize.y * 0.06), up: top + (hullSize.z * 0.05), size: { x: hullSize.x * 0.92, y: hullSize.y * 0.28, z: hullSize.z * 0.08 }, alpha: 0.9 });
        specs.push({ east: 0, north: -(hullSize.y * 0.35), up: top + (hullSize.z * 0.05), size: { x: hullSize.x * 0.92, y: hullSize.y * 0.24, z: hullSize.z * 0.08 }, alpha: 0.9 });
      }
      return specs;
    }
    if (p.entityTypeCode === "08") {
      // Fallback utility-style civilian truck.
      specs.push({ east: 0, north: hullSize.y * 0.26, up: top + (hullSize.z * 0.16), size: { x: hullSize.x * 0.78, y: hullSize.y * 0.24, z: hullSize.z * 0.32 } });
      specs.push({ east: 0, north: -(hullSize.y * 0.08), up: top + (hullSize.z * 0.2), size: { x: hullSize.x * 0.9, y: hullSize.y * 0.48, z: hullSize.z * 0.38 }, alpha: 0.95 });
      return specs;
    }
    if (p.entityTypeCode === "09") {
      specs.push({ east: 0, north: hullSize.y * 0.26, up: top + (hullSize.z * 0.1), size: { x: hullSize.x * 0.78, y: hullSize.y * 0.22, z: hullSize.z * 0.18 } });
      specs.push({ east: 0, north: hullSize.y * 0.02, up: top + (hullSize.z * 0.2), size: { x: hullSize.x * 0.82, y: hullSize.y * 0.42, z: hullSize.z * 0.34 }, alpha: 0.96 });
      specs.push({ east: 0, north: -(hullSize.y * 0.22), up: top + (hullSize.z * 0.1), size: { x: hullSize.x * 0.7, y: hullSize.y * 0.22, z: hullSize.z * 0.2 }, alpha: 0.94 });
      return specs;
    }
  }
  if (p.entityCode === "19") {
    specs.push({ east: 0, north: hullSize.y * 0.24, up: top + (hullSize.z * 0.18), size: { x: hullSize.x * 0.84, y: hullSize.y * 0.28, z: hullSize.z * 0.36 } });
    specs.push({ east: 0, north: -hullSize.y * 0.09, up: top + (hullSize.z * 0.14), size: { x: hullSize.x * 0.9, y: hullSize.y * 0.5, z: hullSize.z * 0.28 }, alpha: 0.96 });
    return specs;
  }
  if (p.entityCode === "17") {
    // Law-enforcement: patrol sedan/SUV profile with roof light bar.
    specs.push({ east: 0, north: hullSize.y * 0.26, up: top + (hullSize.z * 0.1), size: { x: hullSize.x * 0.8, y: hullSize.y * 0.24, z: hullSize.z * 0.2 } });
    specs.push({ east: 0, north: hullSize.y * 0.04, up: top + (hullSize.z * 0.2), size: { x: hullSize.x * 0.84, y: hullSize.y * 0.42, z: hullSize.z * 0.34 }, alpha: 0.96 });
    if (p.entityTypeCode === "07") {
      specs.push({ east: 0, north: -(hullSize.y * 0.2), up: top + (hullSize.z * 0.1), size: { x: hullSize.x * 0.66, y: hullSize.y * 0.2, z: hullSize.z * 0.2 }, alpha: 0.94 });
    } else {
      specs.push({ east: 0, north: -(hullSize.y * 0.16), up: top + (hullSize.z * 0.12), size: { x: hullSize.x * 0.8, y: hullSize.y * 0.22, z: hullSize.z * 0.2 }, alpha: 0.94 });
    }
    specs.push({ east: 0, north: 0, up: top + (hullSize.z * 0.33), size: { x: hullSize.x * 0.34, y: hullSize.y * 0.08, z: hullSize.z * 0.06 }, alpha: 0.99 });
    return specs;
  }
  if (p.entityCode === "23") {
    if (p.entityTypeCode === "01") {
      // Ambulance: cab + dominant patient box + optional roof strip.
      specs.push({ east: 0, north: hullSize.y * 0.24, up: top + (hullSize.z * 0.18), size: { x: hullSize.x * 0.74, y: hullSize.y * 0.24, z: hullSize.z * 0.34 } });
      specs.push({ east: 0, north: -(hullSize.y * 0.08), up: top + (hullSize.z * 0.22), size: { x: hullSize.x * 0.88, y: hullSize.y * 0.56, z: hullSize.z * 0.44 }, alpha: 0.95 });
      specs.push({ east: 0, north: -(hullSize.y * 0.06), up: top + (hullSize.z * 0.42), size: { x: hullSize.x * 0.46, y: hullSize.y * 0.26, z: hullSize.z * 0.06 }, alpha: 0.97 });
      return specs;
    }
    if (p.entityTypeCode === "02") {
      // Fire engine: cab + long body + raised hose-bed rear cap.
      specs.push({ east: 0, north: hullSize.y * 0.26, up: top + (hullSize.z * 0.2), size: { x: hullSize.x * 0.76, y: hullSize.y * 0.24, z: hullSize.z * 0.38 } });
      specs.push({ east: 0, north: -(hullSize.y * 0.02), up: top + (hullSize.z * 0.16), size: { x: hullSize.x * 0.9, y: hullSize.y * 0.46, z: hullSize.z * 0.32 }, alpha: 0.95 });
      specs.push({ east: 0, north: -(hullSize.y * 0.26), up: top + (hullSize.z * 0.24), size: { x: hullSize.x * 0.72, y: hullSize.y * 0.22, z: hullSize.z * 0.48 }, alpha: 0.96 });
      return specs;
    }
    specs.push({ east: 0, north: -hullSize.y * 0.12, up: top + (hullSize.z * 0.15), size: { x: hullSize.x * 0.82, y: hullSize.y * 0.54, z: hullSize.z * 0.3 } });
    specs.push({ east: 0, north: hullSize.y * 0.24, up: top + (hullSize.z * 0.1), size: { x: hullSize.x * 0.52, y: hullSize.y * 0.2, z: hullSize.z * 0.2 }, alpha: 0.94 });
    return specs;
  }

  specs.push({
    east: 0,
    north: 0,
    up: top + (hullSize.z * 0.12),
    size: { x: hullSize.x * 0.7, y: hullSize.y * 0.34, z: hullSize.z * 0.24 },
    alpha: 0.96,
  });
  return specs;
}

export function resolveVehicleBaseBodyHeightForSidc(
  sidc: string | undefined,
  hullSize: VehicleHullSize,
): number {
  const p = parseSidcCoreParts(sidc);
  if (!p.entityCode) return hullSize.z;

  // Keep armored families full-height on primary hull because they already split elsewhere.
  if (p.entityCode === "12") return hullSize.z;

  if (p.entityCode === "16") {
    // Civilian: low chassis with stronger upper-body blocks.
    if (p.entityTypeCode === "06" || p.entityTypeCode === "07") return hullSize.z * 0.3;
    if (p.entityTypeCode === "03" || p.entityTypeCode === "04") return hullSize.z * 0.34;
    return hullSize.z * 0.32;
  }
  if (p.entityCode === "14") {
    // Utility vehicles and trucks.
    if (p.entityTypeCode === "06") return hullSize.z * 0.32;
    if (p.entityTypeCode === "12") return hullSize.z * 0.35;
    return hullSize.z * 0.38;
  }
  if (p.entityCode === "17") return hullSize.z * 0.34;
  if (p.entityCode === "23") return hullSize.z * 0.36;
  if (p.entityCode === "19") return hullSize.z * 0.4;
  if (p.entityCode === "13") return hullSize.z * 0.4;

  return hullSize.z;
}
