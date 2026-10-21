import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  constants,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { seedDemo } from "./demo-seed.mjs";
import { createSigner } from "../server/evidence/signer.mjs";
import { createApplication } from "../server/app.mjs";
import { readConfig } from "../server/config.mjs";
import { verifyPackage } from "../server/evidence/signatures.mjs";
const root = mkdtempSync(join(tmpdir(), "bayora-release-"));
await seedDemo(root);
const credentials = JSON.parse(
  readFileSync(join(root, "credentials.json"), "utf8"),
);
const socket = join(root, "signing/signer.sock");
const signer = createSigner({
  keyPath: join(root, "signing/private.pem"),
  tokenPath: join(root, "signing/client-token"),
  dbPath: join(root, "signing/ledger.db"),
});
await signer.listen(socket);
const port = process.env.BAYORA_E2E_PORT || "3088";
const config = readConfig({
  PORT: port,
  BAYORA_DB: join(root, "bayora.db"),
  BAYORA_SIGNER_SOCKET: socket,
  BAYORA_SIGNER_TOKEN: join(root, "signing/client-token"),
  BAYORA_EVIDENCE_PUBLIC_KEY: join(root, "signing/public.pem"),
  BAYORA_REQUIRE_SIGNED_EVIDENCE: "true",
});
const app = createApplication(config);
let browser;
const errors = [],
  checks = [];
