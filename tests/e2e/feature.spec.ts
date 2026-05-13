import { expect, test } from "@playwright/test";
import { openTwoPeers } from "@baditaflorin/mesh-common/testing";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  name: string;
};
const storagePrefix = pkg.name;

test("A becomes drawer; B sees locked commit; B's guess shows on A", async ({
  browser,
  baseURL,
}) => {
  const { a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    await a.getByPlaceholder("your name").fill("alice");
    await b.getByPlaceholder("your name").fill("bob");

    await a.getByRole("button", { name: /I'll draw/ }).click();

    await expect(b.locator(".pic-word-locked")).toBeVisible();
    await expect(b.locator(".pic-status")).toContainText("drawing");

    await b.getByPlaceholder("your guess").fill("pizza");
    await b.getByRole("button", { name: "send", exact: true }).click();

    await expect(a.locator(".pic-guesses li")).toContainText(["bob"]);
  } finally {
    await cleanup();
  }
});

test("reveal phase verifies the commitment", async ({ browser, baseURL }) => {
  const { a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    await a.getByPlaceholder("your name").fill("alice");
    await a.getByRole("button", { name: /I'll draw/ }).click();
    await a.getByRole("button", { name: "end & reveal", exact: true }).click();
    await expect(b.locator(".pic-verify.is-ok")).toBeVisible();
  } finally {
    await cleanup();
  }
});
