import { lstatSync, readFileSync } from "node:fs";
export function secretValue(env, name, { requiredFile = false } = {}) {
  const file = env[name + "_FILE"];
  if (file && env[name])
    throw Error(
      `${name}: choose a secret file or an environment value, not both.`,
    );
  if (!file) {
    if (requiredFile) throw Error(`${name}_FILE is required in pilot mode.`);
    return env[name] || "";
  }
  try {
    const stat = lstatSync(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.mode & 0o077 ||
      stat.size > 16384
    )
      throw Error("invalid");
    const value = readFileSync(file, "utf8").trim();
    if (!value) throw Error("empty");
    return value;
  } catch {
    throw Error(
      `${name}_FILE must be a private regular file (0400/0600), nonempty and at most 16 KiB.`,
    );
  }
}
