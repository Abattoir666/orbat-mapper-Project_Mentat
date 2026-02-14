import { describe, expect, it } from "vitest";
import { createProductAggregator } from "./productAggregator";

describe("ProductAggregator", () => {
  it("caches by key", () => {
    const agg = createProductAggregator<number>();
    let builds = 0;
    const a = agg.getOrCreate("k", () => {
      builds += 1;
      return 42;
    });
    const b = agg.getOrCreate("k", () => {
      builds += 1;
      return 7;
    });
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(builds).toBe(1);
  });

  it("can clear cache", () => {
    const agg = createProductAggregator<number>();
    agg.getOrCreate("x", () => 1);
    agg.clear();
    expect(agg.get("x")).toBeUndefined();
  });
});
