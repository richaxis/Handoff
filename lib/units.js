// Pure helpers (no dependencies) so they can be unit-tested.
export function toWei(text) {
  const [whole, frac = ""] = String(text).trim().split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(frac)) throw new Error("Enter a number like 5 or 0.5");
  const wei = BigInt(whole) * 10n ** 18n + BigInt((frac + "0".repeat(18)).slice(0, 18));
  if (wei <= 0n) throw new Error("Amount must be greater than 0");
  return wei;
}

export function fromWei(value, digits = 4) {
  const v = BigInt(value ?? 0);
  const whole = v / 10n ** 18n;
  const frac = (v % 10n ** 18n).toString().padStart(18, "0").slice(0, digits).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

// genlayer-js can return dicts as Map objects; turn them into plain objects.
export function plain(x) {
  if (x instanceof Map) return Object.fromEntries([...x].map(([k, v]) => [k, plain(v)]));
  if (Array.isArray(x)) return x.map(plain);
  return x;
}

export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
export const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

// Reads the GenVM execution result out of a receipt. Never guesses success: "unknown" must be settled by a state readback.
export function executionOutcome(receipt) {
  const r = receipt ?? {};
  const name = r.txExecutionResultName ?? r.tx_execution_result_name;
  if (name === "FINISHED_WITH_RETURN") return "success";
  if (name === "FINISHED_WITH_ERROR") return "error";
  const leader = r.consensus_data?.leader_receipt?.[0] ?? r.consensusData?.leaderReceipt?.[0] ?? r.leader_receipt?.[0];
  const res = leader?.execution_result ?? leader?.executionResult ?? r.execution_result;
  if (res === "SUCCESS" || res === "FINISHED_WITH_RETURN") return "success";
  if (res === "ERROR" || res === "FINISHED_WITH_ERROR") return "error";
  return "unknown";
}

export const statusName = (receipt) => String(receipt?.statusName ?? receipt?.status_name ?? receipt?.status ?? "unknown");

// Errors that come from the network or the Studio backend, not from our contract or address. Safe to retry.
export const isTransient = (e) =>
  /rate limit|429|too many requests|internal error|rollback|can'?t reconnect|timeout|timed out|failed to fetch|network|econn|\b50[234]\b/i
    .test([e?.message, e?.details, e?.shortMessage, e].map((x) => String(x ?? "")).join(" "));
