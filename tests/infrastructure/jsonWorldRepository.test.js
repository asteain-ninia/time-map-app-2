// Tests authored by Codex.
import { describe, expect, it, vi } from "vitest";
import { JSONWorldRepository } from "../../src/infrastructure/persistence/JSONWorldRepository.js";

const createRepository = () => {
  const fileSystem = {
    fileExists: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    createBackup: vi.fn()
  };
  const serializer = {
    deserialize: vi.fn(),
    serialize: vi.fn()
  };

  const repository = new JSONWorldRepository(fileSystem, serializer, "test-world.json");
  return { repository, fileSystem, serializer };
};

describe("JSONWorldRepository", () => {
  it("loads an existing world and caches it", async () => {
    const { repository, fileSystem, serializer } = createRepository();
    const worldData = { layers: [], vertices: [], features: [], metadata: {} };
    fileSystem.fileExists.mockResolvedValue(true);
    fileSystem.readFile.mockResolvedValue("raw-data");
    serializer.deserialize.mockReturnValue(worldData);

    const first = await repository.getWorld();
    expect(fileSystem.fileExists).toHaveBeenCalledWith("test-world.json");
    expect(fileSystem.readFile).toHaveBeenCalledWith("test-world.json");
    expect(serializer.deserialize).toHaveBeenCalledWith("raw-data");
    expect(first).toBe(worldData);

    fileSystem.readFile.mockClear();
    const second = await repository.getWorld();
    expect(second).toBe(worldData);
    expect(fileSystem.readFile).not.toHaveBeenCalled();
  });

  it("creates an empty world when storage is missing", async () => {
    const { repository, fileSystem, serializer } = createRepository();
    fileSystem.fileExists.mockResolvedValue(false);

    const world = await repository.getWorld();

    expect(serializer.deserialize).not.toHaveBeenCalled();
    expect(world.layers).toHaveLength(1);
    expect(world.features).toHaveLength(0);
    expect(world.metadata?.settings?.equatorLength).toBe(40000);
  });

  it("saves the world, creating a backup when a file exists", async () => {
    const { repository, fileSystem, serializer } = createRepository();
    fileSystem.fileExists.mockResolvedValue(true);
    serializer.serialize.mockReturnValue("serialized-world");

    const world = { id: "cached" };
    await repository.saveWorld(world);

    expect(fileSystem.fileExists).toHaveBeenCalledWith("test-world.json");
    expect(fileSystem.createBackup).toHaveBeenCalledWith("test-world.json");
    expect(serializer.serialize).toHaveBeenCalledWith(world);
    expect(fileSystem.writeFile).toHaveBeenCalledWith("test-world.json", "serialized-world");

    const cached = await repository.getWorld();
    expect(cached).toBe(world);
  });
});
