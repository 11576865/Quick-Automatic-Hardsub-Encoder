import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const baseUrl = arg("--base-url", "http://127.0.0.1:4174");
const bridgeUrl = arg("--bridge-url", "http://127.0.0.1:9347");
const token = arg("--token");
const captureId = arg("--capture", "QHE.WINDOWS_NATIVE.RUNTIME_DESKTOP_DARK");
const output = arg("--output");
const metadataOutput = arg("--metadata-output");
if (!token || !output) process.exit(2);

const contract = JSON.parse(await fs.readFile(new URL("./ui-visual-capture.json", import.meta.url), "utf8"));
const capture = contract.captures.find((x) => x.id === captureId);
if (!capture) throw new Error("Unknown capture id: " + captureId);
if (capture.adapter !== "windows-runtime-web") throw new Error("Capture is not a Windows runtime state: " + captureId);

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

  const url = new URL(capture.route ?? "/", baseUrl);
  url.searchParams.set("windowsNative", bridgeUrl);
  url.searchParams.set("token", token);
  await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 60000 });

  await page.waitForFunction(
    () => document.querySelector("#runtimeModeBadge")?.textContent?.trim() === "WINDOWS NATIVE",
    null,
    { timeout: 60000 }
  );
  await page.waitForFunction(
    () => document.body.dataset.runtimeBackend === "windows-native",
    null,
    { timeout: 30000 }
  );
  const visibleUrl = new URL(page.url());
  if (visibleUrl.searchParams.has("token")) throw new Error("Windows launch token was not scrubbed from visible URL");

  const health = await page.evaluate(async ({ bridgeUrl, token }) => {
    const response = await fetch(bridgeUrl + "/api/health", {
      headers: { "X-Quick-Hardsub-Token": token },
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Bridge health failed: " + response.status);
    return await response.json();
  }, { bridgeUrl, token });
  if (health.backend !== "windows-native" || !health.available) {
    throw new Error("Real Bridge health did not report available windows-native backend");
  }

  const envDetails = page.locator("#envDetails");
  if (await envDetails.count()) await envDetails.evaluate((node) => node.setAttribute("open", ""));
  const runtimeHelp = page.locator(".mobile-runtime-option");
  if (await runtimeHelp.count()) await runtimeHelp.first().evaluate((node) => node.setAttribute("open", ""));
  await page.evaluate(() => scrollTo(0, 0));
  if (capture.ready?.settle_ms) await page.waitForTimeout(capture.ready.settle_ms);

  await fs.mkdir(path.dirname(output), { recursive: true });
  await page.screenshot({ path: output, fullPage: capture.capture_region === "full-page", animations: "disabled" });

  if (metadataOutput) {
    await fs.mkdir(path.dirname(metadataOutput), { recursive: true });
    await fs.writeFile(metadataOutput, JSON.stringify({
      schema_version: 1,
      capture_id: capture.id,
      surface_ids: capture.surface_ids,
      adapter: capture.adapter,
      evidence_level: capture.evidence_level,
      browser: { name: "chromium", version: browser.version() },
      target_url: new URL(capture.route ?? "/", baseUrl).toString(),
      bridge: {
        url: bridgeUrl,
        backend: health.backend,
        platform: health.platform,
        available: health.available,
        bridgeVersion: health.bridgeVersion,
        taskSchemaVersion: health.taskSchemaVersion,
        ffmpegVersion: health.ffmpegVersion,
        ffmpegSource: health.ffmpegSource,
        encoders: Array.isArray(health.encoders) ? health.encoders.filter((x) => x?.available).map((x) => x.key ?? x.Key ?? String(x)) : [],
      },
      viewport,
      color_scheme: capture.color_scheme ?? "dark",
      locale: capture.locale ?? "zh-CN",
      page_errors: errors,
    }, null, 2) + "\n");
  }
} finally {
  await browser.close();
}
