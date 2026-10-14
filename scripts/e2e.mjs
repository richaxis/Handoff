// End-to-end proof on Studio. Needs two FUNDED test accounts and the deployed v2 contract.
//   VITE_CONTRACT_ADDRESS=0x... KEY_A=0x... KEY_B=0x... npm run e2e        (A = client, B = freelancer)
// Optional page settings (public, stable, plain-text pages work best):
//   E2E_URL        short page (default: GenLayer docs)         E2E_LONG_URL  page longer than 6000 characters
//   E2E_CRITERIA   criteria the E2E_URL page satisfies          E2E_PROOF     a phrase that appears on E2E_URL
//   E2E_AMOUNT     payment per job in GEN (default 0.1)
//   E2E_EXPIRY=1   also test timeouts (deploy a SECOND copy with REVIEW_WINDOW_SECONDS=60 DISPUTE_TIMEOUT_SECONDS=60)
// Every write is awaited until FINALIZED, its GenVM result is checked, and the state and wallets are read back.
// Output: runs/e2e-report.md. Paste it into docs/EVIDENCE.md.
import fs from "node:fs";
import { createClient, createAccount } from "genlayer-js";
import { makeConfig, makeChain, write, read, fromWei, toWei, executionOutcome, statusName } from "../lib/chain.js";

const cfg = makeConfig(process.env);
const { KEY_A, KEY_B } = process.env;
if (!cfg.address || !KEY_A || !KEY_B) throw new Error("Set VITE_CONTRACT_ADDRESS, KEY_A and KEY_B");
const A = createAccount(KEY_A), B = createAccount(KEY_B);
const cA = createClient({ chain: makeChain(cfg), account: A }), cB = createClient({ chain: makeChain(cfg), account: B });
const URL_ = process.env.E2E_URL || "https://docs.genlayer.com/understand-genlayer-protocol";
const LONG_URL = process.env.E2E_LONG_URL || "https://en.wikipedia.org/wiki/Blockchain";
const CRITERIA = process.env.E2E_CRITERIA || "The delivered page must describe GenLayer as an AI-native blockchain.";
const PROOF = process.env.E2E_PROOF || "AI-native blockchain";
const IMPOSSIBLE = "The page must contain the exact serial number ZX-9981-QQ-NOT-REAL-4471.";
const AMOUNT = toWei(process.env.E2E_AMOUNT || "0.1");
const ex = cfg.explorer.replace(/\/$/, "");

