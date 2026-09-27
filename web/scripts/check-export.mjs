import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { keccak256, stringToHex } from "viem";
const root = new URL("../../", import.meta.url),
  dist = new URL("dist/", root);
const read = async (url) => JSON.parse(await readFile(url, "utf8"));
const d = await read(new URL("imd-deployment.json", dist)),
  h = await read(new URL("web/config/deployment-handoff.json", root)),
  n = await read(new URL("web/config/network-handoff.json", root));
for (const key of [
  "version",
  "launchId",
  "chainId",
  "sourceCommit",
  "attestationHash",
])
  assert.equal(d[key], h[key]);
assert.deepEqual(d.network, n.network);
assert.deepEqual(d.walletAddChain, n.walletAddChain);
assert.deepEqual(
  d.contracts.map(({ abiPath, ...rest }) => rest),
  h.contracts.map(({ name, address, abiHash }) => ({ name, address, abiHash })),
);
const sort = (v) =>
  Array.isArray(v)
    ? v.map(sort)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sort(v[k])]),
        )
      : v;
for (const c of d.contracts) {
  const abi = await read(new URL(c.abiPath, dist));
  assert.ok(Array.isArray(abi));
  assert.equal(
    keccak256(stringToHex(JSON.stringify(sort(abi)))).slice(2),
    c.abiHash,
  );
}
const files = [];
async function walk(prefix = "") {
  for (const e of await readdir(new URL(prefix, dist), {
    withFileTypes: true,
  })) {
    const p = prefix + e.name;
    if (e.isDirectory()) await walk(p + "/");
    else if (p !== "imd-deployment.json") files.push(p);
  }
}
await walk();
assert.deepEqual(files.sort(), d.assets.map((a) => a.path).sort());
assert.ok(files.length <= 128);
let total = 0;
for (const asset of d.assets) {
  assert.ok(
    !asset.path.includes("..") &&
      !asset.path.startsWith("/") &&
      !asset.path.includes(":"),
  );
  const b = await readFile(new URL(asset.path, dist));
  total += b.length;
  assert.ok(b.length <= 8388608);
  assert.match(asset.sha256, /^[0-9a-f]{64}$/);
  assert.equal(createHash("sha256").update(b).digest("hex"), asset.sha256);
}
assert.ok(total < 32 * 1024 * 1024);
const html = await readFile(new URL("index.html", dist), "utf8");
assert.ok(html.includes("./assets/"));
assert.ok(!html.includes('src="/'));
console.log(
  `PASS: ${files.length} assets, ${total} bytes; complete inventory, handoff, network, canonical ABI hashes, SHA-256 hashes and relative base.`,
);
