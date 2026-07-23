import { expect, test } from "@playwright/test";

/**
 * Phase 0 acceptance smoke test: a facilitator can create a session and get
 * a shareable, opaque learner join link — the join link itself must never
 * expose the underlying session ID (see docs/PLAN.md "Session creation and
 * join flow").
 */
test("facilitator can create a session and receives an opaque learner link", async ({ page }) => {
  await page.goto("/setup");

  await page.fill('input[name="facilitatorName"]', "E2E Facilitator");
  await page.fill('input[name="title"]', "E2E smoke test session");
  await page.fill('textarea[name="goal"]', "Verify the create-session flow end to end.");

  const sourceSelect = page.locator('select[name="sourceLanguage"]');
  if (await sourceSelect.count()) await sourceSelect.selectOption("en");

  await page.locator('input[name="learnerLanguages"][value="zh"]').check();

  const retention = page.locator('input[name="retentionDays"]');
  if (await retention.count()) await retention.fill("7");

  await Promise.all([
    page.waitForURL(/\/sessions\/[^/]+\/facilitator/),
    page.locator('button[type="submit"], button:has-text("Create session")').first().click(),
  ]);

  await expect(page.getByText("E2E smoke test session")).toBeVisible();

  const learnerLinkInput = page.getByLabel("Learner invitation link");
  await expect(learnerLinkInput).toBeVisible();
  const learnerLink = await learnerLinkInput.inputValue();

  expect(learnerLink).toMatch(/^\/join\/[A-Za-z0-9_-]+$/);
  expect(learnerLink).not.toContain(page.url().split("/sessions/")[1]?.split("/")[0] ?? "__no-session-id__");
});
