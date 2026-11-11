// The client for the local Python backend. Where the backend is and its secret token come from, in order:
//   1. the Tauri shell (`backend_config` command), which started the backend and generated the token;
//   2. the page address (?api=http://127.0.0.1:8765&token=...), for development in a plain browser;
//   3. VITE_TGCS_URL / VITE_TGCS_TOKEN at build time.
// The token is kept in memory and sessionStorage only.

let config = null;

async function discover() {
  if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
    const { invoke } = await import('@tauri-apps/api/core');
    const found = await invoke('backend_config');
    return { url: found.url, token: found.token };
  }
  const params = new URLSearchParams(window.location.search);
  const stored = (() => {
    try {
      return JSON.parse(window.sessionStorage.getItem('tgcs.backend') || 'null');
    } catch {
      return null;
    }
  })();
  const url = params.get('api') || stored?.url || import.meta.env.VITE_TGCS_URL || 'http://127.0.0.1:8765';
  const token = params.get('token') || stored?.token || import.meta.env.VITE_TGCS_TOKEN || '';
  try {
    window.sessionStorage.setItem('tgcs.backend', JSON.stringify({ url, token }));
  } catch {
    /* private mode: fine, the address still works for this page load */
  }
  if (params.has('token')) window.history.replaceState({}, '', window.location.pathname); // do not leave the secret in the address bar
  return { url, token };
}

export async function getConfig() {
  config ??= await discover();
  return config;
}

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, headers = {}, signal } = {}) {
  const { url, token } = await getConfig();
  let response;
  try {
    response = await fetch(`${url}${path}`, {
      method,
      signal,
      headers: { 'X-TGCS-Token': token, ...(body && typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body,
    });
  } catch (cause) {
    if (cause?.name === 'AbortError') throw cause;
    throw new ApiError('offline', 'Cannot reach the local storage service. Is the app still starting?', 0);
  }
  if (!response.ok) {
    let detail = {};
    try {
      detail = (await response.json()).error ?? {};
    } catch {
      /* not JSON */
    }
    throw new ApiError(detail.code ?? 'error', detail.message ?? `Request failed (${response.status})`, response.status);
  }
  return response.status === 204 ? null : response.json();
}

const json = (value) => JSON.stringify(value);

export const api = {
  status: () => request('/api/status'),
  tree: () => request('/api/tree'),
  list: (parentId) => request(`/api/folders${parentId == null ? '' : `?parent_id=${parentId}`}`),
  createFolder: (name, parentId) => request('/api/folders', { method: 'POST', body: json({ name, parent_id: parentId ?? null }) }),
  deleteItems: (fileIds, folderIds) => request('/api/items', { method: 'DELETE', body: json({ file_ids: fileIds, folder_ids: folderIds }) }),
  configure: (values) => request('/api/auth/configure', { method: 'POST', body: json(values) }),
  sendCode: (phone) => request('/api/auth/send-code', { method: 'POST', body: json({ phone }) }),
  signIn: (code, password) => request('/api/auth/sign-in', { method: 'POST', body: json({ code, password: password || null }) }),
  createChannel: (title) => request('/api/channel/create', { method: 'POST', body: json({ title }) }),
  recover: () => request('/api/recover', { method: 'POST' }),
};

/** Upload one file as the raw request body. XMLHttpRequest, because fetch cannot report upload progress. */
export async function uploadFile(file, { folderId, jobId, onSent, signal }) {
  const { url, token } = await getConfig();
  const query = new URLSearchParams({ name: file.name, job_id: jobId });
  if (folderId != null) query.set('folder_id', String(folderId));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${url}/api/upload?${query}`);
    xhr.setRequestHeader('X-TGCS-Token', token);
    xhr.upload.onprogress = (event) => event.lengthComputable && onSent?.(event.loaded, event.total);
    xhr.onload = () => {
      let payload = null;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        /* empty */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(payload);
      else reject(new ApiError(payload?.error?.code ?? 'error', payload?.error?.message ?? `Upload failed (${xhr.status})`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('offline', 'Cannot reach the local storage service.', 0));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}

/** A URL the browser can navigate to for a download (it cannot send our header, so the token goes in the query). */
export async function downloadUrl(fileId, jobId) {
  const { url, token } = await getConfig();
  return `${url}/api/download/${fileId}?${new URLSearchParams({ token, job_id: jobId })}`;
}

/** Live progress events. Reconnects by itself; returns a function that stops listening. */
export function watchProgress(onEvent, onState) {
  let socket;
  let stopped = false;
  let retry;
  const open = async () => {
    const { url, token } = await getConfig();
    socket = new WebSocket(`${url.replace(/^http/, 'ws')}/ws/progress?token=${encodeURIComponent(token)}`);
    socket.onopen = () => onState?.(true);
    socket.onmessage = (message) => {
      try {
        onEvent(JSON.parse(message.data));
      } catch {
        /* ignore a malformed event */
      }
    };
    socket.onclose = () => {
      onState?.(false);
      if (!stopped) retry = setTimeout(open, 1500);
    };
  };
  open();
  return () => {
    stopped = true;
    clearTimeout(retry);
    socket?.close();
  };
}
