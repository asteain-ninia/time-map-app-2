// Tests authored by Codex.
import { describe, expect, it } from "vitest";
import { TimeService } from "../../src/domain/services/TimeService.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";

describe("TimeService", () => {
  it("exposes calendar configuration and allows updates", () => {
    const service = new TimeService();
    expect(service.calendarConfig.monthsPerYear).toBe(12);

    service.updateCalendarConfig({ monthsPerYear: 10, daysPerYear: 300 });
    expect(service.calendarConfig.monthsPerYear).toBe(10);
    expect(service.calendarConfig.daysPerYear).toBe(300);
  });

  it("determines whether a time point lies within a range", () => {
    const service = new TimeService();
    const start = new TimePoint(1500, 1, 1);
    const end = new TimePoint(1600, 1, 1);

    expect(service.isWithinRange(new TimePoint(1550, 6, 1), start, end)).toBe(true);
    expect(service.isWithinRange(new TimePoint(1500, 1, 1), start, end)).toBe(true);
    expect(service.isWithinRange(new TimePoint(1600, 1, 1), start, end)).toBe(false);
  });

  it("calculates days between two time points respecting months and leap years", () => {
    const service = new TimeService();
    const janFirst = new TimePoint(2000, 1, 1);
    const febFirst = new TimePoint(2000, 2, 1);
    const marchFirst = new TimePoint(2001, 3, 1);

    expect(service.calculateDaysBetween(janFirst, febFirst)).toBe(31);
    // 2000 is leap year -> February has 29 days
    expect(service.calculateDaysBetween(febFirst, new TimePoint(2000, 3, 1))).toBe(29);
    expect(Math.round(service.calculateDaysBetween(janFirst, marchFirst))).toBeGreaterThan(365);
  });

  it("advances days across month and year boundaries", () => {
    const service = new TimeService();
    const start = new TimePoint(1999, 12, 30);

    const advanced = service.advanceDays(start, 5);
    expect(advanced.year).toBe(2000);
    expect(advanced.month).toBe(1);
    expect(advanced.day).toBe(4);
  });
});
