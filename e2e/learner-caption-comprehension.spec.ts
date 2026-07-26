import { expect, test } from "@playwright/test";

/**
 * Verifies the learner "Explain simply" / "Give an example" caption actions
 * (see CaptionComprehensionActions.tsx) reuse the existing QUESTION chat flow:
 * clicking one sends a QUESTION-flagged message quoting the original caption
 * text, visible to the facilitator in the Chat tab.
 */
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

    await facilitator.getByRole("button", { name: "Start session" }).click();

    // Both sides land on the "Chat" tab by default (SessionSidePanel) — switch to
    // "Captions" to reach the facilitator's publish composer and the learner's feed.
    await facilitator.getByRole("tab", { name: "Captions" }).click();
    await facilitator.locator('textarea[name="captionText"]').fill(
      "Normalize the request payload before validating fields.",
    );
    await facilitator.getByRole("button", { name: "Publish" }).click();

    await learner.getByRole("tab", { name: "Captions" }).click();
    const captionRow = learner.getByText("Normalize the request payload before validating fields.");
    await expect(captionRow).toBeVisible();

    // Comprehension actions only appear once a caption line is expanded (see
    // LiveTranscriptFeed's per-row toggle button).
    await captionRow.click();
    await learner.getByRole("button", { name: "Explain simply" }).click();

    await facilitator.getByRole("tab", { name: "Chat" }).click();
    await expect(facilitator.getByText("Question")).toBeVisible();
    await expect(
      facilitator.getByText('Please explain this simply: "Normalize the request payload before validating fields."'),
    ).toBeVisible();

    await facilitator.getByRole("tab", { name: "Captions" }).click();
    await facilitator.getByRole("button", { name: "End session" }).click();
    await expect(learner.getByRole("button", { name: "Explain simply" })).toHaveCount(0);
  } finally {
    await facilitatorContext.close();
    await learnerContext.close();
  }
});
