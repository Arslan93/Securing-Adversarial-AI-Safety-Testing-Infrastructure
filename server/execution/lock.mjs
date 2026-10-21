import {
  openSync,
  writeFileSync,
  readFileSync,
  closeSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
export function acquireBrokerLock(dbPath) {
  if (dbPath === ":memory:") return () => {};
  const path = resolve(dbPath) + ".broker-lock",
    token = randomUUID();
  mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx", 0o600);
      writeFileSync(fd, JSON.stringify({ pid: process.pid, token }));
      closeSync(fd);
      return () => {
        if (JSON.parse(readFileSync(path, "utf8")).token === token)
          unlinkSync(path);
      };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const previous = JSON.parse(readFileSync(path, "utf8"));
      try {
        process.kill(previous.pid, 0);
      } catch (error) {
        if (error.code === "ESRCH") {
          unlinkSync(path);
          continue;
        }
        throw error;
      }
      throw Error(
        "This database already has a running API broker. Use another database or stop that process first.",
      );
    }
  }
  throw Error("Could not acquire the database broker lock.");
}
