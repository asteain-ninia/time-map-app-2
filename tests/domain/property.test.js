// Tests authored by Codex.
import { describe, it, expect } from "vitest";
import { Property } from "../../src/domain/value-objects/Property.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";

describe("Property", () => {
  it("uses provided time bounds to evaluate activity", () => {
    const start = new TimePoint(1800, 1, 1);
    const end = new TimePoint(1850, 12, 31);
    const property = new Property(start, "Edo", "Capital era", { status: "active" }, start, end);

    expect(property.isActiveAt(new TimePoint(1820, 5, 1))).toBe(true);
    expect(property.isActiveAt(new TimePoint(1850, 12, 31))).toBe(false);
    expect(property.isActiveAt(new TimePoint(1799, 12, 31))).toBe(false);
  });

  it("falls back to startTime or year zero when timePoint is invalid", () => {
    const fallbackStart = new TimePoint(500);
    const derived = new Property(null, "Myth", "Legend", {}, fallbackStart, null);
    const zeroBased = new Property(undefined, "Unknown", "", {});

    expect(derived.timePoint.equals(fallbackStart)).toBe(true);
    expect(zeroBased.timePoint.equals(new TimePoint(0))).toBe(true);
  });

  it("compares structural equality including attributes", () => {
    const start = new TimePoint(1945);
    const attributes = { owner: "Codex" };
    const first = new Property(start, "Era", "Post-war", attributes, start, null);
    const second = new Property(start, "Era", "Post-war", attributes, start, null);

    expect(first.equals(second)).toBe(true);
    expect(first.getAttribute("owner")).toBe("Codex");
    expect(first.withDescription("Modernization").equals(second)).toBe(false);
  });
});
