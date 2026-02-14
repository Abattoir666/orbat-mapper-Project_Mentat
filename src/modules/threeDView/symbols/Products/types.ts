export type ProductDimensions = {
  x: number;
  y: number;
  z: number;
};

export type ProductOffset = {
  east: number;
  north: number;
  up: number;
};

export type ProductPartBox = {
  kind: "box";
  id: string;
  size: ProductDimensions;
  offset: ProductOffset;
  alpha?: number;
};

export type ProductPart = ProductPartBox;

export type ProductFootprint = {
  halfWidthMeters: number;
  halfLengthMeters: number;
  headingRad?: number;
};

export type ProductDescriptor = {
  cacheKey: string;
  baseSize: ProductDimensions;
  parts: ProductPart[];
  footprint: ProductFootprint;
};
