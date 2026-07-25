import { chromium } from "playwright";
const base = "http://localhost:3000";
const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto(`${base}/setup`, { waitUntil: "load", timeout: 30000 });
await page.fill('input[name="facilitatorName"]', "Priya");
await page.fill('input[name="title"]', "Learn Header Test 3");
await page.fill('textarea[name="goal"]', "verify learn header button");
await page.click('button[type="submit"]');
await page.waitForURL(/\/sessions\/.+\/facilitator/, { timeout: 30000 });
const learnerLink = await page.locator('input[readonly]').inputValue();

const learnerCtx = await browser.newContext();
const learnerPage = await learnerCtx.newPage();
await learnerPage.goto(learnerLink, { waitUntil: "load", timeout: 30000 });
await learnerPage.fill('input[name="displayName"]', "Learner Lee");
await learnerPage.check('input[name="consent"]');
await learnerPage.click('button[type="submit"]');
await learnerPage.waitForURL(/\/sessions\/.+\/learn/, { timeout: 30000 });

const btn = learnerPage.locator('#header-language-slot button[aria-haspopup="listbox"]');
console.log("learn header button count:", await btn.count());
console.log("learn header button text:", await btn.textContent());
await learnerPage.screenshot({ path: "/tmp/claude-1000/-srv-f/86afa0e1-fd1c-4e7b-8d0b-fdcafb43c9c2/scratchpad/learn-header.png", clip: { x: 0, y: 0, width: 1280, height: 60 } });

await browser.close();
