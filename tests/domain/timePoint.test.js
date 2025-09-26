// Tests authored by Codex.
import { describe, it, expect } from "vitest";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";

describe("TimePoint", () => {
  it("compares by year, month, and day", () => {
    const early = new TimePoint(1200);
    const middle = new TimePoint(1200, 5);
    const late = new TimePoint(1200, 5, 20);

    expect(early.isBefore(middle)).toBe(true);
    expect(middle.isBefore(late)).toBe(true);
    expect(late.isAfter(middle)).toBe(true);
    expect(late.isAfter(early)).toBe(true);
    expect(early.isAfter(late)).toBe(false);
  });

  it("treats null month or day as the earliest possible value", () => {
    const broad = new TimePoint(1500);
    const detailed = new TimePoint(1500, 1, 1);

    expect(broad.isBefore(detailed)).toBe(true);
    expect(detailed.isBefore(broad)).toBe(false);
  });

  it("creates modified copies without mutating the original", () => {
    const original = new TimePoint(1610, 4, 23);
    const withYear = original.withYear(1700);
    const withMonth = original.withMonth(12);
    const withDay = original.withDay(1);

    expect(original.year).toBe(1610);
    expect(withYear.year).toBe(1700);
    expect(withMonth.month).toBe(12);
    expect(withDay.day).toBe(1);
    expect(original.equals(new TimePoint(1610, 4, 23))).toBe(true);
  });

  it("formats as a Japanese date when month and day are present", () => {
    const point = new TimePoint(2024, 3, 15);
    expect(point.toString()).toBe("2024年3月15日");
  });
});
