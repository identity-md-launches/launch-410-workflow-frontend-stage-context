import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeAbiParameters, parseAbiParameters, zeroAddress } from "viem";
import {
  amountIn,
  minimumOut,
  referral,
  swapPayload,
  switchChain,
} from "../src/domain";
import type { Config, Provider } from "../src/config";
const deployment = JSON.parse(
  readFileSync(
    new URL("../../dist/imd-deployment.json", import.meta.url),
    "utf8",
  ),
);
const c = {
  deployment,
  token: deployment.contracts.find((v: any) => v.name === "REFR"),
  hook: deployment.contracts.find((v: any) => v.name === "ReferralHook"),
} as Config;
const alice = "0x1111111111111111111111111111111111111111";
const bob = "0x2222222222222222222222222222222222222222";
test("URL referral is exactly one canonical ABI address; excluded addresses receive no fee", () => {
  const ref = referral(alice, c, bob);
  assert.equal(ref.data.length, 66);
  assert.equal(ref.valid, true);
  assert.deepEqual(decodeAbiParameters([{ type: "address" }], ref.data), [
    alice,
  ]);
  for (const address of [
    alice,
    zeroAddress,
    c.hook.address,
    c.deployment.network.uniswapV4.poolManager,
  ])
    assert.equal(referral(address, c, alice).valid, false);
  assert.equal(referral("javascript:alert(1)", c).data, "0x");
  assert.equal(referral(null, c).valid, false);
});
test("amount and slippage reject rounding, exponent, negative, dust and excessive inputs", () => {
  assert.equal(amountIn("0.01", 18), 10n ** 16n);
  assert.equal(amountIn(".5", 6), 500000n);
  for (const invalid of ["", "0", "-1", "1e2", "NaN", "1.0000001", " 1"])
    assert.throws(() => amountIn(invalid, 6));
  assert.throws(() => amountIn((2n ** 128n).toString(), 0));
  assert.equal(minimumOut(10000n, "0.5"), 9950n);
  for (const invalid of ["0", "5.01", "-1", "1e1", "0.001"])
    assert.throws(() => minimumOut(10000n, invalid));
  assert.throws(() => minimumOut(1n, "0.5"));
});
test("both trade directions encode V4_SWAP and enforce min output in swap and TAKE_ALL", () => {
  for (const buy of [true, false]) {
    const data = referral(alice, c, bob).data,
      p = swapPayload(c, buy, 100n, 90n, data);
    assert.equal(p.commands, "0x10");
    assert.equal(p.value, buy ? 100n : 0n);
    const [actions, params] = decodeAbiParameters(
      parseAbiParameters("bytes,bytes[]"),
      p.inputs[0],
    );
    assert.equal(actions, "0x060c0f");
    const [tuple] = decodeAbiParameters(
      parseAbiParameters(
        "((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)",
      ),
      params[0],
    );
    assert.equal(tuple.zeroForOne, buy);
    assert.equal(tuple.amountIn, 100n);
    assert.equal(tuple.amountOutMinimum, 90n);
    assert.equal(tuple.hookData, data);
    assert.equal(
      tuple.poolKey.hooks.toLowerCase(),
      c.hook.address.toLowerCase(),
    );
    const settle = decodeAbiParameters(
        parseAbiParameters("address,uint256"),
        params[1],
      ),
      take = decodeAbiParameters(
        parseAbiParameters("address,uint256"),
        params[2],
      );
    assert.equal(
      settle[0].toLowerCase(),
      buy ? zeroAddress : c.token.address.toLowerCase(),
    );
    assert.equal(settle[1], 100n);
    assert.equal(take[1], 90n);
  }
});
test("unknown chain adds exact handoff parameters and switches again", async () => {
  const calls: any[] = [];
  const p = {
    request: async (arg: any) => {
      calls.push(arg);
      if (calls.length === 1) throw { code: 4902 };
    },
  } as unknown as Provider;
  await switchChain(p, c);
  assert.deepEqual(
    calls.map((v) => v.method),
    [
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
    ],
  );
  assert.deepEqual(calls[1].params, [deployment.walletAddChain]);
});
test("switch rejection never adds a chain", async () => {
  const calls: any[] = [];
  const p = {
    request: async (arg: any) => {
      calls.push(arg);
      throw { code: 4001 };
    },
  } as unknown as Provider;
  await assert.rejects(switchChain(p, c));
  assert.equal(calls.length, 1);
});
