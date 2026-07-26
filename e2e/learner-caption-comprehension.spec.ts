import { expect, test } from "@playwright/test";

test("learner can ask comprehension questions from live captions", async ({ browser }) => {
  const facilitatorContext = await browser.newContext();
  const learnerContext = await browser.newContext();
  try {
    const facilitator = await facilitatorContext.newPage();
    const learner = await learnerContext.newPage();

    await facilitator.goto("/setup");
    await facilitator.fill('input[name="facilitatorName"]', "Caption Facilitator");
    await facilitator.fill('input[name="title"]', "Caption comprehension test");
    await facilitator.fill('textarea[name="goal"]', "Verify caption comprehension actions.");

    const sourceSelect = facilitator.locator('select[name="sourceLanguage"]');
    if (await sourceSelect.count()) await sourceSelect.selectOption("en");

    const retention = facilitator.locator('input[name="retentionDays"]');
    if (await retention.count()) await retention.fill("7");

    await Promise.all([
      facilitator.waitForURL(/\/sessions\/[^/]+\/facilitator/),
      facilitator.locator('button[type="submit"], button:has-text("Create session")').first().click(),
    ]);

    const learnerLink = await facilitator.getByLabel("Learner invitation link").inputValue();
    await learner.goto(new URL(learnerLink).pathname);
    await learner.fill('input[name="displayName"]', "Caption Learner");
    await learner.locator('input[name="consent"]').check();
    await Promise.all([
      learner.waitForURL(/\/sessions\/[^/]+\/learn/),
      learner.getByRole("button", { name: "Join session" }).click(),
    ]);

    await expect(learner.getByRole("button", { name: "Explain simply" })).toHaveCount(0);
    await expect(learner.getByRole("button", { name: "Give an example" })).toHaveCount(0);

    await facilitator.getByRole("button", { name: "Start session" }).click();
    await facilitator.locator('textarea[name="captionText"]').fill("Normalize the request payload before validating fields.");
    await facilitator.getByRole("button", { name: "Publish" }).click();

    await learner.getByRole("tab", { name: "Captions" }).click();
    await expect(learner.getByText("Normalize the request payload before validating fields.")).toBeVisible();
    await learner.getByRole("button", { name: "Explain simply" }).click();

    await expect(facilitator.getByText("Question")).toBeVisible();
    await expect(
      facilitator.getByText('Please explain this simply: "Normalize the request payload before validating fields."'),
    ).toBeVisible();

    await facilitator.getByRole("button", { name: "End session" }).click();
    await expect(learner.getByRole("button", { name: "Explain simply" })).toHaveCount(0);
    await expect(learner.getByRole("button", { name: "Give an example" })).toHaveCount(0);
  } finally {
    await facilitatorContext.close();
    await learnerContext.close();
  }
});
