let csrf = "";
export function resetSessionToken() {
  csrf = "";
}
export async function api(path, body, options = {}) {
  let response;
  try {
    response = await fetch("/api" + path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...options,
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)])
        : AbortSignal.timeout(10000),
    });
  } catch (e) {
    if (e.name === "AbortError" && options.signal?.aborted) throw e;
    throw Error(
      "Cannot reach the Bayora backend. Check that npm run dev is running, then retry.",
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error(
      "The backend returned an unexpected response. Check the API server and retry.",
    );
  }
  if (!response.ok)
    throw Object.assign(Error(data.error || "Request failed"), {
      status: response.status,
      code: data.code,
    });
  if (data.csrf) csrf = data.csrf;
  return data;
}
export function download(data, name) {
  downloadText(JSON.stringify(data, null, 2), name, "application/json");
}
export function downloadText(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
