// Read-only local preview: no account, business data or API writes.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const origin = new URL(process.env.QA_URL || "http://127.0.0.1:5173");
assert(["localhost", "127.0.0.1"].includes(origin.hostname), "Use only the local synthetic QA preview");
const output = path.resolve("tmp/approval-board-layout");
const settle = page => page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all(document.getAnimations().filter(a => Number(a.effect?.getComputedTiming().endTime) < 2000).map(a => a.finished.catch(() => undefined)));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
});
const measure = page => page.evaluate(() => {
  const board = document.querySelector(".approval-kanban"), content = document.querySelector(".app-content");
  const bar = document.querySelector(".ws2-process-toolbar"), hero = document.querySelector(".workflow-hero-header");
  const controls = [...bar.children].map(el => el.getBoundingClientRect());
  const rail = document.querySelector(".app-rail"), railVisible = getComputedStyle(rail).display !== "none";
  const rect = board.getBoundingClientRect(), zoom = Number(getComputedStyle(document.documentElement).zoom) || 1;
  return {
    above: (Math.min(...controls.map(r => r.top)) - hero.getBoundingClientRect().bottom) / zoom,
    below: (bar.getBoundingClientRect().bottom - Math.max(...controls.map(r => r.bottom))) / zoom,
    railBottom: railVisible ? rail.getBoundingClientRect().bottom : null,
    boardBottom: rect.bottom, boardHeight: rect.height / zoom,
    columnBottoms: [...document.querySelectorAll(".approval-column")].map(el => el.getBoundingClientRect().bottom),
    nativeInset: board.offsetHeight - board.clientHeight,
    verticalPageOverflow: content.scrollHeight - content.clientHeight,
    documentOverflow: document.documentElement.scrollWidth - innerWidth,
    boardRight: rect.right, viewportWidth: innerWidth,
    pageMargin: parseFloat(getComputedStyle(content).marginBottom), zoom,
    coarse: matchMedia("(pointer: coarse)").matches,
  };
});

(async () => {
  await fs.mkdir(output, { recursive: true });
  // Playwright normally hides native rails; keep them for real gutter/baseline checks.
  const browser = await chromium.launch({ channel: "msedge", headless: true, ignoreDefaultArgs: ["--hide-scrollbars"] });
  const checks = [], errors = [];
  try {
    const cases = [
      { width: 1920, height: 1080 }, { width: 1440, height: 960 }, { width: 2560, height: 1080 },
      { width: 1024, height: 768 }, { width: 1440, height: 450 }, { width: 640, height: 720 },
      // Effective CSS viewport of a 1440x960 window at 200%; not a native zoom assertion.
      { width: 390, height: 640 }, { width: 720, height: 480, zoomEquivalent: 2 },
      { width: 1280, height: 800, touch: true }, { width: 1440, height: 960, forcedColors: true },
    ];
    for (const theme of ["light", "dark"]) for (const config of cases) {
      const context = await browser.newContext({ viewport: { width: config.width, height: config.height }, hasTouch: Boolean(config.touch), reducedMotion: "reduce", forcedColors: config.forcedColors ? "active" : "none" });
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/api/v1/**", route => route.fulfill({ status: 403, json: { detail: "Read-only local QA" } }));
      const pair = [];
      for (const section of ["payments", "trips"]) {
        const label = `${theme}-${config.width}x${config.height}${config.zoomEquivalent ? "-200-percent-layout" : ""}${config.touch ? "-touch" : ""}${config.forcedColors ? "-contrast" : ""}-${section}`;
        await page.goto(new URL(`/qa/page-canvas.html?section=${section}&theme=${theme}&boardStress=1`, origin).href);
        await page.locator(".approval-kanban").waitFor();
        await settle(page);
        let geometry = await measure(page);
        assert(Math.abs(geometry.above - geometry.below) < 1, `${label}: unequal toolbar spacing ${JSON.stringify(geometry)}`);
        assert(geometry.documentOverflow <= 1 && geometry.boardRight <= geometry.viewportWidth + 1, `${label}: horizontal page overflow`);
        assert(geometry.boardHeight >= 239, `${label}: clipped minimum board height ${JSON.stringify(geometry)}`);
        assert.equal(geometry.nativeInset, geometry.coarse ? 8 : 4, `${label}: native horizontal rail thickness`);
        assert(geometry.columnBottoms.every(bottom => Math.abs(bottom - geometry.columnBottoms[0]) < 1), `${label}: unequal columns`);
        assert(Math.abs(geometry.boardBottom - geometry.columnBottoms[0] - geometry.nativeInset * geometry.zoom) < 1.1, `${label}: rail must sit immediately below lanes`);
        if (geometry.verticalPageOverflow <= 1 && geometry.railBottom !== null) {
          assert(Math.abs(geometry.columnBottoms[0] - geometry.railBottom) < 1, `${label}: lanes/sidebar baseline mismatch`);
        }
        await page.locator(".app-content").evaluate(el => { el.scrollTop = el.scrollHeight; });
        await settle(page);
        geometry = await measure(page);
        assert(geometry.boardBottom <= config.height + 1, `${label}: rail unreachable at page bottom`);
        const board = page.locator(".approval-kanban");
        if (await board.evaluate(el => el.scrollWidth > el.clientWidth)) {
          await board.evaluate(el => { el.scrollLeft = el.scrollWidth; });
          assert(await board.evaluate(el => el.scrollLeft > 0), `${label}: horizontal rail cannot scroll`);
          await board.evaluate(el => { el.scrollLeft = 0; });
        }
        const laneScroll = await page.locator(".approval-column-stack").evaluateAll(els => {
          const lane = els.find(el => el.scrollHeight > el.clientHeight + 1);
          if (!lane) return false;
          lane.scrollTop = lane.scrollHeight;
          return lane.scrollTop > 0;
        });
        assert(laneScroll, `${label}: populated lane must scroll independently`);
        await page.screenshot({ path: path.join(output, `${label}.png`) });
        // The reserved rail space belongs to boards only, not list mode.
        await page.locator(".app-content").evaluate(el => { el.scrollTop = 0; });
        await page.getByRole("button", { name: "Список", exact: true }).click(); await settle(page);
        assert.equal(await board.count(), 0);
        assert.equal(await page.locator(".app-content").evaluate(el => parseFloat(getComputedStyle(el).marginBottom)), 0);
        await page.getByRole("button", { name: "Канбан", exact: true }).click(); await settle(page);
        assert.equal((await measure(page)).nativeInset, geometry.nativeInset);
        checks.push({ label, ...geometry }); pair.push(geometry);
        console.log(`PASS ${label}`);
      }
      assert(Math.abs(pair[0].above - pair[1].above) < 1, `${theme}-${config.width}: payment/trip spacing differs`);
      await context.close();
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ checks, errors }, null, 2));
    console.log(`PASS: ${checks.length} native Edge board cases; equal navigation spacing, aligned lanes, compact rails, independent scrolling and list/board switching.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
