import { describe, expect, it } from "vitest";
import { MapViewRendererHelper } from "../../src/presentation/views/map/MapViewRendererHelper.js";

const createHelper = () =>
  new MapViewRendererHelper(
    {}, // renderer
    {}, // viewModel
    {}, // editingViewModel
    {}, // viewportManager
    {}  // configManager
  );

describe("MapViewRendererHelper._unwrapLongitudeSequence", () => {
  it("returns the same coordinates when longitudes stay within +/-180°", () => {
    const helper = createHelper();
    const sequence = [
      { x: 10, y: 0 },
      { x: 20, y: 1 },
      { x: 30, y: 2 }
    ];

    const result = helper._unwrapLongitudeSequence(sequence);

    expect(result).toEqual(sequence);
  });

  it("adjusts longitudes that wrap from +180° to negative values", () => {
    const helper = createHelper();
    const sequence = [
      { x: 179, y: 0 },
      { x: 179.5, y: 0.2 },
      { x: 180, y: 0.4 },
      { x: -179.5, y: 0.6 },
      { x: -179, y: 0.8 }
    ];

    const result = helper._unwrapLongitudeSequence(sequence);

    expect(result.map((point) => point.x)).toEqual([
      179,
      179.5,
      180,
      180.5,
      181
    ]);
  });

  it("adjusts longitudes that wrap from -180° to positive values", () => {
    const helper = createHelper();
    const sequence = [
      { x: -170, y: 0 },
      { x: -179, y: -0.2 },
      { x: 179, y: -0.4 },
      { x: 178, y: -0.6 }
    ];

    const result = helper._unwrapLongitudeSequence(sequence);

    expect(result.map((point) => point.x)).toEqual([
      -170,
      -179,
      -181,
      -182
    ]);
  });
});

