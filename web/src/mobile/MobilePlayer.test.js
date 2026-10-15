import { readFileSync } from "node:fs";
import { vi } from "vitest";
import MobilePlayer from "./MobilePlayer";

vi.mock("../../../src/browser/screen.js", () => ({
  default: class {
    setBuffer = vi.fn();
    writeBuffer = vi.fn();
    fitInParent = vi.fn();
    destroy = vi.fn();
  },
}));
vi.mock("../../../src/browser/speakers.js", () => ({
  default: class {
    start = vi.fn(async () => {});
    stop = vi.fn();
    writeSample = vi.fn();
    flush = vi.fn();
  },
}));

describe("mobile emulation clock", () => {
  let player;
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const bytes = readFileSync("public/roms/croom/croom.nes");
    player = new MobilePlayer(
      document.createElement("div"),
      new Uint8Array(bytes),
      vi.fn(),
    );
    vi.spyOn(player.nes, "frame").mockImplementation(() => {});
  });
  afterEach(() => {
    player?.destroy();
    vi.unstubAllGlobals();
  });

  it("runs four times as many frames at 4x and silences audio", () => {
    player.start();
    player.tick(100);
    player.tick(200);
    const normal = player.nes.frame.mock.calls.length;
    player.stop();
    player.nes.frame.mockClear();
    player.setSpeed(4);
    player.start();
    player.tick(300);
    player.tick(400);
    expect(player.nes.frame.mock.calls.length).toBeGreaterThanOrEqual(
      normal * 4,
    );
    expect(player.speakers.start).toHaveBeenCalledTimes(1);
  });

  it("does not advance frames after pause and releases held buttons", () => {
    player.start();
    player.nes.buttonDown(1, 0);
    player.stop();
    player.tick(100);
    expect(player.nes.frame).not.toHaveBeenCalled();
    expect(player.nes.controllers[1].state[0]).toBe(0x40);
  });

  it("writes RAM locks before every simulated frame", () => {
    player.setCheats([{ code: "RAM:00FF:09", enabled: true }]);
    player.nes.frame.mockImplementation(() => {
      expect(player.nes.cpu.mem[0xff]).toBe(9);
      player.nes.cpu.mem[0xff] = 0;
    });
    player.start();
    player.tick(0);
    player.tick(100);
    expect(player.nes.frame).toHaveBeenCalledTimes(6);
  });
});
