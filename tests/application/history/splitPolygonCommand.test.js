import { describe, expect, it } from "vitest";
import { SplitPolygonCommand } from "../../../src/application/services/history/commands/SplitPolygonCommand.js";

class InMemoryWorldRepository {
  constructor(world) {
    this._world = world;
  }

  async getWorld() {
    return this._world;
  }

  async saveWorld(world) {
    this._world = world;
  }
}

describe("SplitPolygonCommand additional feature patch", () => {
  it("applies and restores additional feature changes on redo/undo", async () => {
    const worldRepository = new InMemoryWorldRepository({
      features: [
        { id: "poly-1", rev: "before" },
        { id: "poly-rival", rev: "before" }
      ],
      vertices: [],
      layers: []
    });
    const serializer = {
      serialize: value => value,
      deserialize: value => value
    };
    const command = new SplitPolygonCommand(
      {
        polygonId: "poly-1",
        originalPolygonData: { id: "poly-1", rev: "before" },
        updatedPolygonData: { id: "poly-1", rev: "after" },
        newPolygonData: { id: "poly-2", rev: "new" },
        addedVerticesData: [],
        additionalFeatureChanges: [
          {
            featureId: "poly-rival",
            beforeFeatureData: { id: "poly-rival", rev: "before" },
            afterFeatureData: { id: "poly-rival", rev: "after" }
          }
        ]
      },
      {},
      worldRepository,
      serializer
    );

    const executeResult = await command.execute();
    const worldAfterExecute = await worldRepository.getWorld();
    expect(worldAfterExecute.features).toEqual(
      expect.arrayContaining([
        { id: "poly-1", rev: "after" },
        { id: "poly-2", rev: "new" },
        { id: "poly-rival", rev: "after" }
      ])
    );
    expect(executeResult.updatedFeatures).toEqual([{ id: "poly-rival", rev: "after" }]);

    const reverseResult = await command.reverse();
    const worldAfterReverse = await worldRepository.getWorld();
    expect(worldAfterReverse.features).toEqual(
      expect.arrayContaining([
        { id: "poly-1", rev: "before" },
        { id: "poly-rival", rev: "before" }
      ])
    );
    expect(worldAfterReverse.features.some(feature => feature.id === "poly-2")).toBe(false);
    expect(reverseResult.updatedFeatures).toEqual([{ id: "poly-rival", rev: "before" }]);
  });
});
