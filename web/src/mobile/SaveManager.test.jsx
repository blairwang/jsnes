import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import SaveManager from "./SaveManager";
import { createSave, listSaves, readSave, renameSave } from "./saveStates";

vi.mock("./saveStates", () => ({
  createSave: vi.fn(),
  listSaves: vi.fn(),
  readSave: vi.fn(),
  renameSave: vi.fn(),
}));

const entry = (name, time) => ({
  id: `Croom/${name}.jsnes.json`,
  name,
  path: `Croom/${name}.jsnes.json`,
  createdAt: time,
});

describe("save selection and renaming", () => {
  const game = { key: "a".repeat(64), name: "Croom.nes" };
  const props = () => ({
    game,
    captureState: vi.fn(() => ({ cpu: {} })),
    restoreState: vi.fn(),
    onNotice: vi.fn(),
  });
  beforeEach(() => {
    vi.clearAllMocks();
    listSaves.mockResolvedValue({
      saves: [entry("第一关", 2000), entry("起点", 1000)],
    });
  });

  it("loads the selected list entry instead of always loading the latest", async () => {
    const callbacks = props();
    readSave.mockResolvedValue({ cpu: { marker: 42 } });
    render(<SaveManager {...callbacks} />);
    fireEvent.click(await screen.findByRole("button", { name: "读取 起点" }));
    await waitFor(() =>
      expect(callbacks.restoreState).toHaveBeenCalledWith({
        cpu: { marker: 42 },
      }),
    );
    expect(readSave).toHaveBeenCalledWith(game, "Croom/起点.jsnes.json");
  });

  it("renames a list entry and uses the new file ID for subsequent reads", async () => {
    renameSave.mockResolvedValue(entry("Boss 前", 2000));
    render(<SaveManager {...props()} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "重命名 第一关" }),
    );
    fireEvent.change(screen.getByLabelText("存档新名称"), {
      target: { value: "Boss 前" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认改名" }));
    expect(
      await screen.findByRole("button", { name: "读取 Boss 前" }),
    ).toBeEnabled();
    expect(renameSave).toHaveBeenCalledWith(
      game,
      "Croom/第一关.jsnes.json",
      "Boss 前",
    );
    expect(
      screen.queryByRole("button", { name: "读取 第一关" }),
    ).not.toBeInTheDocument();
  });

  it("appends a newly saved file while keeping both existing entries", async () => {
    createSave.mockResolvedValue(entry("新存档", 3000));
    render(<SaveManager {...props()} />);
    await screen.findByRole("button", { name: "读取 起点" });
    fireEvent.click(screen.getByRole("button", { name: /保存当前进度/ }));
    expect(
      await screen.findByRole("button", { name: "读取 新存档" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "读取 起点" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "读取 第一关" })).toBeEnabled();
  });

  it("shows write failures without dropping the current save list", async () => {
    createSave.mockRejectedValue(new Error("磁盘空间不足"));
    render(<SaveManager {...props()} />);
    await screen.findByRole("button", { name: "读取 起点" });
    fireEvent.click(screen.getByRole("button", { name: /保存当前进度/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("磁盘空间不足");
    expect(screen.getByRole("button", { name: "读取 起点" })).toBeEnabled();
  });
});
