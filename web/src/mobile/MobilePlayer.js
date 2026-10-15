import { Controller, NES } from "jsnes";
import Screen from "../../../src/browser/screen.js";
import Speakers from "../../../src/browser/speakers.js";
import { applyCheats } from "./cheats";

const FRAME_MS = 1000 / 60.098;

export default class MobilePlayer {
  constructor(container, data, onError) {
    this.data = data;
    this.speed = 1;
    this.muted = false;
    this.running = false;
    this.cheats = [];
    this.ramPatches = [];
    this.screen = new Screen(container);
    // This player uses a single clock: audio underruns must never advance it.
    this.speakers = new Speakers({ onBufferUnderrun: () => {} });
    this.nes = new NES({
      sampleRate: 44100,
      onFrame: this.screen.setBuffer,
      onAudioSample: (left, right) => this.speakers.writeSample(left, right),
    });
    try {
      this.nes.loadROM(data);
    } catch (error) {
      this.screen.destroy();
      throw error;
    }
    this.onError = onError;
    this.keys = {
      ArrowUp: Controller.BUTTON_UP,
      ArrowDown: Controller.BUTTON_DOWN,
      ArrowLeft: Controller.BUTTON_LEFT,
      ArrowRight: Controller.BUTTON_RIGHT,
      KeyX: Controller.BUTTON_A,
      KeyZ: Controller.BUTTON_B,
      KeyS: Controller.BUTTON_TURBO_A,
      KeyA: Controller.BUTTON_TURBO_B,
      Enter: Controller.BUTTON_START,
      ShiftLeft: Controller.BUTTON_SELECT,
      ShiftRight: Controller.BUTTON_SELECT,
    };
    this.keyDown = (event) => {
      if (!this.running || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName))
        return;
      if (this.keys[event.code] === undefined) return;
      event.preventDefault();
      this.nes.buttonDown(1, this.keys[event.code]);
    };
    this.keyUp = (event) => {
      if (this.keys[event.code] !== undefined)
        this.nes.buttonUp(1, this.keys[event.code]);
    };
    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("keyup", this.keyUp);
    this.resize = new ResizeObserver(() => this.screen.fitInParent());
    this.resize.observe(container);
    this.screen.fitInParent();
  }

  syncAudio() {
    this.speakers.stop();
    if (this.running && !this.muted && this.speed === 1) {
      // Loading an AudioWorklet can fail on older WebViews; gameplay still works.
      this.speakers.start().catch(() => {});
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = null;
    this.accumulator = 0;
    this.syncAudio();
    this.frameId = requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.frameId);
    this.speakers.stop();
    this.releaseButtons();
  }

  tick = (time) => {
    if (!this.running) return;
    if (this.lastTime === null) this.lastTime = time;
    this.accumulator += Math.min(time - this.lastTime, 100) * this.speed;
    this.lastTime = time;
    let frames = 0;
    try {
      while (this.accumulator >= FRAME_MS && frames < 24) {
        for (const patch of this.ramPatches)
          this.nes.cpu.write(patch.addr, patch.value);
        this.nes.frame();
        this.accumulator -= FRAME_MS;
        frames++;
      }
      if (frames) this.screen.writeBuffer();
      this.speakers.flush();
    } catch (error) {
      this.stop();
      this.onError(error);
      return;
    }
    this.frameId = requestAnimationFrame(this.tick);
  };

  setSpeed(speed) {
    if (![1, 2, 3, 4].includes(speed)) throw new Error("不支持的倍速");
    if (this.speed === speed) return;
    this.speed = speed;
    this.accumulator = 0;
    this.syncAudio();
  }

  setMuted(muted) {
    if (this.muted === muted) return;
    this.muted = muted;
    this.syncAudio();
  }

  setCheats(cheats) {
    this.ramPatches = applyCheats(this.nes, cheats);
    this.cheats = cheats;
  }

  releaseButtons() {
    for (let button = 0; button <= Controller.BUTTON_TURBO_B; button++) {
      this.nes.buttonUp(1, button);
    }
  }

  reset() {
    this.nes.loadROM(this.data);
    this.setCheats(this.cheats);
  }

  restore(state) {
    this.nes.fromJSON(state);
    this.setCheats(this.cheats);
    this.releaseButtons();
    this.screen.setBuffer(this.nes.ppu.buffer);
    this.screen.writeBuffer();
  }

  destroy() {
    this.stop();
    window.removeEventListener("keydown", this.keyDown);
    window.removeEventListener("keyup", this.keyUp);
    this.resize.disconnect();
    this.screen.destroy();
  }
}
