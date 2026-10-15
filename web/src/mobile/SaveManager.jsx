import { useEffect, useRef, useState } from "react";
import { createSave, listSaves, readSave, renameSave } from "./saveStates";

export default function SaveManager({
  game,
  captureState,
  restoreState,
  onNotice,
}) {
  const [saves, setSaves] = useState([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState("");
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    listSaves(game)
      .then((result) => {
        if (!active.current) return;
        setSaves(result.saves);
        if (result.skipped)
          setError(`${result.skipped} 个损坏或不兼容的存档已跳过`);
      })
      .catch((failure) => {
        if (active.current) setError(failure.message);
      })
      .finally(() => {
        if (active.current) setBusy(false);
      });
    return () => {
      active.current = false;
    };
  }, [game]);

  async function run(operation) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (failure) {
      if (active.current) setError(failure.message);
    } finally {
      if (active.current) setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      const entry = await createSave(game, captureState());
      if (!active.current) return;
      setSaves((current) => [entry, ...current]);
      onNotice(`已新增存档：${entry.path}`);
    });

  const load = (entry) =>
    run(async () => {
      const state = await readSave(game, entry.id);
      if (!active.current) return;
      restoreState(state);
      onNotice(`已读取存档：${entry.name}`);
    });

  const rename = (event, entry) => {
    event.preventDefault();
    run(async () => {
      const updated = await renameSave(game, entry.id, name);
      if (!active.current) return;
      setSaves((current) =>
        current.map((item) => (item.id === entry.id ? updated : item)),
      );
      setEditing(null);
      onNotice("存档已改名");
    });
  };

  return (
    <div className="save-manager">
      <p className="modal-description">
        每次保存都会新增一个文件，默认按游戏名建目录、以存档时间命名。选择下方任意存档读取，或修改它的文件名。
      </p>
      <button className="primary-button" disabled={busy} onClick={save}>
        ＋ 保存当前进度
      </button>
      <p className="save-count">
        {busy ? "正在处理存档…" : `共 ${saves.length} 个存档 · 最新在前`}
      </p>
      {error && (
        <p className="save-error" role="alert">
          {error}
        </p>
      )}
      {!busy && !error && saves.length === 0 && (
        <p className="save-empty">还没有存档，点击上方按钮保存当前进度。</p>
      )}
      <div className="save-list">
        {saves.map((entry) => (
          <article className="save-entry" key={entry.id}>
            <strong>{entry.name}</strong>
            <time dateTime={new Date(entry.createdAt).toISOString()}>
              {new Date(entry.createdAt).toLocaleString("zh-CN", {
                hour12: false,
              })}
              {entry.legacy ? " · 旧存档" : ""}
            </time>
            <small>{entry.path}</small>
            {editing === entry.id ? (
              <form
                aria-label="重命名存档"
                onSubmit={(event) => rename(event, entry)}
              >
                <input
                  aria-label="存档新名称"
                  autoFocus
                  required
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={busy}
                />
                <div className="save-actions">
                  <button type="submit" disabled={busy}>
                    确认改名
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setEditing(null)}
                  >
                    取消
                  </button>
                </div>
              </form>
            ) : (
              <div className="save-actions">
                <button
                  disabled={busy}
                  onClick={() => load(entry)}
                  aria-label={`读取 ${entry.name}`}
                >
                  读取存档
                </button>
                <button
                  disabled={busy}
                  onClick={() => {
                    setEditing(entry.id);
                    setName(entry.name);
                  }}
                  aria-label={`重命名 ${entry.name}`}
                >
                  改名
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
