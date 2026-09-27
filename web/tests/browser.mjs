import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  decodeFunctionData,
  decodeAbiParameters,
  parseAbiParameters,
} from "viem";
import assert from "node:assert/strict";
import { startPreview } from "./server.mjs";
import { fixture, referrer } from "./fixture.mjs";
const out = new URL("../../docs/frontend/", import.meta.url);
await mkdir(out, { recursive: true });
const preview = await startPreview(),
  browser = await chromium.launch({ headless: true });
const report = {
  checkedAt: new Date().toISOString(),
  browser: browser.version(),
  mode: "Production dist at /preview/; injected mock wallet and JSON-RPC; no broadcasts",
  checks: [],
  screenshots: [],
  errors: [],
};
const check = async (name, work) => {
  await work();
  report.checks.push({ name, result: "pass" });
  console.log("PASS " + name);
};
let page;
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  page = await context.newPage();
  page.on("pageerror", (e) => report.errors.push(e.message));
  const f = await fixture(page);
  await page.goto(preview.url + "?ref=" + referrer);
  await expect(page.getByText(/Deployment verified/)).toBeVisible();
  await check(
    "Disconnected wallet; relative assets, price and events load",
    async () => {
      await expect(
        page.getByRole("button", { name: "Claim all ETH" }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Connect wallet to swap" }),
      ).toBeEnabled();
      await expect(
        page.getByText("Referral earned", { exact: true }),
      ).toBeVisible();
      assert.equal(
        await page
          .locator("link[rel=stylesheet]")
          .evaluate((el) => el.href.includes("/preview/assets/")),
        true,
      );
    },
  );
  await check(
    "Connect, wrong network, 4902 add-chain fallback with exact parameters",
    async () => {
      await page
        .getByRole("button", { name: "Connect wallet", exact: true })
        .click();
      const switcher = page
        .locator(".notice")
        .getByRole("button", { name: "Switch to Sepolia" });
      await expect(switcher).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Claim all ETH" }),
      ).toBeDisabled();
      await switcher.click();
      await expect(
        page.getByRole("button", { name: "Get quote", exact: true }),
      ).toBeEnabled();
      const requests = await page.evaluate(() => window.__wallet.requests);
      assert.deepEqual(
        requests.find((v) => v.method === "wallet_addEthereumChain").params,
        [f.deployment.walletAddChain],
      );
    },
  );
  await check(
    "Referral address validation, use-wallet and clipboard link preserve static subpath",
    async () => {
      await page.getByRole("button", { name: "Copy referral link" }).click();
      await expect(
        page.getByText(
          "Enter a valid Ethereum address that can receive referral rewards.",
        ),
      ).toBeVisible();
      await page.getByRole("button", { name: "Use wallet" }).click();
      await page.getByRole("button", { name: "Copy referral link" }).click();
      await expect(page.getByText("Referral link copied.")).toBeVisible();
      const value = await page.getByLabel("Your shareable link").inputValue();
      assert.ok(value.includes("/preview/?ref=0x1111"));
      assert.equal(
        await page.evaluate(() => navigator.clipboard.readText()),
        value,
      );
    },
  );
  await check(
    "Amount validation and quoted minimum, then simulated native buy with referrer",
    async () => {
      await page.getByLabel("You pay", { exact: true }).fill("-1");
      await page
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await expect(page.getByRole("alert")).toContainText("positive amount");
      await page.getByRole("button", { name: "Dismiss", exact: true }).click();
      await page.getByLabel("You pay", { exact: true }).fill("0.01");
      await page
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await expect(
        page.getByText("Minimum received", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Confirm buy" }).click();
      await expect(
        page.getByText("Transaction confirmed. Balances updated."),
      ).toBeVisible();
      assert.equal(f.state.transactions.length, 1);
      const tx = f.state.transactions[0];
      assert.equal(
        tx.to.toLowerCase(),
        f.deployment.network.uniswapV4.universalRouter,
      );
      assert.equal(BigInt(tx.value), 10n ** 16n);
      const decoded = decodeFunctionData({ abi: f.protocol, data: tx.data });
      assert.equal(decoded.functionName, "execute");
      const [actions, params] = decodeAbiParameters(
        parseAbiParameters("bytes,bytes[]"),
        decoded.args[1][0],
      );
      assert.equal(actions, "0x060c0f");
      const [swap] = decodeAbiParameters(
        parseAbiParameters(
          "((address,address,uint24,int24,address),bool,uint128,uint128,bytes)",
        ),
        params[0],
      );
      assert.equal(swap[1], true);
      assert.equal(swap[4].slice(-40), referrer.slice(2));
      assert.ok(swap[3] > 0n);
    },
  );
  await check(
    "Sell explicitly approves exact REFR amount, authorizes configured router, then swaps",
    async () => {
      await page
        .getByRole("button", { name: "Sell REFR", exact: true })
        .click();
      await page.getByLabel("You pay", { exact: true }).fill("10");
      for (const label of [
        "1. Approve REFR",
        "2. Authorize router",
        "Confirm sell",
      ]) {
        await page
          .getByRole("button", { name: "Get quote", exact: true })
          .click();
        await page.getByRole("button", { name: label, exact: true }).click();
        await expect(
          page.getByText("Transaction confirmed. Balances updated."),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Get quote", exact: true }),
        ).toBeEnabled();
      }
      assert.equal(f.state.transactions.length, 4);
      const tokenTx = f.state.transactions[1],
        permitTx = f.state.transactions[2];
      const a = decodeFunctionData({ abi: f.token.abi, data: tokenTx.data });
      assert.equal(
        a.args[0].toLowerCase(),
        f.deployment.network.uniswapV4.permit2,
      );
      assert.equal(a.args[1], 10n ** 19n);
      const b = decodeFunctionData({ abi: f.protocol, data: permitTx.data });
      assert.equal(
        b.args[1].toLowerCase(),
        f.deployment.network.uniswapV4.universalRouter,
      );
      assert.equal(b.args[2], 10n ** 19n);
    },
  );
  await check(
    "Claim entire balance once; refresh disables empty claim",
    async () => {
      await page.getByRole("button", { name: "Claim all ETH" }).click();
      await expect(
        page.getByText("Transaction confirmed. Balances updated."),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Claim all ETH" }),
      ).toBeDisabled();
      assert.equal(
        decodeFunctionData({
          abi: f.hook.abi,
          data: f.state.transactions.at(-1).data,
        }).functionName,
        "claim",
      );
    },
  );
  await check(
    "Quote failure and transaction simulation failure never ask wallet to sign",
    async () => {
      await page.getByRole("button", { name: "Buy REFR", exact: true }).click();
      await page.getByLabel("You pay", { exact: true }).fill("0.01");
      f.state.failQuote = true;
      await page
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await expect(page.getByRole("alert")).toBeVisible();
      f.state.failQuote = false;
      await page
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Confirm buy" }),
      ).toBeVisible();
      const before = f.state.transactions.length;
      f.state.failSimulate = true;
      await page.getByRole("button", { name: "Confirm buy" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      assert.equal(f.state.transactions.length, before);
      f.state.failSimulate = false;
      await page.getByRole("button", { name: "Dismiss", exact: true }).click();
    },
  );
  await check(
    "Wallet rejection remains recoverable and never reports success",
    async () => {
      await page.evaluate(() => (window.__wallet.reject = true));
      await page.getByRole("button", { name: "Confirm buy" }).click();
      await expect(page.getByRole("alert")).toContainText("declined");
      await page.evaluate(() => (window.__wallet.reject = false));
      await page.getByRole("button", { name: "Dismiss", exact: true }).click();
    },
  );
  await check("Account change invalidates a quote", async () => {
    await page.evaluate(() => {
      window.__wallet.account = "0x3333333333333333333333333333333333333333";
      window.__emit("accountsChanged", [window.__wallet.account]);
    });
    await expect(
      page.getByRole("button", { name: "Get quote", exact: true }),
    ).toBeEnabled();
    assert.equal(
      await page.getByRole("button", { name: "Confirm buy" }).count(),
      0,
    );
  });
  await check("ABI tampering fails closed", async () => {
    const p = await context.newPage();
    await p.route("**/abi/REFR.json", (r) => r.fulfill({ json: [] }));
    await p.goto(preview.url);
    await expect(p.getByRole("alert")).toContainText("ABI verification failed");
    assert.equal(
      await p.getByRole("button", { name: "Confirm buy" }).count(),
      0,
    );
    await p.close();
  });
  await check("Missing browser wallet offers recovery", async () => {
    const p = await context.newPage();
    await fixture(p, { wallet: false });
    await p.goto(preview.url);
    await p
      .getByRole("button", { name: "Connect wallet", exact: true })
      .click();
    await expect(p.getByRole("alert")).toContainText("No browser wallet");
    await p.close();
  });
  await check(
    "Missing deployed code disables transaction controls",
    async () => {
      const p = await context.newPage();
      await fixture(p, { connected: true, missingCode: true });
      await p.goto(preview.url);
      await expect(p.getByRole("alert")).toContainText("no deployed code");
      await expect(
        p.getByRole("button", { name: "Get quote", exact: true }),
      ).toBeDisabled();
      await p.close();
    },
  );
  await check(
    "RPC failure disables actions and Refresh data recovers",
    async () => {
      f.state.failReads = true;
      await page.getByRole("button", { name: "Refresh data" }).click();
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Get quote", exact: true }),
      ).toBeDisabled();
      f.state.failReads = false;
      await page.getByRole("button", { name: "Refresh data" }).click();
      await expect(
        page.getByRole("button", { name: "Get quote", exact: true }),
      ).toBeEnabled();
    },
  );
  await check(
    "Slippage errors point to the correct field and block quoting",
    async () => {
      await page.getByLabel("Slippage tolerance").fill("10");
      await page
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await expect(page.getByLabel("Slippage tolerance")).toBeFocused();
      await expect(page.getByLabel("Slippage tolerance")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await page.getByLabel("Slippage tolerance").fill("0.5");
      await page.getByRole("button", { name: "Dismiss", exact: true }).click();
    },
  );
  await check(
    "Quote expires after 30 seconds and cannot be reused",
    async () => {
      await page.clock.install();
      await page
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Confirm buy" }),
      ).toBeVisible();
      await page.clock.fastForward(31000);
      await expect(
        page.getByRole("button", { name: "Get quote", exact: true }),
      ).toBeEnabled();
      assert.equal(
        await page.getByRole("button", { name: "Confirm buy" }).count(),
        0,
      );
    },
  );
  await check(
    "Wallet change while a quote is pending discards the stale response",
    async () => {
      f.state.delayQuote = 250;
      await page
        .getByRole("button", { name: "Get quote", exact: true })
        .click();
      await page.evaluate(() => {
        window.__wallet.account = "0x4444444444444444444444444444444444444444";
        window.__emit("accountsChanged", [window.__wallet.account]);
      });
      await expect(
        page.getByRole("button", { name: "Get quote", exact: true }),
      ).toBeEnabled();
      assert.equal(
        await page.getByRole("button", { name: "Confirm buy" }).count(),
        0,
      );
      f.state.delayQuote = 0;
    },
  );
  // Final visual state with readable balances and an actionable quote.
  f.state.claimable = 4200000000000000n;
  await page.getByRole("button", { name: "Refresh data" }).click();
  await expect(
    page.getByRole("button", { name: "Get quote", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Get quote", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm buy" })).toBeVisible();
  await check(
    "Desktop/mobile/intermediate reflow; axe accessibility; rendered contrast; keyboard focus",
    async () => {
      const contrast = [];
      for (const width of [1440, 800, 390, 320]) {
        await page.setViewportSize({ width, height: 1100 });
        await page.evaluate(() => window.scrollTo(0, 0));
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `overflow at ${width}`,
        );
        const axe = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        assert.deepEqual(
          axe.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => n.target),
          })),
          [],
        );
        const file = `${width === 1440 ? "desktop" : width === 390 ? "mobile" : `width-${width}`}.png`;
        await page.screenshot({
          path: fileURLToPath(new URL(file, out)),
          fullPage: true,
        });
        report.screenshots.push(file);
        contrast.push(
          await page.evaluate(() => {
            const rgb = (s) =>
              s
                .match(/[\d.]+/g)
                .slice(0, 3)
                .map(Number);
            const lum = (c) =>
              rgb(c)
                .map((x) => {
                  x /= 255;
                  return x <= 0.04045
                    ? x / 12.92
                    : ((x + 0.055) / 1.055) ** 2.4;
                })
                .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
            return [".intro-copy", ".link-card p", ".primary", ".eyebrow"].map(
              (selector) => {
                const el = document.querySelector(selector),
                  style = getComputedStyle(el);
                let node = el,
                  bg;
                while (node) {
                  bg = getComputedStyle(node).backgroundColor;
                  if (bg !== "rgba(0, 0, 0, 0)") break;
                  node = node.parentElement;
                }
                const fg = lum(style.color),
                  back = lum(bg);
                return {
                  selector,
                  foreground: style.color,
                  background: bg,
                  ratio:
                    (Math.max(fg, back) + 0.05) / (Math.min(fg, back) + 0.05),
                };
              },
            );
          }),
        );
      }
      report.contrast = contrast[0];
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.evaluate(() => {
        document.activeElement?.blur();
        window.scrollTo(0, 0);
      });
      await page.keyboard.press("Control+Home");
      await page.locator(".skip").focus();
      await expect(page.locator(".skip")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("link", { name: "Referral home" }),
      ).toBeFocused();
      await page.keyboard.press("Tab");
      assert.ok(
        await page.evaluate(
          () =>
            getComputedStyle(document.activeElement).outlineStyle !== "none",
        ),
      );
      await page.screenshot({
        path: fileURLToPath(new URL("keyboard-focus.png", out)),
      });
      report.screenshots.push("keyboard-focus.png");
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(
        await page
          .getByRole("button", { name: "Confirm buy" })
          .evaluate((el) => getComputedStyle(el).transitionDuration),
        "0s",
      );
      await page.evaluate(
        () => (document.documentElement.style.fontSize = "200%"),
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.evaluate(() => (document.documentElement.style.fontSize = ""));
    },
  );
  assert.deepEqual(report.errors, []);
} catch (e) {
  report.failure = e.stack;
  console.error(e);
  if (page)
    await page.screenshot({
      path: fileURLToPath(new URL("failure.png", out)),
      fullPage: true,
    });
  process.exitCode = 1;
} finally {
  await writeFile(
    new URL("browser-check.json", out),
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
  await preview.close();
}