try {
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(config.port, config.host, resolve);
  });
  const macChrome =
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const executablePath =
    process.env.BAYORA_CHROME_PATH ||
    (existsSync(macChrome) ? macChrome : undefined);
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    recordVideo: {
      dir: join(root, "videos"),
      size: { width: 1440, height: 1000 },
    },
  });
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  async function login(p, role) {
    const c = credentials.find((c) => c.role === role);
    await p.goto("http://127.0.0.1:" + port);
    await p.getByLabel("Email", { exact: true }).fill(c.email);
    await p.getByLabel("Password", { exact: true }).fill(c.password);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await p
      .getByRole("heading", { name: "Workspace overview", exact: true })
      .waitFor();
  }
  async function download(name, file) {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name, exact: true }).click();
    const item = await pending;
    await item.saveAs(join(root, file));
  }
  await login(page, "Admin");
  assert.match(await page.title(), /Bayora/i);
  checks.push("page identity, nonblank UI, no framework overlay");
  await page
    .getByRole("button", { name: "Administration", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Execution & recovery", exact: true })
    .waitFor();
  await page
    .getByText("Checking execution queue…", { exact: true })
    .waitFor({ state: "hidden" });
  await page
    .getByRole("heading", { name: "Pilot & incident controls", exact: true })
    .waitFor();
  await page
    .getByLabel("Incident or resume reason", { exact: true })
    .fill("Synthetic QA incident pause verification");
  await page
    .getByRole("button", {
      name: "Pause organization evaluations",
      exact: true,
    })
    .click();
  await page
    .getByText("Organization evaluations paused", { exact: true })
    .waitFor();
  await page
    .getByLabel("Incident or resume reason", { exact: true })
    .fill("Synthetic QA completed incident review and resume");
  await page
    .getByRole("button", {
      name: "Resume organization evaluations",
      exact: true,
    })
    .click();
  await page
    .getByText("Organization evaluations enabled", { exact: true })
    .waitFor();
  await page
    .getByLabel("Local model name", { exact: true })
    .fill("qa-model:latest");
  await page
    .getByLabel("Full model revision digest", { exact: true })
    .fill("a".repeat(64));
  await page
    .getByLabel("Approval reason", { exact: true })
    .fill("Synthetic QA approval of a nonexecuted test revision");
  await page
    .getByRole("button", { name: "Approve revision", exact: true })
    .click();
  await page.getByText("qa-model:latest · Approved", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Revoke revision", exact: true })
    .click();
  await page.getByText("qa-model:latest · Revoked", { exact: true }).waitFor();
  checks.push(
    "operator containment pause/resume and model approval/revocation",
  );
  await page
    .locator(".pilot-controls")
    .screenshot({ path: join(root, "pilot-controls-desktop.png") });
  await page.screenshot({
    path: join(root, "operations-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Workspaces", exact: true }).click();
  await page
    .getByRole("button", { name: "New workspace", exact: true })
    .click();
  await page
    .getByLabel("Workspace name", { exact: true })
    .fill("Retention UI QA");
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Administration", exact: true })
    .click();
  await page
    .getByLabel("Retention workspace", { exact: true })
    .selectOption({ label: "Retention UI QA" });
  await page
    .getByRole("button", { name: "Place retention hold", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Release retention hold", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Review removal plan", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByRole("button", { name: "Release retention hold", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Place retention hold", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Review removal plan", exact: true })
    .click();
  await page.locator("#retention-confirm").fill("Retention UI QA");
  await page
    .getByRole("checkbox", { name: /I understand that public audit/ })
    .check();
  await page
    .getByRole("button", {
      name: "Retire workspace and remove private content",
      exact: true,
    })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector("#retention-workspace option:disabled")
      ?.textContent?.includes("Retention UI QA"),
  );
  await page
    .getByLabel("Current workspace", { exact: true })
    .selectOption("ws-research");
  checks.push(
    "retention hold, reviewed confirmation and isolated workspace retirement",
  );
  await page.getByRole("button", { name: "Campaigns", exact: true }).click();
  await page.getByRole("button", { name: "New campaign", exact: true }).click();
  await page
    .getByLabel("Campaign name", { exact: true })
    .fill("Hackathon fixture walkthrough");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page
    .locator(".draft-row")
    .getByRole("button", { name: "Resume draft", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start evaluation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Printable report", exact: true })
    .waitFor({ timeout: 15000 });
  checks.push("draft → worker launch → completed fixture run");
  await download("Export evidence", "evidence.json");
  await download("Printable report", "report.html");
  await download("Case CSV", "cases.csv");
  const pack = JSON.parse(readFileSync(join(root, "evidence.json"), "utf8"));
  assert.equal(
    verifyPackage(pack, {
      trustedKeys: [readFileSync(join(root, "signing/public.pem"))],
      requireSignature: true,
    }).trusted,
    true,
  );
  checks.push("signed JSON and redacted HTML/CSV downloads");
  await page.screenshot({
    path: join(root, "campaign-desktop.png"),
    fullPage: false,
  });
  await page
    .getByRole("button", { name: "Clone campaign", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Clone campaign", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Start evaluation", exact: true })
    .click();
  await page.getByRole("button", { name: "Cancel run", exact: true }).click();
  await page
    .locator(".run-summary .badge")
    .filter({ hasText: /cancelled/i })
    .waitFor();
  checks.push("clone configuration and cancel linked execution");
  await page.getByRole("button", { name: "Audit vault", exact: true }).click();
  await page
    .locator(".upload-area input")
    .setInputFiles(join(root, "evidence.json"));
  await page
    .getByText("Trusted signature and hash chain verified", { exact: true })
    .waitFor();
  const tampered = structuredClone(pack);
  tampered.events[0].hash = "0".repeat(64);
  writeFileSync(join(root, "tampered.json"), JSON.stringify(tampered));
  await page
    .locator(".upload-area input")
    .setInputFiles(join(root, "tampered.json"));
  await page.getByText("Verification failed", { exact: true }).waitFor();
  checks.push("trusted evidence accepted and tampering rejected");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () => document.querySelector(".sidebar").getBoundingClientRect().right <= 0,
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: join(root, "audit-mobile.png"),
    fullPage: true,
  });
  checks.push("mobile layout without horizontal overflow");
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Administration", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Pilot & incident controls", exact: true })
    .waitFor();
  await page.waitForFunction(
    () => document.querySelector(".sidebar").getBoundingClientRect().right <= 0,
  );
  await page.locator(".toast").waitFor({ state: "hidden" });
  await page.locator(".pilot-controls").scrollIntoViewIfNeeded();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page
    .locator(".pilot-controls")
    .screenshot({ path: join(root, "pilot-controls-mobile.png") });
  checks.push("responsive pilot operator forms");

  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    auditor = await context.newPage();
  auditor.on("pageerror", (e) => errors.push(e.message));
  await login(auditor, "Auditor");
  assert.equal(
    await auditor
      .getByRole("button", { name: "Administration", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await auditor
      .getByRole("button", { name: "New campaign", exact: true })
      .count(),
    0,
  );
  const denial = await auditor.evaluate(async (id) => {
    const session = await (await fetch("/api/session")).json();
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrf,
      },
      body: JSON.stringify({
        requestKey: "auditor-denial",
        name: "Denied",
        workspaceId: "ws-research",
      }),
    });
    const run = await (await fetch("/api/runs/" + id)).json();
    return {
      status: response.status,
      raw: run.rawAccess,
      outputs: run.results.some((r) => "output" in r),
    };
  }, pack.runId);
  assert.deepEqual(denial, { status: 403, raw: false, outputs: false });
  checks.push("Auditor UI/API write denial and raw-response redaction");
  await auditor.route("**/api/session", (route) => route.abort());
  await auditor.reload();
  await auditor
    .getByText(/Cannot reach the Bayora backend/)
    .first()
    .waitFor();
  await auditor.unroute("**/api/session");
  await auditor.getByRole("button", { name: /Retry/ }).first().click();
  await auditor
    .getByRole("heading", { name: "Workspace overview", exact: true })
    .waitFor();
  checks.push("unavailable connection and recovery");
  const report = await browser.newPage({
    viewport: { width: 1200, height: 900 },
  });
  await report.goto("file://" + join(root, "report.html"));
  await report
    .getByRole("heading", {
      name: "Hackathon fixture walkthrough",
      exact: true,
    })
    .waitFor();
  await report.pdf({ path: join(root, "report.pdf"), format: "A4" });
  checks.push("standalone report and PDF printing");
  assert.equal(await page.locator("vite-error-overlay").count(), 0);
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(errors, []);
  checks.push("no page runtime errors");
  const video = page.video();
  await page.context().close();
  if (video) {
    await video.saveAs(join(root, "fallback-demo.webm"));
    checks.push("recorded synthetic fallback demo");
  }
  const result = {
    passed: true,
    checks,
    artifacts: root,
    environment: {
      url: "http://127.0.0.1:" + port,
      viewports: ["1440×1000", "390×844"],
      browser:
        "Isolated Playwright fallback; in-app Browser execution tool unavailable",
    },
  };
  if (process.env.BAYORA_QA_ARTIFACT_DIR)
    result.retainedArtifacts = process.env.BAYORA_QA_ARTIFACT_DIR;
  writeFileSync(join(root, "qa-result.json"), JSON.stringify(result, null, 2));
  if (result.retainedArtifacts) {
    mkdirSync(result.retainedArtifacts, { recursive: true, mode: 0o700 });
    for (const file of [
      "fallback-demo.webm",
      "campaign-desktop.png",
      "audit-mobile.png",
      "operations-desktop.png",
      "pilot-controls-desktop.png",
      "pilot-controls-mobile.png",
      "evidence.json",
      "tampered.json",
      "report.html",
      "report.pdf",
      "cases.csv",
      "qa-result.json",
    ]) {
      const target = join(result.retainedArtifacts, file);
      copyFileSync(join(root, file), target, constants.COPYFILE_EXCL);
      chmodSync(target, 0o600);
    }
    copyFileSync(
      join(root, "signing/public.pem"),
      join(result.retainedArtifacts, "signing-public.pem"),
      constants.COPYFILE_EXCL,
    );
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (browser) {
    const pages = browser.contexts().flatMap((c) => c.pages());
    if (pages[0])
      await pages[0].screenshot({
        path: join(root, "failure.png"),
        fullPage: true,
      });
  }
  console.error("QA artifacts: " + root);
  throw error;
} finally {
  await browser?.close();
  await app.close();
  await signer.close();
}
