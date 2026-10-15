import { useEffect, useRef, useState } from "react";
import { isAndroid, nativeRequest } from "./bridge";
import { parseCheat } from "./cheats";
import MobilePlayer from "./MobilePlayer";
import TouchControls from "./TouchControls";
import "./mobile.css";

function savedCheats(key) {
  try {
    const saved = JSON.parse(
      localStorage.getItem(`jsnes-cheats-${key}`) || "[]",
    );
    return Array.isArray(saved)
      ? saved.filter((item) => {
          if (
            !item ||
            typeof item.code !== "string" ||
            typeof item.enabled !== "boolean"
          )
            return false;
          try {
            parseCheat(item.code);
            return true;
          } catch {
            return false;
          }
        })
      : [];
  } catch {
    return [];
  }
}

export default function MobilePage() {
  const [roms, setRoms] = useState([]);
  const [folder, setFolder] = useState("");
  const [query, setQuery] = useState("");
  const [game, setGame] = useState(null);
  const [paused, setPaused] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState(null);
  const [cheats, setCheats] = useState([]);
  const [cheatName, setCheatName] = useState("");
  const [cheatCode, setCheatCode] = useState("");
  const player = useRef(null);
  const screen = useRef(null);
  const fileInput = useRef(null);
  const directoryInput = useRef(null);
  const loadVersion = useRef(0);
  const controlsDisabled = !game || paused || !!modal || busy || !!fault;

  const showLibrary = (result) => {
    if (result.canceled) return;
    setRoms(result.roms || []);
    setFolder(result.folder || "");
    if (result.truncated)
      setNotice(
        "目录较大或部分子目录不可读，已显示可扫描的游戏；可选择更小的目录。",
      );
  };

  useEffect(() => {
    document.documentElement.lang = "zh-CN";
    if (isAndroid()) {
      setBusy(true);
      nativeRequest("listDirectory")
        .then(showLibrary)
        .catch((error) => setNotice(error.message))
        .finally(() => setBusy(false));
    }
    return () => {
      loadVersion.current++;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!game) return;
    try {
      player.current = new MobilePlayer(screen.current, game.data, (error) => {
        setFault(`模拟器停止：${error.message}`);
        setPaused(true);
      });
    } catch (error) {
      setFault(`无法运行此 ROM：${error.message}`);
    }
    return () => {
      player.current?.destroy();
      player.current = null;
    };
  }, [game]);

  useEffect(() => {
    if (!player.current) return;
    player.current.setSpeed(speed);
    player.current.setMuted(muted);
    player.current.setCheats(cheats);
    if (controlsDisabled) player.current.stop();
    else player.current.start();
  }, [game, speed, muted, cheats, controlsDisabled]);

  useEffect(() => {
    const suspend = () => {
      player.current?.stop();
      setPaused(true);
    };
    const visibility = () => {
      if (document.hidden) suspend();
    };
    const lifecycle = (event) => {
      if (!event.detail.active) suspend();
    };
    window.addEventListener("blur", suspend);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("jsnes:lifecycle", lifecycle);
    return () => {
      window.removeEventListener("blur", suspend);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("jsnes:lifecycle", lifecycle);
    };
  }, []);

  useEffect(() => {
    const back = () => {
      if (modal) setModal(null);
      else if (game) {
        loadVersion.current++;
        setGame(null);
        setFault("");
      } else if (!busy && isAndroid()) nativeRequest("exit").catch(() => {});
    };
    window.addEventListener("jsnes:back", back);
    return () => window.removeEventListener("jsnes:back", back);
  }, [modal, game, busy]);

  async function openRom(rom) {
    const version = ++loadVersion.current;
    setBusy(true);
    setFault("");
    try {
      let data;
      if (rom.file) data = new Uint8Array(await rom.file.arrayBuffer());
      else {
        const response = await fetch(rom.url);
        if (!response.ok)
          throw new Error((await response.text()) || "文件读取失败");
        data = new Uint8Array(await response.arrayBuffer());
      }
      if (data.length > 16 * 1024 * 1024)
        throw new Error("ROM 超过 16 MiB 限制");
      if (
        data.length < 16 ||
        data[0] !== 0x4e ||
        data[1] !== 0x45 ||
        data[2] !== 0x53 ||
        data[3] !== 0x1a
      )
        throw new Error("文件不是有效的 iNES ROM");
      const digest = await crypto.subtle.digest("SHA-256", data);
      const key = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      if (version !== loadVersion.current) return;
      setCheats(savedCheats(key));
      setSpeed(1);
      setModal(null);
      setGame({ name: rom.name, data, key });
      setPaused(false);
    } catch (error) {
      if (version === loadVersion.current) setNotice(error.message);
    } finally {
      if (version === loadVersion.current) setBusy(false);
    }
  }

  async function pick(method) {
    if (!isAndroid()) {
      if (method === "pickDirectory") directoryInput.current.click();
      else fileInput.current.click();
      return;
    }
    setBusy(true);
    try {
      const result = await nativeRequest(method);
      if (result.rom) await openRom(result.rom);
      else showLibrary(result);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  function updateCheats(next) {
    try {
      player.current?.setCheats(next);
      localStorage.setItem(`jsnes-cheats-${game.key}`, JSON.stringify(next));
      setCheats(next);
    } catch (error) {
      player.current?.setCheats(cheats);
      setNotice(`金手指保存失败：${error.message}`);
    }
  }

  function addCheat(event) {
    event.preventDefault();
    try {
      parseCheat(cheatCode);
      const next = {
        id: crypto.randomUUID(),
        name: cheatName.trim() || cheatCode.trim(),
        code: cheatCode.trim().toUpperCase(),
        enabled: true,
      };
      updateCheats([...cheats, next]);
      setCheatCode("");
      setCheatName("");
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function screenshot() {
    try {
      const dataUrl = player.current.screen.screenshot().src;
      if (isAndroid()) {
        const result = await nativeRequest("saveScreenshot", {
          dataUrl,
          name: game.name.replace(/\.nes$/i, ""),
        });
        if (!result.canceled)
          setNotice(
            "截图已保存" +
              (typeof result.saved === "string" ? `：${result.saved}` : ""),
          );
      } else {
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = `${game.name}-${Date.now()}.png`;
        link.click();
        setNotice("截图已下载");
      }
    } catch (error) {
      setNotice(`截图失败：${error.message}`);
    }
  }

  function saveState() {
    try {
      localStorage.setItem(
        `jsnes-state-${game.key}`,
        JSON.stringify({ version: 1, state: player.current.nes.toJSON() }),
      );
      setNotice("快速存档已保存（每个游戏一个槽位）");
    } catch (error) {
      setNotice(`存档失败：${error.message}`);
    }
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(`jsnes-state-${game.key}`);
      if (!saved) throw new Error("当前游戏还没有快速存档");
      const parsed = JSON.parse(saved);
      if (parsed.version !== 1) throw new Error("不兼容的存档版本");
      player.current.restore(parsed.state);
      setNotice("存档已读取");
    } catch (error) {
      setNotice(`读档失败：${error.message}`);
    }
  }

  const available = roms
    .filter((rom) =>
      `${rom.name} ${rom.path}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className={`mobile-app ${game ? "in-game" : "in-library"}`}>
      <input
        hidden
        ref={fileInput}
        type="file"
        accept=".nes"
        onChange={(event) => {
          const file = event.target.files[0];
          if (file) openRom({ name: file.name, file });
          event.target.value = "";
        }}
      />
      <input
        hidden
        ref={directoryInput}
        type="file"
        webkitdirectory=""
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files).filter((file) =>
            /\.nes$/i.test(file.name),
          );
          setRoms(
            files.map((file, id) => ({
              id: String(id),
              name: file.name,
              path: file.webkitRelativePath,
              file,
            })),
          );
          setFolder(files[0]?.webkitRelativePath.split("/")[0] || "所选目录");
          event.target.value = "";
        }}
      />
      <header className="mobile-header">
        <div className="brand">
          <span className="brand-mark">J</span>
          <div>
            <strong>JSNES</strong>
            <small>口袋里的红白机</small>
          </div>
        </div>
        <span className="offline-badge">
          <i /> 离线畅玩
        </span>
      </header>

      {!game ? (
        <section className="rom-library">
          <div className="library-intro">
            <p className="eyebrow">YOUR NEXT ADVENTURE</p>
            <h1>
              按下开始，
              <br />
              回到像素时代。
            </h1>
            <p>选择游戏目录，收藏的 NES 游戏随时开玩。</p>
          </div>
          <div className="library-actions">
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => pick("pickDirectory")}
            >
              ＋ 选择游戏目录
            </button>
            <button disabled={busy} onClick={() => pick("pickRom")}>
              打开 NES 文件
            </button>
          </div>
          <div className="library-heading">
            <div>
              <h2>
                游戏库 <span>{roms.length.toString().padStart(2, "0")}</span>
              </h2>
              <p>{folder || "尚未选择目录"}</p>
            </div>
            {isAndroid() && folder && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => pick("listDirectory")}
              >
                刷新
              </button>
            )}
          </div>
          <input
            className="rom-search"
            placeholder="搜索游戏名称或路径"
            aria-label="搜索游戏"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="rom-list">
            {available.map((rom, index) => (
              <button
                className="rom-card"
                key={rom.id}
                disabled={busy}
                onClick={() => openRom(rom)}
              >
                <span className="cartridge">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>
                  <strong>{rom.name.replace(/\.nes$/i, "")}</strong>
                  <small>{rom.path || "NES ROM"}</small>
                </span>
                <b>↗</b>
              </button>
            ))}
            {available.length === 0 && (
              <div className="empty-library">
                <span>▦</span>
                <h3>{query ? "没有匹配的游戏" : "你的冒险，从这里开始"}</h3>
                <p>
                  {query
                    ? "试试其他关键词"
                    : "支持扫描所选目录和子目录中的 .nes 文件"}
                </p>
              </div>
            )}
          </div>
          <button
            className="demo-button"
            disabled={busy}
            onClick={() =>
              openRom({
                name: "Croom.nes",
                url: `${import.meta.env.BASE_URL}roms/croom/croom.nes`,
              })
            }
          >
            试玩内置开源游戏 Croom →
          </button>
          <p className="library-footnote">
            目录授权保留在本机 · 无需网络 · 支持外接键盘
          </p>
        </section>
      ) : (
        <section className="game-room">
          <div className="game-heading">
            <button
              onClick={() => {
                setGame(null);
                setFault("");
              }}
              aria-label="返回游戏库"
            >
              ‹ 游戏库
            </button>
            <strong>{game.name.replace(/\.nes$/i, "")}</strong>
            <span className="game-status">
              {controlsDisabled ? "已暂停" : `${speed}× 运行中`}
            </span>
          </div>
          <div className="game-toolbar">
            <button disabled={!!fault} onClick={() => setPaused(!paused)}>
              {paused ? "▶ 继续" : "Ⅱ 暂停"}
            </button>
            <label>
              倍速{" "}
              <select
                aria-label="游戏倍速"
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
              >
                {[1, 2, 3, 4].map((value) => (
                  <option key={value} value={value}>
                    {value}×
                  </option>
                ))}
              </select>
            </label>
            <button disabled={!!fault} onClick={() => setModal("cheats")}>
              金手指 {cheats.filter((item) => item.enabled).length || ""}
            </button>
            <button disabled={!!fault} onClick={screenshot}>
              截图
            </button>
            <button onClick={() => setModal("options")}>更多 ⋯</button>
          </div>
          <div className="console-screen" ref={screen}>
            {(paused || fault) && (
              <div className="pause-overlay">
                <strong>{fault ? "游戏已停止" : "PAUSED"}</strong>
                {fault ? (
                  <p>{fault}</p>
                ) : (
                  <button
                    className="primary-button"
                    onClick={() => setPaused(false)}
                  >
                    继续游戏
                  </button>
                )}
              </div>
            )}
          </div>
          <TouchControls player={player} disabled={controlsDisabled} />
          <p className="game-hint">
            {speed > 1
              ? "加速中 · 声音已暂时关闭 · 实际速度取决于设备性能"
              : "方向键可滑动 · 支持同时按键 · START 开始游戏"}
          </p>
        </section>
      )}

      {modal && (
        <div className="mobile-modal-backdrop" onClick={() => setModal(null)}>
          <section
            className="mobile-modal"
            role="dialog"
            aria-modal="true"
            aria-label={modal === "cheats" ? "金手指管理" : "游戏选项"}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <h2>{modal === "cheats" ? "金手指" : "游戏选项"}</h2>
              <button onClick={() => setModal(null)} aria-label="关闭">
                ✕
              </button>
            </div>
            {modal === "cheats" ? (
              <>
                <p className="modal-description">
                  代码按当前 ROM 保存。Game Genie 支持 6/8 位字母；ROM 补丁如
                  8000:FF 或 8000:FF?10；RAM 锁定如
                  RAM:00FF:09（0000–07FF）。代码需与游戏版本匹配。
                </p>
                <form onSubmit={addCheat}>
                  <input
                    placeholder="名称（可选）"
                    aria-label="金手指名称"
                    value={cheatName}
                    onChange={(event) => setCheatName(event.target.value)}
                  />
                  <input
                    required
                    placeholder="输入金手指代码"
                    aria-label="金手指代码"
                    autoCapitalize="characters"
                    spellCheck="false"
                    value={cheatCode}
                    onChange={(event) => setCheatCode(event.target.value)}
                  />
                  <button className="primary-button" type="submit">
                    添加并启用
                  </button>
                </form>
                <div className="cheat-list">
                  {cheats.length === 0 && (
                    <p>还没有金手指。添加代码后会立即生效。</p>
                  )}
                  {cheats.map((item) => (
                    <div className="cheat-row" key={item.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={item.enabled}
                          onChange={() =>
                            updateCheats(
                              cheats.map((cheat) =>
                                cheat.id === item.id
                                  ? { ...cheat, enabled: !cheat.enabled }
                                  : cheat,
                              ),
                            )
                          }
                        />
                        <span>
                          {item.name}
                          <small>{item.code}</small>
                        </span>
                      </label>
                      <button
                        aria-label={`删除 ${item.name}`}
                        onClick={() =>
                          updateCheats(
                            cheats.filter((cheat) => cheat.id !== item.id),
                          )
                        }
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : modal === "options" ? (
              <div className="option-list">
                <button onClick={() => setMuted(!muted)}>
                  声音 <span>{muted ? "关闭" : "开启"}</span>
                </button>
                <button disabled={!!fault} onClick={saveState}>
                  快速存档 <span>保存当前进度</span>
                </button>
                <button disabled={!!fault} onClick={loadState}>
                  快速读档 <span>恢复已存进度</span>
                </button>
                <button onClick={() => setModal("reset")}>
                  重新开始 <span>重置当前游戏</span>
                </button>
                <p className="modal-description">
                  存档和金手指保存在应用本机数据中，卸载或清除应用数据会移除。键盘：方向键移动，X
                  / Z 为 A / B，Enter 开始，Shift 选择。
                </p>
              </div>
            ) : null}
            {modal === "reset" && (
              <div className="reset-confirm">
                <p>重新开始会丢失当前未保存的进度。</p>
                <button
                  className="primary-button"
                  onClick={() => {
                    player.current?.reset();
                    setFault("");
                    setPaused(false);
                    setModal(null);
                  }}
                >
                  确认重新开始
                </button>
              </div>
            )}
          </section>
        </div>
      )}
      {busy && (
        <div className="busy-indicator" role="status">
          <span /> 正在读取游戏…
        </div>
      )}
      {notice && (
        <div
          className="mobile-notice"
          role="status"
          onClick={() => setNotice("")}
        >
          {notice}
        </div>
      )}
    </main>
  );
}
