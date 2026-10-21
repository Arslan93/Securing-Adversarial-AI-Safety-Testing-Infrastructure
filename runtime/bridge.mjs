process.stdin.setEncoding("utf8");
// A fixed loopback-only transport executed inside a model container. No arbitrary URL/API path.
try {
  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 40000) throw Error("size");
  }
  const input = JSON.parse(raw),
    operation = input.operation;
  if (!["models", "chat", "probe"].includes(operation))
    throw Error("operation");
  if (operation === "probe") {
    const { inspectBoundary } = await import("./probe.mjs");
    process.stdout.write(
      JSON.stringify(await inspectBoundary({ model: true })),
    );
  } else {
    if (
      operation === "chat" &&
      (!input.body ||
        Object.keys(input.body).some(
          (k) =>
            !["model", "messages", "stream", "options", "keep_alive"].includes(
              k,
            ),
        ) ||
        input.body.messages?.length !== 2 ||
        input.body.stream !== false ||
        input.body.options?.num_predict > 128)
    )
      throw Error("schema");
    const response = await fetch(
      "http://127.0.0.1:11434/api/" +
        (operation === "models" ? "tags" : "chat"),
      {
        method: operation === "models" ? "GET" : "POST",
        headers: { "Content-Type": "application/json" },
        ...(operation === "chat" ? { body: JSON.stringify(input.body) } : {}),
        signal: AbortSignal.timeout(operation === "models" ? 4000 : 60000),
        redirect: "error",
      },
    );
    if (!response.ok) throw Error("provider");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let result = "",
      bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 131072) {
        await reader.cancel();
        throw Error("size");
      }
      result += decoder.decode(value, { stream: true });
    }
    result += decoder.decode();
    JSON.parse(result);
    process.stdout.write(result);
  }
} catch {
  process.stderr.write("Isolated model bridge failed.");
  process.exitCode = 1;
}
