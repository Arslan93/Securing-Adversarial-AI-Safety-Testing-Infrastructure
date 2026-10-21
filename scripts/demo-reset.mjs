import { existsSync, readFileSync, renameSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { seedDemo } from "./demo-seed.mjs";
const root = resolve(".data/hackathon");
if (existsSync(root)) {
  if (!existsSync(join(root, ".bayora-demo")))
    throw Error("Directory is not a marked demo workspace. Refusing reset.");
  const lock = join(root, "bayora.db.broker-lock");
  if (existsSync(lock)) {
    const owner = JSON.parse(readFileSync(lock, "utf8"));
    let alive = true;
    try {
      process.kill(owner.pid, 0);
    } catch (e) {
      if (e.code === "ESRCH") alive = false;
      else throw e;
    }
    if (alive) throw Error("Stop npm run demo before resetting.");
  }
  mkdirSync(".data/demo-archives", { recursive: true, mode: 0o700 });
  const archive = resolve(
    ".data/demo-archives",
    new Date().toISOString().replaceAll(":", "-"),
  );
  renameSync(root, archive);
  console.log("Previous demo archived at " + archive);
}
console.log(
  "Demo seeded. Private credentials: " +
    join(await seedDemo(root), "credentials.json"),
);
