let sequence = 0;
const pending = new Map();
let connectedHost;

export function isAndroid() {
  return !!window.NativeHost?.postMessage;
}

export function nativeRequest(method, params = {}) {
  const host = window.NativeHost;
  if (!host) return Promise.reject(new Error("此操作需要 Android 应用"));
  if (connectedHost !== host) {
    connectedHost = host;
    host.onmessage = ({ data }) => {
      let response;
      try {
        response = JSON.parse(data);
      } catch {
        return;
      }
      const request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id);
      clearTimeout(request.timer);
      if (response.error) request.reject(new Error(response.error));
      else request.resolve(response.result);
    };
  }
  return new Promise((resolve, reject) => {
    const id = String(++sequence);
    // File pickers may remain open while the user browses storage.
    const timer = setTimeout(
      () => {
        pending.delete(id);
        reject(new Error("操作超时，请重试"));
      },
      10 * 60 * 1000,
    );
    pending.set(id, { resolve, reject, timer });
    try {
      host.postMessage(JSON.stringify({ id, method, params }));
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    }
  });
}
