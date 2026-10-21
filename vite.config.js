import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { loadLocalEnv, readConfig } from "./server/config.mjs";
loadLocalEnv();
export default defineConfig(({ command }) => {
  const config = readConfig(process.env, { serving: command === "serve" });
  return {
    plugins: [react()],
    server: {
      host: config.host,
      port: config.frontendPort,
      strictPort: true,
      proxy: { "/api": `http://${config.host}:${config.port}` },
    },
  };
});
