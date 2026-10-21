process.stdin.setEncoding("utf8");
// Runs as an unprivileged process in a network=none container. No eval, tools or shell.
const mode = process.argv[2];
if (mode === "idle") setInterval(() => {}, 3600000);
else if (mode === "probe") {
  const { inspectBoundary } = await import("./probe.mjs");
  process.stdout.write(JSON.stringify(await inspectBoundary()));
} else {
  try {
    let raw = "";
    for await (const chunk of process.stdin) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 40000) throw Error("size");
    }
    const input = JSON.parse(raw);
    if (!input || Array.isArray(input) || typeof input !== "object")
      throw Error("schema");
    let result;
    if (
      mode === "red" &&
      Object.keys(input).every((k) => ["id", "prompt"].includes(k)) &&
      typeof input.id === "string" &&
      input.id.length <= 64 &&
      typeof input.prompt === "string" &&
      input.prompt.length <= 2000
    )
      result = { id: input.id, prompt: input.prompt };
    else if (
      mode === "blue" &&
      Object.keys(input).length === 1 &&
      Array.isArray(input.rules) &&
      input.rules.length <= 20 &&
      input.rules.every((r) => typeof r === "string" && r.length <= 300)
    )
      result = { rules: input.rules };
    else throw Error("schema");
    process.stdout.write(JSON.stringify(result));
  } catch {
    process.stderr.write("Bounded worker schema rejected.");
    process.exitCode = 1;
  }
}
