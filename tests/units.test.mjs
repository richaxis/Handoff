import test from "node:test";
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
