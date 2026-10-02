import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const baseUrl = arg("--base-url", "http://127.0.0.1:4173");
const captureId = arg("--capture");
const output = arg("--output");
const metadataOutput = arg("--metadata-output");
if (!captureId || !output) process.exit(2);

const contract = JSON.parse(await fs.readFile(new URL("./ui-visual-capture.json", import.meta.url), "utf8"));
const capture = contract.captures.find((x) => x.id === captureId);
if (!capture) throw new Error("Unknown capture id: " + captureId);

const viewport = {
  width: capture.viewport?.width ?? 1365,
  height: capture.viewport?.height ?? 900,
  deviceScaleFactor: capture.viewport?.device_scale_factor ?? 1,
};
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    locale: capture.locale ?? "zh-CN",
    colorScheme: capture.color_scheme ?? "dark",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const targetUrl = new URL(capture.route ?? "/", baseUrl).toString();
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator("#mediaWorkspace").waitFor({ state: "attached", timeout: 30000 });

  const state = capture.fixture?.state ?? "prepare-shell";
  if (state === "prepare-shell") {
    await page.evaluate(() => {
      document.querySelector("#envDetails")?.setAttribute("open", "");
      document.querySelector(".log-card")?.setAttribute("open", "");
      scrollTo(0, 0);
    });
  } else if (state === "guided-produce") {
    await page.evaluate(() => {
      const guided = document.querySelector('[data-hardsub-strategy="guided"]');
      if (guided) guided.click();
      ["subtitleCard", "planCard", "encodeCard"].forEach((id) => document.querySelector("#" + id)?.classList.remove("hidden"));
      scrollTo(0, 0);
    });
  } else if (state === "manual-media") {
    await page.evaluate(() => {
      document.querySelector('[data-hardsub-strategy="manual"]')?.click();
      document.querySelectorAll("#mediaWorkspace details").forEach((node) => node.setAttribute("open", ""));
      scrollTo(0, 0);
    });
  } else if (state === "mobile-produce") {
    await page.evaluate(() => {
      document.body.dataset.mobileStage = "produce";
      document.querySelector('[data-hardsub-strategy="guided"]')?.click();
      ["subtitleCard", "planCard", "encodeCard"].forEach((id) => document.querySelector("#" + id)?.classList.remove("hidden"));
      document.querySelector(".mobile-runtime-option")?.setAttribute("open", "");
      scrollTo(0, 0);
    });
  }

  const ready = capture.ready ?? {};
  if (ready.selector) await page.locator(ready.selector).first().waitFor({ state: ready.state ?? "visible", timeout: 30000 });
  if (ready.settle_ms) await page.waitForTimeout(ready.settle_ms);
  await fs.mkdir(path.dirname(output), { recursive: true });

  if (capture.capture_region === "element") {
    await page.locator(capture.selector).first().screenshot({ path: output, animations: "disabled" });
  } else if (capture.capture_region === "full-page") {
    await page.screenshot({ path: output, fullPage: true, animations: "disabled" });
  } else {
    await page.screenshot({ path: output, fullPage: false, animations: "disabled" });
  }

  if (metadataOutput) {
    await fs.mkdir(path.dirname(metadataOutput), { recursive: true });
    await fs.writeFile(metadataOutput, JSON.stringify({
      schema_version: 1,
      capture_id: capture.id,
      surface_ids: capture.surface_ids,
      adapter: capture.adapter,
      evidence_level: capture.evidence_level,
      browser: { name: "chromium", version: browser.version() },
      target_url: targetUrl,
      viewport,
      color_scheme: capture.color_scheme ?? "dark",
      locale: capture.locale ?? "zh-CN",
      selector: capture.selector ?? null,
      fixture: capture.fixture ?? null,
      page_errors: errors,
    }, null, 2) + "\n");
  }
} finally {
  await browser.close();
}
