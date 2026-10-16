// The 90-second demo (HANDOFF §8) as one spec. Runs against BASE_URL (deployed URL or `pnpm start`).
// It resets the demo data first and again at the end, so the stage starts clean.
import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const confirmInDialog = async (page: Page, name: string | RegExp) => {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name }).click();
};

test("Sarah's Monday — the five-case demo", async ({ page, request }) => {
  await test.step("reset demo data", async () => {
    const r = await request.post("/api/demo/reset", { timeout: 90_000 });
    expect(r.ok()).toBeTruthy();
  });

  await test.step("Overview: A$16,000 owed, A$9,900 needs chasing, A$3,000 already paid", async () => {
    await page.goto("/overview");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Sarah");
    await expect(page.getByText("A$16,000", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("A$9,900", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("A$3,000", { exact: true }).first()).toBeVisible();
  });

  await test.step("Payment Matching: confirm City Catering → INV-1031 paid", async () => {
    await page.goto("/payments/pay-city-1210/review");
    await expect(page.getByRole("heading", { name: "Match a payment that used the wrong reference" })).toBeVisible();
    await expect(page.getByText("“INV-1013” is not an open invoice", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Confirm match" }).click();
    await confirmInDialog(page, "Confirm match");
    await expect(page.getByRole("heading", { name: "Payment matched" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("· Paid", { exact: true })).toBeVisible();
    await expect(page.getByText("“Second reminder — INV-1031” cancelled")).toBeVisible();
  });

  await test.step("Case Detail: approve Sweet Bakery credit note → balance A$2,740", async () => {
    await page.goto("/queue/kc-0043");
    await expect(page.getByText("8 boxes × A$45.00 = A$360.00")).toBeVisible();
    await page.getByRole("button", { name: "Approve credit note" }).click();
    await confirmInDialog(page, "Confirm credit note");
    await expect(page.getByText("Credit note approved")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { level: 1 }).locator("..")).toContainText("A$2,740.00");
  });

  await test.step("Email Approval: approve Bella's nudge in demo mode → demoOnly message", async () => {
    await page.goto("/communications/msg-bella-nudge");
    await expect(page.getByText("Demo mode — message will not be sent")).toBeVisible();
    await page.getByRole("button", { name: "Approve & send" }).click();
    await confirmInDialog(page, /Approve/);
    // The confirmation line is rendered from Message.demoOnly in the DB
    await expect(page.getByText(/logged, not sent \(demo mode\)/)).toBeVisible({ timeout: 60_000 });
    // the pay link in the logged email points at this deployment (not localhost) when run against one
    const { host, hostname } = new URL(page.url());
    await expect(page.locator("pre")).toContainText(hostname === "localhost" ? "/pay/msg-bella-nudge" : `https://${host}/pay/msg-bella-nudge`);
  });

  await test.step("Voice Call: page loads with the recording fallback", async () => {
    await page.goto("/calls/call-harbourside-1019");
    await expect(page.getByRole("heading", { name: "Let KindCollect make the call" })).toBeVisible();
    await page.getByRole("button", { name: "Play recording" }).click();
    await expect(page.getByText("Invoice received?")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("audio")).toHaveAttribute("src", /\/demo\/harbourside-call\.(mp3|m4a)$/);
    await expect(page.getByRole("button", { name: "Confirm outcome" })).toBeEnabled();
  });

  await test.step("reset demo data for the stage", async () => {
    const r = await request.post("/api/demo/reset", { timeout: 90_000 });
    expect(r.ok()).toBeTruthy();
  });
});
