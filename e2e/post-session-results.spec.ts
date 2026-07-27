import { expect, test } from "@playwright/test";

test.setTimeout(60_000);

test("facilitator can view post-session results after ending a session", async ({ browser }) => {
  const facilitatorContext = await browser.newContext();
  const learnerContext = await browser.newContext();
  try {
    const facilitator = await facilitatorContext.newPage();
    const learner = await learnerContext.newPage();

    await facilitator.goto("/setup");
    await facilitator.fill('input[name="facilitatorName"]', "Results Facilitator");
    await facilitator.fill('input[name="title"]', "Results page test");
    await facilitator.fill('textarea[name="goal"]', "Verify the post-session results page.");

    const sourceSelect = facilitator.locator('select[name="sourceLanguage"]');
    if (await sourceSelect.count()) await sourceSelect.selectOption("en");

    const retention = facilitator.locator('input[name="retentionDays"]');
    if (await retention.count()) await retention.fill("7");

    await Promise.all([
      facilitator.waitForURL(/\/sessions\/[^/]+\/facilitator/),
      facilitator.locator('button[type="submit"], button:has-text("Create session")').first().click(),
    ]);
    const dashboardUrl = facilitator.url();
    const resultsUrl = `${dashboardUrl}/results`;
    const learnerLink = await facilitator.getByLabel("Learner invitation link").inputValue();
    const learnerPath = new URL(learnerLink).pathname;

    await facilitator.goto(new URL(resultsUrl).pathname);
    await expect(facilitator.getByText("Results are not ready yet")).toBeVisible();
    await facilitator.getByRole("link", { name: "Return to dashboard" }).click();
    await expect(facilitator).toHaveURL(dashboardUrl);

    await learner.goto(learnerPath);
    await learner.fill('input[name="displayName"]', "Results Learner");
    await learner.locator('input[name="consent"]').check();
    await Promise.all([
      learner.waitForURL(/\/sessions\/[^/]+\/learn/),
      learner.getByRole("button", { name: "Join session" }).click(),
    ]);

    await facilitator.getByRole("button", { name: "Start session" }).click();
    await facilitator.getByRole("button", { name: "End session" }).click();
    await facilitator.getByRole("button", { name: "Confirm" }).click();
    await expect(facilitator.getByRole("link", { name: "View results" })).toBeVisible();
    await facilitator.getByRole("link", { name: "View results" }).click();
    await expect(facilitator).toHaveURL(/\/sessions\/[^/]+\/facilitator\/results$/);

    await expect(facilitator.getByRole("heading", { name: "Session results" })).toBeVisible();
    await expect(facilitator.getByText("Results page test")).toBeVisible();
    await expect(facilitator.getByText("0 messages")).toBeVisible();
    await expect(facilitator.getByText("0 questions")).toBeVisible();
    await expect(facilitator.getByRole("link", { name: "Return to dashboard" })).toHaveAttribute("href", new URL(dashboardUrl).pathname);

    await learner.goto(new URL(resultsUrl).pathname);
    await expect(learner).toHaveURL(/\/setup$/);
  } finally {
    await facilitatorContext.close();
    await learnerContext.close();
  }
});
