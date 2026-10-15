import { GameGenie } from "jsnes";
import { applyCheats, parseCheat } from "./cheats";

describe("mobile cheats", () => {
  it("decodes valid Game Genie codes and masks CPU ROM addresses", () => {
    expect(parseCheat("sx iopo")).toEqual({
      type: "rom",
      ...new GameGenie().decode("SXIOPO"),
    });
    expect(parseCheat("FFFF:FE?12")).toEqual({
      type: "rom",
      addr: 0x7fff,
      value: 0xfe,
      key: 0x12,
    });
    expect(parseCheat("ROM:8000:FF").addr).toBe(0);
  });

  it("separates per-frame RAM locks from cartridge patches", () => {
    const nes = { gameGenie: new GameGenie() };
    const ram = applyCheats(nes, [
      { code: "RAM:00FF:09", enabled: true },
      { code: "8001:FF", enabled: true },
      { code: "8002:01", enabled: false },
    ]);
    expect(ram).toEqual([{ type: "ram", addr: 0xff, value: 9 }]);
    expect(nes.gameGenie.applyCodes(0x8001, 0)).toBe(0xff);
    expect(nes.gameGenie.applyCodes(0x8002, 0)).toBe(0);
    applyCheats(nes, []);
    expect(nes.gameGenie.patches).toHaveLength(0);
  });

  it.each([
    "",
    "ABCDEF",
    "APZLG",
    "APZLGITYE",
    "8000:100",
    "prefix8000:01",
    "7000:01",
    "RAM:0800:01",
    "RAM:0000:01?02",
  ])("rejects malformed or unsafe input %s", (code) => {
    expect(() => parseCheat(code)).toThrow();
  });

  it("leaves active cheats intact if a replacement is invalid", () => {
    const nes = { gameGenie: new GameGenie() };
    applyCheats(nes, [{ code: "8000:12", enabled: true }]);
    expect(() =>
      applyCheats(nes, [{ code: "invalid", enabled: true }]),
    ).toThrow();
    expect(nes.gameGenie.applyCodes(0x8000, 0)).toBe(0x12);
  });
});
