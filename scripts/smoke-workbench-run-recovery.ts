import { chromium, type Browser } from "playwright";
import { redact } from "../src/redact";

const baseUrl = process.env.DOCS_TRIALS_BASE_URL ?? "http://localhost:8787";
const sampleRunId = "realtimekit-video-room-v1-1784203200000";
const browserErrors: string[] = [];
let browser: Browser | undefined;

try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.goto(`${baseUrl}/runs/${sampleRunId}`);
  await page.getByRole("button", { name: "View assembled report" }).waitFor({ timeout: 10_000 });
  await page.reload();
  await page.getByRole("button", { name: "View assembled report" }).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "View assembled report" }).click();
  await page.getByRole("heading", { name: /Result:/ }).waitFor();

  await page.goto(baseUrl);
  await page.getByRole("button", { name: "View sample report" }).click();
  await page.getByRole("heading", { name: /Result:/ }).waitFor();

  await page.goto(`${baseUrl}/runs/local-agent-preview`);
  await page.getByRole("heading", { name: "This run is not available." }).waitFor();
  const replayCount = await page.getByText("Replay in progress").count();

  await page.goto(`${baseUrl}/trials/new`);
  await page.getByLabel("Trial title").fill("My docs trial");
  await page.getByLabel("Required task").fill("Build a visible documented feature.");
  await page.getByLabel("Documentation sources").fill("https://example.com/docs");
  await page.getByRole("button", { name: "Review frozen manifest" }).click();
  await page.getByText("BROWSER-ONLY DRAFT", { exact: true }).waitFor();
  const fakeRunActionCount = await page
    .getByRole("button", { name: /local runner connection/i })
    .count();
  const customRouteStayedInReview = page.url().endsWith("/trials/custom/review");

  const passed =
    browserErrors.length === 0 &&
    replayCount === 0 &&
    fakeRunActionCount === 0 &&
    customRouteStayedInReview;
  console.log(
    JSON.stringify({
      profile: "workbench-run-recovery",
      outcome: passed ? "passed" : "failed",
      browserErrors,
      unsupportedRunReplayCount: replayCount,
      fakeRunActionCount,
      customRouteStayedInReview,
    }),
  );
  if (!passed) process.exitCode = 1;
} catch (error) {
  console.log(
    JSON.stringify({
      profile: "workbench-run-recovery",
      outcome: "failed",
      error: redact(error instanceof Error ? error.message : String(error)),
      browserErrors,
    }),
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
}
