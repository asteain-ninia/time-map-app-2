// Tests authored by Codex.
import { describe, expect, it, vi } from "vitest";
import {
  getLineStyle,
  getPointStyle,
  getPolygonStyle
} from "../../src/infrastructure/rendering/RenderStyleProvider.js";
import { LayerService } from "../../src/domain/services/LayerService.js";
import { Property } from "../../src/domain/value-objects/Property.js";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";

const createProperty = (styleOverrides = null) => {
  const attributes = styleOverrides ? { styleOverrides } : {};
  return new Property(new TimePoint(0), "Feature", "", attributes, new TimePoint(0), null);
};

describe("RenderStyleProvider", () => {
  it("returns default style when style overrides are absent", () => {
    const service = new LayerService();
    const property = createProperty();

    const pointStyle = getPointStyle(service, property);
    const lineStyle = getLineStyle(service, property);
    const polygonStyle = getPolygonStyle(service, property);

    expect(pointStyle).toMatchObject({
      radius: 5,
      fill: "#3388ff",
      stroke: "#000000",
      strokeWidth: 1
    });
    expect(lineStyle).toMatchObject({
      stroke: "#3388ff",
      strokeWidth: 3
    });
    expect(polygonStyle).toMatchObject({
      fill: "#ffcc88",
      stroke: "#ff8800",
      strokeWidth: 3
    });
  });

  it("merges direct styleOverrides into feature styles", () => {
    const service = new LayerService();
    const property = createProperty({
      fill: "#123456",
      stroke: "#654321",
      strokeWidth: 7,
      fillOpacity: 0.33,
      showLabel: false
    });

    const polygonStyle = getPolygonStyle(service, property);

    expect(polygonStyle.fill).toBe("#123456");
    expect(polygonStyle.stroke).toBe("#654321");
    expect(polygonStyle.strokeWidth).toBe(7);
    expect(polygonStyle.fillOpacity).toBe(0.33);
    expect(polygonStyle.showLabel).toBe(false);
    expect(polygonStyle.textColor).toBe("#000000");
  });

  it("supports feature-type specific overrides", () => {
    const service = new LayerService();
    const property = createProperty({
      point: {
        radius: 11,
        fill: "#00aa00"
      },
      line: {
        stroke: "#aa0000",
        strokeDasharray: "2,1"
      }
    });

    const pointStyle = getPointStyle(service, property);
    const lineStyle = getLineStyle(service, property);
    const polygonStyle = getPolygonStyle(service, property);

    expect(pointStyle.radius).toBe(11);
    expect(pointStyle.fill).toBe("#00aa00");
    expect(lineStyle.stroke).toBe("#aa0000");
    expect(lineStyle.strokeDasharray).toBe("2,1");
    expect(polygonStyle.fill).toBe("#ffcc88");
  });

  it("ignores invalid styleOverrides values", () => {
    const service = new LayerService();
    const property = createProperty("not-an-object");

    const lineStyle = getLineStyle(service, property);

    expect(lineStyle.stroke).toBe("#3388ff");
    expect(lineStyle.strokeWidth).toBe(3);
  });

  it("resolves base style without referencing layer-specific style objects", () => {
    const getLayerStyle = vi.fn((featureType) => ({
      featureType,
      stroke: "#000000",
      strokeWidth: 3
    }));
    const layerServiceLike = { getLayerStyle };
    const property = createProperty({ stroke: "#ff00ff" });

    const style = getLineStyle(layerServiceLike, property);

    expect(getLayerStyle).toHaveBeenCalledWith("line");
    expect(style.stroke).toBe("#ff00ff");
  });
});
