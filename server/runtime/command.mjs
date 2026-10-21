import { spawn } from "node:child_process";
// No shell interpolation, no model/prompt content in argv, bounded output and deadlines.
export function dockerCommand(
  args,
  { input, signal, timeoutMs = 15000, maxBytes = 262144 } = {},
) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawn("docker", args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    child.stdout.setEncoding("utf8");
    let output = "",
      bytes = 0,
      finished = false;
    const done = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) {
        child.kill("SIGKILL");
        reject(error);
      } else resolve(output);
    };
    const abort = () =>
      done(signal.reason || Error("Runtime operation cancelled."));
    const timer = setTimeout(
      () => done(Error("Container operation timed out.")),
      timeoutMs,
    );
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", () =>
      done(
        Error(
          "Docker CLI is not available. Install and start Docker to use container isolation.",
        ),
      ),
    );
    child.stdin.on("error", () => {});
    child.stdout.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBytes)
        done(Error("Container response exceeded its byte limit."));
      else output += chunk;
    });
    // Do not return stderr: an untrusted process may echo private prompts or tokens there.
    child.stderr.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBytes)
        done(Error("Container diagnostic output exceeded its byte limit."));
    });
    child.on("close", (code) =>
      done(
        code === 0
          ? null
          : Error(
              "Docker operation failed. Check the daemon, approved images and model volume.",
            ),
      ),
    );
    child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
  });
}
