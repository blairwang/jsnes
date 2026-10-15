import { vi } from "vitest";
import Screen from "../../../src/browser/screen.js";

it("can clean up after React has already detached the canvas", () => {
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue({
      getImageData: () => ({ data: new Uint8ClampedArray(256 * 240 * 4) }),
      fillRect: vi.fn(),
    });
  const host = document.createElement("div");
  const screen = new Screen(host);
  host.replaceChildren();
  expect(() => screen.destroy()).not.toThrow();
  expect(() => screen.destroy()).not.toThrow();
  expect(() => screen.fitInParent()).not.toThrow();
  getContext.mockRestore();
});
