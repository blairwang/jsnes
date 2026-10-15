import { useEffect, useRef } from "react";
import { Controller } from "jsnes";

export default function TouchControls({ player, disabled }) {
  const held = useRef(new Map());

  const release = () => {
    player.current?.releaseButtons();
    held.current.clear();
  };

  useEffect(() => {
    if (disabled) release();
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("blur", release);
      release();
    };
  }, [disabled, player]);

  const update = (id, buttons) => {
    const before = new Set([...held.current.values()].flat());
    if (buttons.length) held.current.set(id, buttons);
    else held.current.delete(id);
    const after = new Set([...held.current.values()].flat());
    for (const button of before)
      if (!after.has(button)) player.current?.nes.buttonUp(1, button);
    for (const button of after)
      if (!before.has(button)) player.current?.nes.buttonDown(1, button);
  };

  const padButtons = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    const buttons = [];
    if (x < -0.17) buttons.push(Controller.BUTTON_LEFT);
    if (x > 0.17) buttons.push(Controller.BUTTON_RIGHT);
    if (y < -0.17) buttons.push(Controller.BUTTON_UP);
    if (y > 0.17) buttons.push(Controller.BUTTON_DOWN);
    return buttons;
  };

  const end = (event) => {
    event.preventDefault();
    update(event.pointerId, []);
  };

  const button = (label, value, className = "") => (
    <button
      type="button"
      disabled={disabled}
      className={`touch-key ${className}`}
      aria-label={label}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        update(event.pointerId, [value]);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      {label}
    </button>
  );

  return (
    <div className="touch-controls" aria-label="触屏手柄">
      <div
        className={`direction-pad ${disabled ? "disabled" : ""}`}
        aria-label="方向键，支持滑动和斜向"
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (disabled) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          update(event.pointerId, padButtons(event));
        }}
        onPointerMove={(event) => {
          if (
            !disabled &&
            event.currentTarget.hasPointerCapture(event.pointerId)
          )
            update(event.pointerId, padButtons(event));
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
      >
        <span className="pad-up">▲</span>
        <span className="pad-left">◀</span>
        <span className="pad-center">●</span>
        <span className="pad-right">▶</span>
        <span className="pad-down">▼</span>
      </div>
      <div className="system-keys">
        {button("SELECT", Controller.BUTTON_SELECT)}
        {button("START", Controller.BUTTON_START)}
      </div>
      <div className="action-keys">
        {button("连发 B", Controller.BUTTON_TURBO_B, "turbo-key")}
        {button("连发 A", Controller.BUTTON_TURBO_A, "turbo-key")}
        {button("B", Controller.BUTTON_B, "round-key")}
        {button("A", Controller.BUTTON_A, "round-key key-a")}
      </div>
    </div>
  );
}
