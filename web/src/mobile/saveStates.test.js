import { IDBFactory } from "fake-indexeddb";
import { vi } from "vitest";
import {
  createSave,
  gameDirectory,
  listSaves,
  readSave,
  renameSave,
  timestampName,
  validateSaveName,
} from "./saveStates";

const game = { key: "a".repeat(64), name: "超级玛丽.nes" };
const state = (value) => ({ cpu: { value }, ppu: {}, papu: {}, mmap: {} });

describe("multiple save files", () => {
  let oldStorage;
  beforeEach(() => {
    oldStorage = new Map();
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.spyOn(localStorage, "getItem").mockImplementation(
      (key) => oldStorage.get(key) ?? null,
    );
    vi.spyOn(localStorage, "removeItem").mockImplementation((key) =>
      oldStorage.delete(key),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates separate timestamp files even when two saves share a millisecond", async () => {
    const now = new Date(2026, 9, 15, 14, 30, 1, 5).getTime();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const first = await createSave(game, state(1));
    const second = await createSave(game, state(2));
    expect(first.path).toBe("超级玛丽/2026-10-15_14-30-01-005.jsnes.json");
    expect(second.id).not.toBe(first.id);
    expect(await readSave(game, first.id)).toEqual(state(1));
    expect(await readSave(game, second.id)).toEqual(state(2));
  });

  it("keeps many saves and lists only this ROM, newest first, even after renaming the ROM", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => ++now);
    for (let value = 0; value < 120; value++)
      await createSave(game, state(value));
    await createSave({ ...game, key: "b".repeat(64) }, state("other ROM"));
    const { saves } = await listSaves({ ...game, name: "改名后的游戏.nes" });
    expect(saves).toHaveLength(120);
    expect(saves[0].createdAt).toBeGreaterThan(saves[119].createdAt);
    expect(await readSave(game, saves[0].id)).toEqual(state(119));
  });

  it("renames the file while preserving its state and original save time", async () => {
    const original = await createSave(game, state(7));
    const renamed = await renameSave(game, original.id, "第二关 Boss 前");
    expect(renamed.path).toBe("超级玛丽/第二关 Boss 前.jsnes.json");
    expect(renamed.createdAt).toBe(original.createdAt);
    expect(await readSave(game, renamed.id)).toEqual(state(7));
    await expect(readSave(game, original.id)).rejects.toThrow();
    expect((await listSaves(game)).saves).toHaveLength(1);
  });

  it("refuses duplicate names or another ROM's save without changing either file", async () => {
    const first = await createSave(game, state(1));
    const second = await createSave(game, state(2));
    const renamed = await renameSave(game, first.id, "通关前");
    await expect(renameSave(game, second.id, "通关前")).rejects.toThrow("同名");
    await expect(
      readSave({ ...game, key: "b".repeat(64) }, renamed.id),
    ).rejects.toThrow("不匹配");
    await expect(
      renameSave({ ...game, key: "b".repeat(64) }, second.id, "覆盖"),
    ).rejects.toThrow("不匹配");
    expect(await readSave(game, second.id)).toEqual(state(2));
  });

  it("migrates the old single slot once and preserves it alongside new saves", async () => {
    const key = `jsnes-state-${game.key}`;
    oldStorage.set(key, JSON.stringify({ version: 1, state: state("legacy") }));
    const { saves } = await listSaves(game);
    expect(saves).toHaveLength(1);
    expect(saves[0].legacy).toBe(true);
    expect(await readSave(game, saves[0].id)).toEqual(state("legacy"));
    expect(oldStorage.has(key)).toBe(false);
    await createSave(game, state("new"));
    expect((await listSaves(game)).saves).toHaveLength(2);
  });

  it("can retry migration after cleanup fails without duplicating the old save", async () => {
    const key = `jsnes-state-${game.key}`;
    oldStorage.set(key, JSON.stringify({ version: 1, state: state("legacy") }));
    localStorage.removeItem.mockImplementationOnce(() => {
      throw new Error("interrupted");
    });
    await expect(listSaves(game)).rejects.toThrow("interrupted");
    expect(oldStorage.has(key)).toBe(true);
    expect((await listSaves(game)).saves).toHaveLength(1);
  });

  it("retains the old slot if storage fails during migration", async () => {
    const key = `jsnes-state-${game.key}`;
    oldStorage.set(key, JSON.stringify({ version: 1, state: state("legacy") }));
    vi.stubGlobal("indexedDB", {
      open() {
        throw new Error("storage unavailable");
      },
    });
    await expect(listSaves(game)).rejects.toThrow("storage unavailable");
    expect(oldStorage.has(key)).toBe(true);
  });

  it.each([
    "",
    "..",
    "../覆盖",
    "foo/bar",
    "foo\\bar",
    "bad:name",
    "a\nfile",
    "a".repeat(61),
  ])("rejects invalid file name %j", (name) => {
    expect(() => validateSaveName(name)).toThrow();
  });

  it("uses safe game directory names and preserves the save extension", () => {
    expect(gameDirectory("folder/game?.NES")).toBe("folder_game_");
    expect(gameDirectory("..")).toBe("未命名游戏");
    expect(validateSaveName("第一关.jsnes.json")).toBe("第一关");
    expect(timestampName(new Date(2026, 0, 2, 3, 4, 5, 6))).toBe(
      "2026-01-02_03-04-05-006",
    );
  });
});
