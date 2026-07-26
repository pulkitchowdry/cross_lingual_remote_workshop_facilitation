import { expect, test } from "@playwright/test";

test("private chat stays between a learner and the facilitator", async ({ browser }) => {
  const facilitatorContext = await browser.newContext();
  const learnerAContext = await browser.newContext();
  const learnerBContext = await browser.newContext();
  try {
    const facilitator = await facilitatorContext.newPage();
    const learnerA = await learnerAContext.newPage();
    const learnerB = await learnerBContext.newPage();

    await facilitator.goto("/setup");
    await facilitator.fill('input[name="facilitatorName"]', "Private Facilitator");
    await facilitator.fill('input[name="title"]', "Private message test");
    await facilitator.fill('textarea[name="goal"]', "Verify private chat visibility.");

    const sourceSelect = facilitator.locator('select[name="sourceLanguage"]');
    if (await sourceSelect.count()) await sourceSelect.selectOption("en");

    const retention = facilitator.locator('input[name="retentionDays"]');
    if (await retention.count()) await retention.fill("7");

    await Promise.all([
      facilitator.waitForURL(/\/sessions\/[^/]+\/facilitator/),
      facilitator.locator('button[type="submit"], button:has-text("Create session")').first().click(),
    ]);

    const learnerLink = await facilitator.getByLabel("Learner invitation link").inputValue();
    const learnerPath = new URL(learnerLink).pathname;

    await learnerA.goto(learnerPath);
    await learnerA.fill('input[name="displayName"]', "Learner Alpha");
    await learnerA.locator('input[name="consent"]').check();
    await Promise.all([
      learnerA.waitForURL(/\/sessions\/[^/]+\/learn/),
      learnerA.getByRole("button", { name: "Join session" }).click(),
    ]);

    await learnerB.goto(learnerPath);
    await learnerB.fill('input[name="displayName"]', "Learner Beta");
    await learnerB.locator('input[name="consent"]').check();
    await Promise.all([
      learnerB.waitForURL(/\/sessions\/[^/]+\/learn/),
      learnerB.getByRole("button", { name: "Join session" }).click(),
    ]);

    await facilitator.getByRole("button", { name: "Start session" }).click();

    await learnerA.locator('textarea[name="message"]').fill("Private question from Alpha");
    await learnerA.getByLabel("Message facilitator privately").check();
    await expect(learnerA.getByText("Private to facilitator")).toBeVisible();
    await learnerA.getByRole("button", { name: "Send" }).click();

    await expect(facilitator.getByText("Private question from Alpha")).toBeVisible();
    await expect(facilitator.getByText("Private").first()).toBeVisible();
    await expect(learnerA.getByText("Private question from Alpha")).toBeVisible();

    await learnerB.reload();
    await expect(learnerB.getByText("Private question from Alpha")).toHaveCount(0);

    await facilitator.getByRole("button", { name: "Reply privately" }).click();
    await expect(facilitator.getByText("Private to Learner Alpha")).toBeVisible();
    await facilitator.locator('textarea[name="message"]').fill("Private reply to Alpha");
    await facilitator.getByRole("button", { name: "Send" }).click();

    await expect(learnerA.getByText("Private reply to Alpha")).toBeVisible();
    await learnerB.reload();
    await expect(learnerB.getByText("Private reply to Alpha")).toHaveCount(0);

    await facilitator.getByRole("button", { name: "Return to public" }).click();
    await expect(facilitator.getByText("Public chat")).toBeVisible();
    await facilitator.locator('textarea[name="message"]').fill("Public update after private reply");
    await facilitator.getByRole("button", { name: "Send" }).click();
    await expect(learnerB.getByText("Public update after private reply")).toBeVisible();
  } finally {
    await facilitatorContext.close();
    await learnerAContext.close();
    await learnerBContext.close();
  }
});
