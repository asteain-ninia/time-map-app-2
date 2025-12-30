import { describe, expect, it } from "vitest";
import { MapViewRendererHelper } from "../../src/presentation/views/map/MapViewRendererHelper.js";
import { editingStyles } from "../../src/infrastructure/rendering/RenderStyleProvider.js";

const createRenderer = () => {
  const drawLineCalls = [];
  const renderer = {
    drawLine: (points, style, viewport) => {
      drawLineCalls.push({ points, style, viewport });
      return null;
    },
    drawPoint: () => null,
    drawText: () => null,
    removeElement: () => {},
    getWorldWidth: () => 360
  };

  return { renderer, drawLineCalls };
};

const createViewModel = (gcPoints) => ({
  calculateGreatCirclePath: () => gcPoints,
  calculateDistance: () => ({ linear: 0, greatCircle: 0 }),
  getEquatorLength: () => 40000
});

const createHelper = (gcPoints) => {
  const { renderer, drawLineCalls } = createRenderer();
  const viewModel = createViewModel(gcPoints);
  const viewportManager = { getViewport: () => ({ zoom: 1 }) };
  const helper = new MapViewRendererHelper(
    renderer,
    viewModel,
    {},
    viewportManager,
    {}
  );

  return { helper, drawLineCalls };
};

const collectGreatCircleLineX = (gcPoints) => {
  const { helper, drawLineCalls } = createHelper(gcPoints);

  helper.renderDistanceMeasurement(
    [
      { x: 0, y: 0 },
      { x: 1, y: 1 }
    ],
    true
  );

  return drawLineCalls
    .filter(call => call.style === editingStyles.greatCircleLine)
    .map(call => call.points.map(point => point.x));
};

describe("MapViewRendererHelper.renderDistanceMeasurement", () => {
  it("keeps longitudes unchanged when they stay within +/-180", () => {
    const sequence = [
      { x: 10, y: 0 },
      { x: 20, y: 1 },
      { x: 30, y: 2 }
    ];

    const sequences = collectGreatCircleLineX(sequence);

    expect(sequences).toContainEqual([10, 20, 30]);
  });

  it("unwraps longitudes that wrap from +180 to negative values", () => {
    const sequence = [
      { x: 179, y: 0 },
      { x: 179.5, y: 0.2 },
      { x: 180, y: 0.4 },
      { x: -179.5, y: 0.6 },
      { x: -179, y: 0.8 }
    ];

    const sequences = collectGreatCircleLineX(sequence);

    expect(sequences).toContainEqual([179, 179.5, 180, 180.5, 181]);
  });

  it("unwraps longitudes that wrap from -180 to positive values", () => {
    const sequence = [
      { x: -170, y: 0 },
      { x: -179, y: -0.2 },
      { x: 179, y: -0.4 },
      { x: 178, y: -0.6 }
    ];

    const sequences = collectGreatCircleLineX(sequence);

    expect(sequences).toContainEqual([-170, -179, -181, -182]);
  });
});
