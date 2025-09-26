// Tests authored by Codex.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileSystem } from "../../src/infrastructure/persistence/FileSystem.js";

const clearGlobals = () => {
  if ("window" in globalThis) {
    // @ts-ignore - test cleanup
    delete globalThis.window;
  }
  if ("localStorage" in globalThis) {
    // @ts-ignore - test cleanup
    delete globalThis.localStorage;
  }
};

describe("FileSystem", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearGlobals();
  });

  afterEach(() => {
    clearGlobals();
    vi.useRealTimers();
  });

  it("reads a file via the Electron bridge when available", async () => {
    const readFileMock = vi.fn().mockResolvedValue("data-from-electron");
    vi.stubGlobal("window", { electron: { fs: { readFile: readFileMock } } });

    const fileSystem = new FileSystem();
    const content = await fileSystem.readFile("world.json");

    expect(readFileMock).toHaveBeenCalledWith("world.json", "utf8");
    expect(content).toBe("data-from-electron");
  });

  it("reads a file from localStorage as a fallback", async () => {
    const storage = new Map([["world.json", "cached-world"]]);
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key) => storage.get(key) ?? null),
      setItem: vi.fn(),
      removeItem: vi.fn()
    });

    const fileSystem = new FileSystem();
    const content = await fileSystem.readFile("world.json");

    expect(globalThis.localStorage.getItem).toHaveBeenCalledWith("world.json");
    expect(content).toBe("cached-world");
  });

  it("throws when no storage backend is available", async () => {
    vi.stubGlobal("window", {});

    const fileSystem = new FileSystem();
    await expect(fileSystem.readFile("world.json")).rejects.toThrow(
      /Failed to read file: File system not available/
    );
  });

  it("writes a file via the Electron bridge", async () => {
    const writeFileMock = vi.fn().mockResolvedValue();
    vi.stubGlobal("window", { electron: { fs: { writeFile: writeFileMock } } });

    const fileSystem = new FileSystem();
    await fileSystem.writeFile("world.json", "updated");

    expect(writeFileMock).toHaveBeenCalledWith("world.json", "updated", "utf8");
  });

  it("writes a file into localStorage when Electron is unavailable", async () => {
    const storage = new Map();
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key) => storage.get(key) ?? null),
      setItem: vi.fn((key, value) => storage.set(key, value)),
      removeItem: vi.fn()
    });

    const fileSystem = new FileSystem();
    await fileSystem.writeFile("world.json", "updated");

    expect(globalThis.localStorage.setItem).toHaveBeenCalledWith("world.json", "updated");
    expect(storage.get("world.json")).toBe("updated");
  });

  it("checks file existence via the Electron bridge", async () => {
    const existsMock = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("window", { electron: { fs: { exists: existsMock } } });

    const fileSystem = new FileSystem();
    const exists = await fileSystem.fileExists("world.json");

    expect(existsMock).toHaveBeenCalledWith("world.json");
    expect(exists).toBe(true);
  });

  it("checks file existence in localStorage", async () => {
    const storage = new Map([["world.json", "cached"]]);
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key) => storage.get(key) ?? null)
    });

    const fileSystem = new FileSystem();
    const exists = await fileSystem.fileExists("world.json");

    expect(globalThis.localStorage.getItem).toHaveBeenCalledWith("world.json");
    expect(exists).toBe(true);
  });

  it("delegates directory creation to the Electron bridge when present", async () => {
    const mkdirMock = vi.fn().mockResolvedValue();
    vi.stubGlobal("window", { electron: { fs: { mkdir: mkdirMock } } });

    const fileSystem = new FileSystem();
    await fileSystem.makeDirectory("backups");

    expect(mkdirMock).toHaveBeenCalledWith("backups", { recursive: true });
  });

  it("creates a timestamped backup and prunes old generations", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-02T03:04:05.678Z"));

    const path = require("path");
    const fsModule = require("fs");
    const baseDir = path.join("project", "data");
    const filePath = path.join(baseDir, "world.json");
    const backupDir = path.join(baseDir, "backups");
    const expectedName = "world.json.2025-01-02T03-04-05-678Z.bak";
    const expectedBackupPath = path.join(backupDir, expectedName);

    const fileSystem = new FileSystem();
    const readSpy = vi.spyOn(fileSystem, "readFile").mockResolvedValue("original-world");
    const writeSpy = vi.spyOn(fileSystem, "writeFile").mockResolvedValue();
    const makeDirSpy = vi.spyOn(fileSystem, "makeDirectory").mockResolvedValue();

    vi.spyOn(fsModule, "existsSync").mockReturnValue(false);
    vi.spyOn(fsModule, "readdirSync").mockReturnValue([
      expectedName,
      "world.json.2025-01-01T03-00-00-000Z.bak",
      "world.json.2024-12-31T23-59-59-000Z.bak",
      "world.json.2024-12-30T23-59-59-000Z.bak",
      "world.json.2024-12-29T23-59-59-000Z.bak",
      "world.json.2024-12-28T23-59-59-000Z.bak",
      "world.json.2024-12-27T23-59-59-000Z.bak"
    ]);
    const unlinkSpy = vi.spyOn(fsModule, "unlinkSync").mockImplementation(() => {});

    const backupPath = await fileSystem.createBackup(filePath);

    expect(makeDirSpy).toHaveBeenCalledWith(backupDir);
    expect(readSpy).toHaveBeenCalledWith(filePath);
    expect(writeSpy).toHaveBeenCalledWith(expectedBackupPath, "original-world");
    expect(backupPath).toBe(expectedBackupPath);

    const pruned = unlinkSpy.mock.calls.map((args) => path.basename(args[0]));
    expect(pruned).toEqual(
      expect.arrayContaining([
        "world.json.2024-12-28T23-59-59-000Z.bak",
        "world.json.2024-12-27T23-59-59-000Z.bak"
      ])
    );
  });
});
