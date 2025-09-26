// Tests authored by Codex.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ConfigManager } from "../../src/infrastructure/services/ConfigManager.js";

const createLocalStorageStub = () => {
  let store = {};
  return {
    getItem: vi.fn(key => (key in store ? store[key] : null)),
    setItem: vi.fn((key, value) => {
      store[key] = value;
    }),
    removeItem: vi.fn(key => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    })
  };
};

describe("ConfigManager", () => {
  let localStorageStub;

  beforeEach(() => {
    localStorageStub = createLocalStorageStub();
    vi.stubGlobal("localStorage", localStorageStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("loads defaults when no stored config exists", () => {
    const manager = new ConfigManager("config-test", { ui: { rightPanelWidth: 180 } });

    expect(localStorageStub.getItem).toHaveBeenCalledWith("config-test");
    expect(manager.get("ui.rightPanelWidth")).toBe(180);
    expect(manager.get("autoSave.enabled")).toBe(true);
  });

  it("merges stored config over defaults", () => {
    localStorageStub.getItem.mockReturnValue(
      JSON.stringify({ ui: { darkMode: true }, autoSave: { enabled: false } })
    );

    const manager = new ConfigManager("config-test");

    expect(manager.get("ui.darkMode")).toBe(true);
    expect(manager.get("autoSave.enabled")).toBe(false);
    expect(manager.get("ui.rightPanelWidth")).toBe(300); // default keeps in place
  });

  it("updates sections and persists to storage", () => {
    const manager = new ConfigManager("config-test");

    manager.updateSection("ui", { rightPanelWidth: 420 });

    expect(manager.get("ui.rightPanelWidth")).toBe(420);
    expect(localStorageStub.setItem).toHaveBeenLastCalledWith(
      "config-test",
      expect.stringContaining("\"rightPanelWidth\":420")
    );
  });

  it("sets nested values via dot path and saves", () => {
    const manager = new ConfigManager("config-test");

    manager.set("calendar.daysPerYear", 400);

    expect(manager.get("calendar.daysPerYear")).toBe(400);
    expect(localStorageStub.setItem).toHaveBeenLastCalledWith(
      "config-test",
      expect.stringContaining("\"daysPerYear\":400")
    );
  });

  it("resets to defaults for entire config and for sections", () => {
    const manager = new ConfigManager("config-test");

    manager.updateSection("ui", { darkMode: true, rightPanelWidth: 999 });
    expect(manager.get("ui.darkMode")).toBe(true);

    manager.reset("ui");
    expect(manager.get("ui.darkMode")).toBe(false);
    expect(manager.get("ui.rightPanelWidth")).toBe(300);

    manager.set("map.zoomMax", 20);
    manager.reset();
    expect(manager.get("map.zoomMax")).toBe(10);
  });
});
