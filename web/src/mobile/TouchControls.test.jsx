import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import TouchControls from "./TouchControls";

it("holds A and B simultaneously, and releases canceled touches", () => {
  const player = {
    current: {
      nes: { buttonDown: vi.fn(), buttonUp: vi.fn() },
      releaseButtons: vi.fn(),
    },
  };
  const view = render(<TouchControls player={player} disabled={false} />);
  const a = screen.getByRole("button", { name: "A", exact: true });
  const b = screen.getByRole("button", { name: "B", exact: true });
  a.setPointerCapture = b.setPointerCapture = vi.fn();
  // jsdom does not implement PointerEvent; use MouseEvent with pointer IDs.
  const pointer = (element, type, id) => {
    const event = new MouseEvent(type, { bubbles: true });
    Object.defineProperty(event, "pointerId", { value: id });
    fireEvent(element, event);
  };
  pointer(a, "pointerdown", 1);
  pointer(b, "pointerdown", 2);
  expect(player.current.nes.buttonDown.mock.calls).toEqual([
    [1, 0],
    [1, 1],
  ]);
  pointer(a, "pointercancel", 1);
  expect(player.current.nes.buttonUp).toHaveBeenCalledWith(1, 0);
  expect(player.current.nes.buttonUp).not.toHaveBeenCalledWith(1, 1);
  view.rerender(<TouchControls player={player} disabled />);
  expect(player.current.releaseButtons).toHaveBeenCalled();
});
