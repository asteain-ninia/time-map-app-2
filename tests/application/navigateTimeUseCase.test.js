// Tests authored by Codex.
import { describe, expect, it } from "vitest";
import { NavigateTimeUseCase } from "../../src/application/usecases/NavigateTimeUseCase.js";
import { TimeService } from "../../src/domain/services/TimeService.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";
import { FeatureAnchor } from "../../src/domain/value-objects/FeatureAnchor.js";

describe("NavigateTimeUseCase", () => {
  const timeService = new TimeService();
  const useCase = new NavigateTimeUseCase(timeService);

  const makeFeature = (...years) => ({
    anchors: years.map((year, index) => new FeatureAnchor({
      id: `anchor-${year}-${index}`,
      timeRange: { start: new TimePoint(year), end: null },
      property: { name: `N${year}`, description: "", attributes: {} },
      shape: { type: "Point", vertexId: "v1" },
      placement: { layerId: "layer-1" }
    }))
  });

  it("initializes with default time and allows direct moves", () => {
    expect(useCase.getCurrentTime().year).toBe(0);

    const moved = useCase.moveToTime(1500, 6, 1);
    expect(moved.year).toBe(1500);
    expect(moved.month).toBe(6);
    expect(moved.day).toBe(1);
  });

  it("advances and retreats time via TimeService", () => {
    useCase.moveToTime(2000, 1, 1);

    const advanced = useCase.advanceTime(60);
    expect(advanced.year).toBe(2000);
    expect(advanced.month).toBe(3);
    expect(advanced.day).toBe(1);

    const retreated = useCase.retreatTime(30);
    expect(retreated.year).toBe(2000);
    expect(retreated.month).toBe(1);
    expect(retreated.day).toBe(31);
  });

  it("retreats more than a year without double borrowing", () => {
    useCase.moveToTime(2000, null, null);

    const retreated = useCase.retreatTime(400);
    expect(retreated.year).toBe(1999);
    expect(retreated.month).toBeNull();
    expect(retreated.day).toBeNull();
  });
  it("advances months with calendar-aware adjustments", () => {
    useCase.moveToTime(2000, 1, 31);

    const advanced = useCase.advanceMonths(1);
    expect(advanced.year).toBe(2000);
    expect(advanced.month).toBe(2);
    expect(advanced.day).toBe(29);
  });

  it("moves to next significant property time", () => {
    useCase.moveToTime(1000);
    const features = [makeFeature(900, 1050), makeFeature(1200)];

    const next = useCase.moveToNextSignificantTime(features);
    expect(next.year).toBe(1050);
  });

  it("moves to previous significant property time", () => {
    useCase.moveToTime(1500);
    const features = [makeFeature(1200, 1400), makeFeature(1300)];

    const prev = useCase.moveToPreviousSignificantTime(features);
    expect(prev.year).toBe(1400);
  });

  it("keeps current time when no future or past points exist", () => {
    useCase.moveToTime(1800);
    const features = [makeFeature(1000, 1700)];

    const next = useCase.moveToNextSignificantTime(features);
    expect(next.year).toBe(1800);

    const prev = useCase.moveToPreviousSignificantTime(features);
    expect(prev.year).toBe(1700);
  });
});
