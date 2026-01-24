// Created by Codex
import { describe, expect, it } from "vitest";
import { SVGRenderer } from "../../src/infrastructure/rendering/SVGRenderer.js";

const createRenderer = (worldWidth = 360) => {
  const renderer = Object.create(SVGRenderer.prototype);
  renderer._backgroundTransform = { worldWidth };
  return renderer;
};

describe("SVGRenderer.getRenderOffsets", () => {
  it("returns only the base offset when the viewBox stays within one world", () => {
    const renderer = createRenderer();
    const offsets = renderer.getRenderOffsets({ x: 0, y: 0, width: 100, height: 100, zoom: 1 });

    expect(offsets).toEqual([0]);
  });

  it("includes the left neighbor when the viewBox crosses the base offset", () => {
    const renderer = createRenderer();
    const offsets = renderer.getRenderOffsets({ x: 200, y: 0, width: 400, height: 100, zoom: 1 });

    expect(offsets).toEqual([0, 360]);
  });
});
