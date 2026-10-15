import test from "node:test";
import { confirmTx } from "../lib/confirm.js";
import assert from "node:assert/strict";
import { toWei, fromWei, plain, short, same, executionOutcome, isTransient } from "../lib/units.js";

test("toWei / fromWei round-trip", () => {
  assert.equal(toWei("5"), 5n * 10n ** 18n);
  assert.equal(toWei("0.5"), 5n * 10n ** 17n);
  assert.equal(fromWei(toWei("1.25")), "1.25");
  assert.equal(fromWei(0), "0");
});
test("toWei rejects bad input", () => {
  assert.throws(() => toWei("abc"));
  assert.throws(() => toWei("0"));
});
test("plain converts nested Maps", () => {
  assert.deepEqual(plain(new Map([["a", new Map([["b", 1]])]])), { a: { b: 1 } });
});
test("address helpers", () => {
  assert.equal(short("0x1234567890abcdef1234"), "0x1234…1234");
  assert.ok(same("0xAB", "0xab"));
});

test("executionOutcome never guesses success", () => {
  assert.equal(executionOutcome({ txExecutionResultName: "FINISHED_WITH_RETURN" }), "success");
  assert.equal(executionOutcome({ txExecutionResultName: "FINISHED_WITH_ERROR" }), "error");
  assert.equal(executionOutcome({ consensus_data: { leader_receipt: [{ execution_result: "SUCCESS" }] } }), "success");
  assert.equal(executionOutcome({ consensus_data: { leader_receipt: [{ execution_result: "ERROR" }] } }), "error");
  assert.equal(executionOutcome({ statusName: "ACCEPTED" }), "unknown");
  assert.equal(executionOutcome(null), "unknown");
});

test("isTransient separates backend hiccups from real contract errors", () => {
  assert.ok(isTransient(new Error("An internal error was received. Details: Can't reconnect until invalid transaction is rolled back. Please rollback()")));
  assert.ok(isTransient(new Error("Rate limit exceeded: 30 requests per minute")));
  assert.ok(isTransient(new Error("Failed to fetch")));
  assert.ok(!isTransient(new Error("Contract rejected approve: only the client can do this")));
  assert.ok(!isTransient(new Error("method get_config not found")));
});

const OK = { txExecutionResultName: "FINISHED_WITH_RETURN" }, BAD = { txExecutionResultName: "FINISHED_WITH_ERROR" };
const waiter = (map, calls = []) => (s) => { calls.push(s); return Promise.resolve(map[s]); };

test("confirmTx reports accepted BEFORE finalization and returns only after FINALIZED", async () => {
  const calls = [], events = [];
  const r = await confirmTx({ name: "approve", hash: "0xabc", wait: waiter({ ACCEPTED: OK, FINALIZED: OK }, calls),
    opts: { requireFinalized: true, verify: async () => true, onAccepted: () => events.push("accepted") } });
  assert.deepEqual(calls, ["ACCEPTED", "FINALIZED"]);
  assert.deepEqual(events, ["accepted"]);
  assert.ok(r.finalized);
});
test("confirmTx throws and never announces acceptance when execution failed", async () => {
  let announced = false;
  await assert.rejects(confirmTx({ name: "approve", hash: "0xabc", wait: waiter({ ACCEPTED: BAD }), opts: { onAccepted: () => (announced = true) } }), /rejected approve/);
  assert.equal(announced, false);
});
test("confirmTx rejects an accepted tx whose state readback does not match", async () => {
  await assert.rejects(confirmTx({ name: "approve", hash: "0xabc", wait: waiter({ ACCEPTED: OK }), opts: { verify: async () => false } }), /could not be confirmed/);
});
test("confirmTx never treats an unknown result as success without a passing readback", async () => {
  await assert.rejects(confirmTx({ name: "x", hash: "0xabc", wait: waiter({ ACCEPTED: { statusName: "ACCEPTED" } }), opts: {} }), /could not be confirmed/);
  const r = await confirmTx({ name: "x", hash: "0xabc", wait: waiter({ ACCEPTED: { statusName: "ACCEPTED" } }), opts: { verify: async () => true } });
  assert.equal(r.outcome, "unknown");
});
test("confirmTx fails when the FINALIZED receipt shows an error or the second readback fails", async () => {
  await assert.rejects(confirmTx({ name: "x", hash: "0xabc", wait: waiter({ ACCEPTED: OK, FINALIZED: BAD }), opts: { requireFinalized: true } }), /rejected x/);
  let n = 0;
  await assert.rejects(confirmTx({ name: "x", hash: "0xabc", wait: waiter({ ACCEPTED: OK, FINALIZED: OK }), opts: { requireFinalized: true, verify: async () => ++n === 1 } }), /could not be confirmed/);
});