const rows = [];
const assert = (ok, msg) => { if (!ok) throw new Error("ASSERT FAILED: " + msg); };
const rpc = async (method, params) => (await (await fetch(cfg.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;
const bal = async (addr) => BigInt(await rpc("eth_getBalance", [addr, "latest"]));
const job = async (id) => JSON.parse(await read(cA, cfg, "get_job", [id]));
const credit = async (acct) => BigInt(await read(cA, cfg, "get_credit", [acct.address]));
const ledger = async () => JSON.parse(await read(cA, cfg, "get_ledger"));
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

async function step(name, client, fn, args = [], value = 0n, verify) {
  const r = await write(client, cfg, fn, args, value, { verify, requireFinalized: true });
  const fin = r.finalized;
  const result = executionOutcome(fin) === "success" ? "FINISHED_WITH_RETURN" : executionOutcome(r.receipt) === "success" ? "FINISHED_WITH_RETURN" : "unconfirmed";
  rows.push({ name, hash: r.hash, link: `${ex}/tx/${r.hash}`, status: statusName(fin), result, readback: verify ? "state read back OK" : "-" });
  console.log("ok  ", name, r.hash, statusName(fin), result);
  assert(result === "FINISHED_WITH_RETURN", `${name}: execution result not confirmed`);
  return r.hash;
}
async function expectFail(name, client, fn, args = [], value = 0n) {
  try { await write(client, cfg, fn, args, value, {}); } catch (e) { rows.push({ name: `${name} (unauthorized/invalid, rejected as expected)`, hash: "-", link: "-", status: "rejected", result: String(e.message).slice(0, 80), readback: "-" }); console.log("ok  ", name, "rejected"); return; }
  throw new Error(`ASSERT FAILED: ${name} should have been rejected`);
}
const note = (name, value) => { rows.push({ name, hash: "-", link: "-", status: "-", result: String(value), readback: "-" }); console.log("note", name, value); };

async function newJob(title, criteria = CRITERIA, proof = "") {
  const id = Number(await read(cA, cfg, "get_job_count"));
  await step(`create_job #${id} (${title})`, cA, "create_job", [title, criteria, B.address, proof], AMOUNT,
    async () => Number(await read(cA, cfg, "get_job_count")) === id + 1);
  const j = await job(id); assert(j.status === "funded" && BigInt(j.amount) === AMOUNT, "funded readback");
  return id;
}
async function submit(id, url = URL_) {
  await step(`submit_work #${id}`, cB, "submit_work", [id, url], 0n, async () => (await job(id)).status === "submitted");
  const j = await job(id);
  assert(j.evidence_hash.length === 64 && j.evidence_excerpt.length > 0 && j.submitted_at > 0, "evidence snapshot and timestamp stored");
  return j;
}
async function withdraw(name, client, acct, expected) {
  const got = await credit(acct);
  assert(got === expected, `${name}: credit ${fromWei(got, 6)} != ${fromWei(expected, 6)}`);
  const walletBefore = await bal(acct.address), contractBefore = await bal(cfg.address);
  await step(name, client, "withdraw", [], 0n, async () => (await credit(acct)) === 0n);
  let gained = 0n;
  for (let i = 0; i < 18 && gained <= 0n; i++) { gained = (await bal(acct.address)) - walletBefore; if (gained <= 0n) await sleep(10); }
  assert(gained > 0n && gained <= expected, `${name}: wallet balance did not rise by the credit (delta ${fromWei(gained, 6)})`);
  await step(`${name}: reconcile`, cA, "reconcile");
  const led = await ledger();
  assert(led.pending_transfers === 0 && led.unexplained_outflow === 0, "ledger reconciled");
  const contractDrop = contractBefore - (await bal(cfg.address));
  assert(contractDrop === expected, `${name}: contract balance fell by ${fromWei(contractDrop, 6)}, expected ${fromWei(expected, 6)}`);
  note(`${name}: recipient wallet delta GEN (credit minus fees)`, fromWei(gained, 6));
  note(`${name}: contract balance fell by GEN`, fromWei(contractDrop, 6));
}

const config = JSON.parse(await read(cA, cfg, "get_config"));
console.log("contract config:", config);
assert(config.version === "3.0.0", `expected contract 3.0.0, found ${config.version}: wrong address or old deployment`);

// 1. validation and unauthorized actions
await expectFail("create_job with short criteria", cA, "create_job", ["x", "too short", B.address, ""], AMOUNT);
await expectFail("create_job with zero payment", cA, "create_job", ["x", CRITERIA, B.address, ""], 0n);
await expectFail("create_job paying yourself", cA, "create_job", ["x", CRITERIA, A.address, ""], AMOUNT);
await expectFail("create_job with a bad address", cA, "create_job", ["x", CRITERIA, "0x123", ""], AMOUNT);
await expectFail("withdraw with nothing to withdraw", cA, "withdraw");
let id = await newJob("E2E unauthorized");
await expectFail(`submit_work by the client #${id}`, cA, "submit_work", [id, URL_]);
await expectFail(`cancel_job by the freelancer #${id}`, cB, "cancel_job", [id]);
await expectFail(`resolve before any dispute #${id}`, cA, "resolve", [id]);
await submit(id);
await expectFail(`approve by the freelancer #${id}`, cB, "approve", [id]);
await expectFail(`dispute by the freelancer #${id}`, cB, "dispute", [id]);
await expectFail(`claim_after_review by the client #${id}`, cA, "claim_after_review", [id]);
await step(`concede #${id}`, cB, "concede", [id], 0n, async () => (await job(id)).status === "refunded"); // 2. concession
await withdraw("A withdraw after concession", cA, A, AMOUNT);

// 3. cancellation
id = await newJob("E2E cancel");
await step(`cancel_job #${id}`, cA, "cancel_job", [id], 0n, async () => (await job(id)).status === "cancelled");
await withdraw("A withdraw after cancellation", cA, A, AMOUNT);

// 4. proof of function: a page without the required phrase is refused, a page with it is accepted
id = await newJob("E2E proof phrase missing", CRITERIA, "ZZ-PROOF-PHRASE-NOT-ON-PAGE-9");
await expectFail(`submit_work without the proof phrase #${id}`, cB, "submit_work", [id, URL_]);
assert((await job(id)).status === "funded", "failed submission changed nothing");
await step(`cancel_job #${id}`, cA, "cancel_job", [id], 0n, async () => (await job(id)).status === "cancelled");
await withdraw("A withdraw after proof-phrase test", cA, A, AMOUNT);

// 5. client approval
id = await newJob("E2E approve", CRITERIA, PROOF);
await submit(id);
await step(`approve #${id}`, cA, "approve", [id], 0n, async () => (await job(id)).status === "paid");
await withdraw("B withdraw payment", cB, B, AMOUNT);

// 6. dispute adjudicated by validators
id = await newJob("E2E dispute");
const snap = await submit(id);
await step(`dispute #${id}`, cA, "dispute", [id], 0n, async () => (await job(id)).status === "disputed");
await step(`resolve #${id}`, cB, "resolve", [id], 0n, async () => ["accepted", "rejected", "inconclusive"].includes((await job(id)).status));
const done = await job(id);
assert(done.evidence_hash === snap.evidence_hash, "evidence unchanged by resolve");
note(`verdict #${id}`, `${done.status} (evidence ${done.evidence_hash.slice(0, 16)}…)`);
const half = AMOUNT / 2n;
if (done.status === "accepted") await withdraw("B withdraw after verdict", cB, B, AMOUNT);
else if (done.status === "rejected") await withdraw("A withdraw after verdict", cA, A, AMOUNT);
else { await withdraw("A withdraw split", cA, A, half); await withdraw("B withdraw split", cB, B, AMOUNT - half); }

// 7. inconclusive judgment: impossible criteria + a page longer than the stored evidence can never be rejected
id = await newJob("E2E inconclusive", IMPOSSIBLE);
const longJob = await submit(id, LONG_URL);
note(`long page #${id}`, `${longJob.evidence_excerpt.length} of ${longJob.evidence_length} characters stored (truncated=${longJob.evidence_truncated})`);
await step(`dispute #${id}`, cA, "dispute", [id], 0n, async () => (await job(id)).status === "disputed");
await step(`resolve #${id}`, cB, "resolve", [id], 0n, async () => (await job(id)).status === "inconclusive");
assert((await credit(A)) + (await credit(B)) === AMOUNT, "inconclusive split conserves the payment");
await withdraw("A withdraw inconclusive half", cA, A, await credit(A));
await withdraw("B withdraw inconclusive half", cB, B, await credit(B));

// 8. timeout recovery (needs the 60 second deployment)
if (process.env.E2E_EXPIRY) {
  assert(config.review_window_seconds <= 120 && config.dispute_timeout_seconds <= 120, "deploy a second copy with 60 second windows for E2E_EXPIRY");
  const wait = Math.max(config.review_window_seconds, config.dispute_timeout_seconds) + 30;
  const late = await newJob("E2E late dispute"); await submit(late);
  const exp = await newJob("E2E dispute timeout"); await submit(exp);
  await step(`dispute #${exp}`, cA, "dispute", [exp], 0n, async () => (await job(exp)).status === "disputed");
  await expectFail(`claim_after_review too early #${late}`, cB, "claim_after_review", [late]);
  await expectFail(`claim_expired_dispute too early #${exp}`, cB, "claim_expired_dispute", [exp]);
  console.log(`waiting ${wait}s…`); await sleep(wait);
  await expectFail(`dispute AFTER the review window #${late}`, cA, "dispute", [late]); // the late dispute must be refused
  await step(`claim_after_review #${late}`, cB, "claim_after_review", [late], 0n, async () => (await job(late)).status === "auto_paid");
  await step(`claim_expired_dispute #${exp}`, cA, "claim_expired_dispute", [exp], 0n, async () => (await job(exp)).status === "expired");
  await withdraw("B withdraw timeout winnings", cB, B, AMOUNT + (AMOUNT - half));
  await withdraw("A withdraw timeout half", cA, A, half);
}

const led = await ledger();
note("final ledger", JSON.stringify(led));
assert(led.pending_transfers === 0 && led.unexplained_outflow === 0, "final ledger is clean");
fs.mkdirSync("runs", { recursive: true });
const md = `Contract ${cfg.address} (version ${config.version}, review window ${config.review_window_seconds}s, dispute timeout ${config.dispute_timeout_seconds}s)\n\n` +
  "| step | tx | status | GenVM result | readback / detail |\n|---|---|---|---|---|\n" +
  rows.map((r) => `| ${r.name} | ${r.link === "-" ? "-" : `[${r.hash.slice(0, 12)}…](${r.link})`} | ${r.status} | ${r.result} | ${r.readback} |`).join("\n") + "\n";
fs.writeFileSync("runs/e2e-report.md", md);
console.log("\n" + md + "\nAll assertions passed.");
