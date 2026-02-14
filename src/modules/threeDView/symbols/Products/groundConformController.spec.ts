import { describe, expect, it } from "vitest";
import { computeGroundAnchorHeightMeters, computeGroundConformPose } from "./groundConformController";

describe("computeGroundAnchorHeightMeters", () => {
  it("uses highest corner when footprint is provided", () => {
    const sampler = (lonDeg: number, latDeg: number) => {
      if (lonDeg > 10 && latDeg > 10) return 120;
      return 100;
    };
    const h = computeGroundAnchorHeightMeters(sampler, {
      lonDeg: 10,
      latDeg: 10,
      footprint: {
        halfWidthMeters: 60_000,
        halfLengthMeters: 60_000,
      },
      clearanceMeters: 0.1,
    });
    expect(h).toBe(120.1);
  });

  it("falls back to center sample without footprint", () => {
    const sampler = () => 33;
    const h = computeGroundAnchorHeightMeters(sampler, {
      lonDeg: 0,
      latDeg: 0,
      clearanceMeters: 0.5,
    });
    expect(h).toBe(33.5);
  });

  it("returns pitch/roll pose for sloped terrain", () => {
    const sampler = (lonDeg: number, latDeg: number) => 100 + lonDeg * 2 + latDeg;
    const pose = computeGroundConformPose(sampler, {
      lonDeg: 10,
      latDeg: 10,
      footprint: {
        halfWidthMeters: 10_000,
        halfLengthMeters: 10_000,
      },
      clearanceMeters: 0.25,
    });
    expect(Number.isFinite(pose.anchorHeightMeters)).toBe(true);
    expect(Number.isFinite(pose.pitchRad)).toBe(true);
    expect(Number.isFinite(pose.rollRad)).toBe(true);
    expect(pose.anchorHeightMeters).toBeGreaterThan(0);
  });
});
