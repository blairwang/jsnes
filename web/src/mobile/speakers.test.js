import { vi } from "vitest";
import Speakers from "../../../src/browser/speakers.js";

describe("audio lifecycle during ROM changes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not attach an audio node when paused during worklet loading", async () => {
    let finishLoading;
    const close = vi.fn(async () => {});
    vi.stubGlobal(
      "AudioContext",
      class {
        audioWorklet = {
          addModule: () =>
            new Promise((resolve) => {
              finishLoading = resolve;
            }),
        };
        close = close;
      },
    );
    const createNode = vi.fn();
    vi.stubGlobal("AudioWorkletNode", createNode);
    vi.stubGlobal("URL", {
      createObjectURL: () => "blob:test",
      revokeObjectURL: vi.fn(),
    });
    const speakers = new Speakers({ onBufferUnderrun: vi.fn() });
    const starting = speakers.start();
    speakers.stop();
    finishLoading();
    await starting;
    expect(close).toHaveBeenCalledTimes(1);
    expect(createNode).not.toHaveBeenCalled();
    expect(speakers.audioCtx).toBeNull();
  });
});
