import { isAndroid, nativeRequest } from "./bridge";

const EXTENSION = ".jsnes.json";
const DATABASE = "jsnes-save-files";
const migrations = new Map();

export function gameDirectory(name) {
  let folder = name
    .replace(/\.nes$/i, "")
    .trim()
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, "_");
  if (!folder || folder === "." || folder === "..") folder = "未命名游戏";
  return Array.from(folder).slice(0, 60).join("");
}

export function validateSaveName(input) {
  const name = input.trim().replace(/\.jsnes\.json$/, "");
  if (
    !name ||
    name === "." ||
    name === ".." ||
    /[\\/:*?"<>|\p{Cc}]/u.test(name) ||
    Array.from(name).length > 60
  ) {
    throw new Error("名称需为 1–60 个字符，不能包含斜杠等文件名特殊字符");
  }
  return name;
}

export function timestampName(time) {
  const date = new Date(time);
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
}

function validateState(state) {
  if (
    !state ||
    !["cpu", "ppu", "papu", "mmap"].every(
      (key) => state[key] && typeof state[key] === "object",
    )
  ) {
    throw new Error("存档内容无效");
  }
}

function browserOperation(names, mode, operation) {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DATABASE, 1);
    opening.onupgradeneeded = () => {
      const database = opening.result;
      database
        .createObjectStore("entries", { keyPath: "id" })
        .createIndex("romKey", "romKey");
      database.createObjectStore("states", { keyPath: "id" });
    };
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result;
      const transaction = database.transaction(names, mode);
      let result, failure;
      transaction.oncomplete = () => {
        database.close();
        resolve(result);
      };
      transaction.onabort = transaction.onerror = () => {
        database.close();
        reject(failure || transaction.error || new Error("存档操作失败"));
      };
      const fail = (error) => {
        failure = error;
        transaction.abort();
      };
      try {
        operation(
          transaction,
          (value) => {
            result = value;
          },
          fail,
        );
      } catch (error) {
        fail(error);
      }
    };
  });
}

async function rawList(game) {
  if (isAndroid()) return nativeRequest("listStates", { romKey: game.key });
  const saves = await browserOperation(
    ["entries"],
    "readonly",
    (transaction, done) => {
      const request = transaction
        .objectStore("entries")
        .index("romKey")
        .getAll(game.key);
      request.onsuccess = () => done(request.result);
    },
  );
  saves.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  return { saves, skipped: 0 };
}

async function rawCreate(game, state, legacy = false) {
  validateState(state);
  if (isAndroid())
    return nativeRequest("saveState", {
      gameName: game.name,
      romKey: game.key,
      state,
      legacy,
    });
  return browserOperation(
    ["entries", "states"],
    "readwrite",
    (transaction, done) => {
      const entries = transaction.objectStore("entries");
      const states = transaction.objectStore("states");
      const createdAt = Date.now();
      let filenameTime = createdAt;
      const folder = gameDirectory(game.name);
      const attempt = () => {
        const name = timestampName(filenameTime++);
        const filename = name + EXTENSION;
        const id = `${folder}/${filename}`;
        const probe = entries.getKey(id);
        probe.onsuccess = () => {
          if (probe.result !== undefined) {
            attempt();
            return;
          }
          const entry = {
            id,
            name,
            filename,
            path: id,
            createdAt,
            romKey: game.key,
            gameName: game.name.replace(/\.nes$/i, ""),
            version: 2,
            legacy,
          };
          entries.add(entry);
          states.add({ id, state });
          done(entry);
        };
      };
      attempt();
    },
  );
}

async function migrateLegacy(game) {
  const key = `jsnes-state-${game.key}`;
  const saved = localStorage.getItem(key);
  if (!saved) return;
  const existing = await rawList(game);
  if (!existing.saves.some((entry) => entry.legacy)) {
    const parsed = JSON.parse(saved);
    if (parsed.version !== 1) throw new Error("旧存档版本不兼容，原数据已保留");
    await rawCreate(game, parsed.state, true);
  }
  // Remove only after the new store has committed successfully.
  localStorage.removeItem(key);
}

async function ensureLegacy(game) {
  if (!migrations.has(game.key)) {
    const task = migrateLegacy(game).finally(() => migrations.delete(game.key));
    migrations.set(game.key, task);
  }
  await migrations.get(game.key);
}

export async function listSaves(game) {
  await ensureLegacy(game);
  return rawList(game);
}

export async function createSave(game, state) {
  await ensureLegacy(game);
  return rawCreate(game, state);
}

export async function readSave(game, id) {
  let state;
  if (isAndroid()) {
    ({ state } = await nativeRequest("readState", { romKey: game.key, id }));
  } else {
    state = await browserOperation(
      ["entries", "states"],
      "readonly",
      (transaction, done, fail) => {
        const entry = transaction.objectStore("entries").get(id);
        entry.onsuccess = () => {
          if (!entry.result || entry.result.romKey !== game.key) {
            fail(new Error("存档不存在或与当前游戏不匹配"));
            return;
          }
          const record = transaction.objectStore("states").get(id);
          record.onsuccess = () => done(record.result?.state);
        };
      },
    );
  }
  validateState(state);
  return state;
}

export async function renameSave(game, id, input) {
  const name = validateSaveName(input);
  if (isAndroid())
    return nativeRequest("renameState", { romKey: game.key, id, name });
  return browserOperation(
    ["entries", "states"],
    "readwrite",
    (transaction, done, fail) => {
      const entries = transaction.objectStore("entries");
      const states = transaction.objectStore("states");
      const request = entries.get(id);
      request.onsuccess = () => {
        const original = request.result;
        if (!original || original.romKey !== game.key) {
          fail(new Error("存档不存在或与当前游戏不匹配"));
          return;
        }
        const filename = name + EXTENSION;
        const newId = id.substring(0, id.lastIndexOf("/") + 1) + filename;
        if (newId === id) {
          done(original);
          return;
        }
        const probe = entries.getKey(newId);
        probe.onsuccess = () => {
          if (probe.result !== undefined) {
            fail(new Error("同名存档已存在，请换一个名称"));
            return;
          }
          const data = states.get(id);
          data.onsuccess = () => {
            if (!data.result) {
              fail(new Error("存档内容缺失"));
              return;
            }
            const renamed = {
              ...original,
              id: newId,
              path: newId,
              filename,
              name,
            };
            entries.add(renamed);
            states.add({ id: newId, state: data.result.state });
            entries.delete(id);
            states.delete(id);
            done(renamed);
          };
        };
      };
    },
  );
}
