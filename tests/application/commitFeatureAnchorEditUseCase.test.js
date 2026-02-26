// Tests authored by Codex.
import { describe, expect, it, vi } from "vitest";
import { TimePoint } from "../../src/domain/value-objects/TimePoint.js";
import { CommitFeatureAnchorEditUseCase } from "../../src/application/usecases/feature/CommitFeatureAnchorEditUseCase.js";

describe("CommitFeatureAnchorEditUseCase", () => {
  it("forwards resolvedAnchorsByFeature to update payload when conflicts exist", async () => {
    const editTime = new TimePoint(1200);
    const resolvedAnchorsByFeature = {
      "point-1": [{ id: "anchor-point-1" }],
      "point-2": [{ id: "anchor-point-2" }]
    };
    const conflictResolutions = {
      "polygon-overlap:point-1::point-2:1200:null:null": { preferFeatureId: "point-1" }
    };

    const draftStore = {
      get: vi.fn(() => ({
        draftId: "draft-1",
        featureId: "point-1",
        status: "ready_to_commit",
        editTime,
        draftPatch: {
          startTime: new TimePoint(1200),
          endTime: null,
          name: "Edited",
          description: "edited"
        },
        affectedTimeRange: { start: new TimePoint(1200), end: null },
        conflicts: [{ id: "conflict-1" }],
        conflictResolutions,
        resolvedAnchorsByFeature
      })),
      delete: vi.fn()
    };
    const updateFeatureUseCase = {
      execute: vi.fn(async () => ({
        feature: { id: "point-1" },
        updatedFeatures: [{ id: "point-1" }, { id: "point-2" }]
      }))
    };
    const useCase = new CommitFeatureAnchorEditUseCase(updateFeatureUseCase, draftStore);

    const result = await useCase.execute({ draftId: "draft-1" });

    expect(updateFeatureUseCase.execute).toHaveBeenCalledTimes(1);
    expect(updateFeatureUseCase.execute).toHaveBeenCalledWith("point-1", {
      propertyEdit: expect.objectContaining({
        editTime,
        conflictResolutions,
        resolvedAnchorsByFeature
      })
    });
    expect(result.updatedFeatures.map(feature => feature.id).sort()).toEqual(["point-1", "point-2"]);
    expect(draftStore.delete).toHaveBeenCalledWith("draft-1");
  });

  it("keeps commit payload minimal when no conflicts exist", async () => {
    const editTime = new TimePoint(1000);
    const draftStore = {
      get: vi.fn(() => ({
        draftId: "draft-2",
        featureId: "point-1",
        status: "ready_to_commit",
        editTime,
        draftPatch: {
          startTime: new TimePoint(1000),
          endTime: null,
          name: "Edited",
          description: "edited"
        },
        affectedTimeRange: null,
        conflicts: [],
        conflictResolutions: null,
        resolvedAnchorsByFeature: null
      })),
      delete: vi.fn()
    };
    const updateFeatureUseCase = {
      execute: vi.fn(async () => ({
        feature: { id: "point-1" },
        updatedFeatures: [{ id: "point-1" }]
      }))
    };
    const useCase = new CommitFeatureAnchorEditUseCase(updateFeatureUseCase, draftStore);

    await useCase.execute({ draftId: "draft-2" });

    const payload = updateFeatureUseCase.execute.mock.calls[0][1].propertyEdit;
    expect(payload.conflictResolutions).toBeUndefined();
    expect(payload.resolvedAnchorsByFeature).toBeUndefined();
    expect(draftStore.delete).toHaveBeenCalledWith("draft-2");
  });
});
