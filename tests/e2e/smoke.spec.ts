import { expect, test } from "@playwright/test";

test("shows the R1 rules engine status", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/古战阵/);
  await expect(
    page.getByRole("heading", { name: "先把规则做成可信赖的系统" }),
  ).toBeVisible();
  await expect(page.getByText("0.2.0-r1")).toBeVisible();
  await expect(page.getByText("NEXT · R2")).toBeVisible();
});
