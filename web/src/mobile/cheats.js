import { GameGenie } from "jsnes";

export function parseCheat(input) {
  const code = input.trim().toUpperCase().replace(/\s+/g, "");
  if (/^(?:[APZLGITYEOXUKSVN]{6}|[APZLGITYEOXUKSVN]{8})$/.test(code)) {
    return { type: "rom", ...new GameGenie().decode(code) };
  }
  const match =
    /^(RAM:|ROM:)?([0-9A-F]{4}):([0-9A-F]{2})(?:\?([0-9A-F]{2}))?$/.exec(code);
  if (!match)
    throw new Error(
      "请输入 6/8 位 Game Genie 或地址:数值，例如 8000:FF、RAM:00FF:09",
    );
  const address = parseInt(match[2], 16);
  const value = parseInt(match[3], 16);
  const key = match[4] ? parseInt(match[4], 16) : undefined;
  const type =
    match[1] === "RAM:" || (!match[1] && address <= 0x7ff) ? "ram" : "rom";
  if (type === "ram") {
    if (address > 0x7ff || key !== undefined)
      throw new Error("RAM 锁定支持 0000–07FF，不支持比较值");
    return { type, addr: address, value };
  }
  if (address < 0x8000) throw new Error("ROM 地址范围为 8000–FFFF");
  return { type, addr: address & 0x7fff, value, key };
}

export function applyCheats(nes, cheats) {
  // Validate the full list before replacing currently active patches.
  const patches = cheats
    .filter((item) => item.enabled)
    .map((item) => parseCheat(item.code));
  nes.gameGenie.removeAllCodes();
  nes.gameGenie.setEnabled(true);
  for (const patch of patches.filter((item) => item.type === "rom")) {
    nes.gameGenie.addPatch(patch.addr, patch.value, patch.key);
  }
  return patches.filter((item) => item.type === "ram");
}
