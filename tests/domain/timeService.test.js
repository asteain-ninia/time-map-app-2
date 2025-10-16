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

  it("retreats days across month boundaries", () => {
    const service = new TimeService();
    const start = new TimePoint(2000, 3, 1);

    const retreated = service.advanceDays(start, -1);
    expect(retreated.year).toBe(2000);
    expect(retreated.month).toBe(2);
    expect(retreated.day).toBe(29);
  });

  it("retreats days across year boundaries", () => {
    const service = new TimeService();
    const start = new TimePoint(2000, 1, 5);

    const retreated = service.advanceDays(start, -10);
    expect(retreated.year).toBe(1999);
    expect(retreated.month).toBe(12);
    expect(retreated.day).toBe(26);
  });

  it("does not borrow a whole year when retreating less than one year on coarse time points", () => {
    const service = new TimeService();
    const start = new TimePoint(1200);

    const retreated = service.advanceDays(start, -1);
    expect(retreated.year).toBe(1200);
    expect(retreated.month).toBeNull();
    expect(retreated.day).toBeNull();
  });

  it("advances to the next year once coarse time points receive roughly a year's worth of days", () => {
    const service = new TimeService();
    const start = new TimePoint(1200);
    const approxYearDays = Math.floor(service.calendarConfig.daysPerYear);

    const advanced = service.advanceDays(start, approxYearDays);
    expect(advanced.year).toBe(1201);
    expect(advanced.month).toBeNull();
    expect(advanced.day).toBeNull();
  });

  it("advances months forward across year boundaries", () => {
    const service = new TimeService();
    const start = new TimePoint(-1, 12, 10);

    const advanced = service.advanceMonths(start, 1);
    expect(advanced.year).toBe(0);
    expect(advanced.month).toBe(1);
    expect(advanced.day).toBe(10);
  });

  it("retreats months across year boundaries without double decrementing years", () => {
    const service = new TimeService();
    const start = new TimePoint(0, 1, 15);

    const retreated = service.advanceMonths(start, -1);
    expect(retreated.year).toBe(-1);
    expect(retreated.month).toBe(12);
    expect(retreated.day).toBe(15);
  });

  it("retreats many months while keeping month index consistent", () => {
    const service = new TimeService();
    const start = new TimePoint(0, 1, 10);

    const retreated = service.advanceMonths(start, -13);
    expect(retreated.year).toBe(-2);
    expect(retreated.month).toBe(12);
    expect(retreated.day).toBe(10);
  });

  it("clamps the day when advancing months to shorter periods", () => {
    const service = new TimeService();
    const start = new TimePoint(2023, 1, 31);

    const advanced = service.advanceMonths(start, 1);
    expect(advanced.year).toBe(2023);
    expect(advanced.month).toBe(2);
    expect(advanced.day).toBe(28);
  });

  it("clamps the day when retreating months to shorter periods, including leap years", () => {
    const service = new TimeService();
    const start = new TimePoint(2020, 3, 31);

    const retreated = service.advanceMonths(start, -1);
    expect(retreated.year).toBe(2020);
    expect(retreated.month).toBe(2);
    expect(retreated.day).toBe(29);
  });

  it("calculates span when month/day are unspecified", () => {
    const service = new TimeService();
    const start = new TimePoint(1000);
    const end = new TimePoint(1005);

    const result = service.calculateDaysBetween(start, end);
    expect(result).toBeCloseTo(5 * service.calendarConfig.daysPerYear, 5);
  });

  it("advances negative days for coarse time points", () => {
    const service = new TimeService();
    const start = new TimePoint(1200);

    const moved = service.advanceDays(start, -400);
    expect(moved.year).toBe(1198);
    expect(moved.month).toBeNull();
    expect(moved.day).toBeNull();
  });
});
