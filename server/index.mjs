import { createApplication } from "./app.mjs";
import { loadLocalEnv, readConfig } from "./config.mjs";
try {
  loadLocalEnv();
  const config = readConfig();
  const app = createApplication(config);
  app.server.on("error", (error) => {
    console.error(
      `Bayora could not start: ${error.code === "EADDRINUSE" ? `port ${config.port} is already in use` : error.message}`,
    );
    process.exitCode = 1;
  });
  app.server.listen(config.port, config.host, () =>
    console.log(`Bayora local API: http://${config.host}:${config.port}`),
  );
  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      if (closing) return;
      closing = true;
      try {
        await app.close();
      } catch (e) {
        console.error(e.message);
        process.exitCode = 1;
      }
    });
} catch (error) {
  console.error(`Bayora configuration/startup error: ${error.message}`);
  process.exitCode = 1;
}
