import { executionOutcome } from "./units.js";

const jsonSafe = (_, v) => (typeof v === "bigint" ? v.toString() : v);
const failed = (dump) => /FINISHED_WITH_ERROR|"execution_result"\s*:\s*"ERROR"/.test(dump);

function rejection(name, hash, receipt) {
  const dump = JSON.stringify(receipt, jsonSafe);
  const reason = (dump.match(/\\?"message\\?"\s*:\s*\\?"([^"\\]{3,200})/) || [])[1];
  return Object.assign(new Error(`Contract rejected ${name}${reason ? ": " + reason : ""} (tx ${hash.slice(0, 12)}…)`), { hash, reason, receipt });
}

// Proves a transaction worked. `wait("ACCEPTED" | "FINALIZED")` resolves with the receipt at that status.
//   1. accepted receipt must not show an execution error,
//   2. an authoritative state readback (`opts.verify`) must pass (needed whenever the result is not explicitly a success),
//   3. `opts.onAccepted(hash)` fires: the transaction is accepted but NOT yet reported as done,
//   4. with `opts.requireFinalized` the call resolves only after FINALIZED, with a successful result and a second readback.
export async function confirmTx({ name, hash, wait, opts = {} }) {
  const accepted = await wait("ACCEPTED");
  const outcome = executionOutcome(accepted);
  if (outcome === "error" || failed(JSON.stringify(accepted, jsonSafe))) throw rejection(name, hash, accepted);

  const verified = opts.verify ? await opts.verify() : null;
  if (verified === false || (outcome !== "success" && verified !== true)) {
    throw Object.assign(new Error(`${name} could not be confirmed on chain (execution result: ${outcome}). Check tx ${hash.slice(0, 12)}… in the explorer.`), { hash });
  }
  if (opts.onAccepted) opts.onAccepted(hash);

  let finalized = null;
  if (opts.requireFinalized) {
    finalized = await wait("FINALIZED");
    const fo = executionOutcome(finalized);
    if (fo === "error" || failed(JSON.stringify(finalized, jsonSafe))) throw rejection(name, hash, finalized);
    const again = opts.verify ? await opts.verify() : null; // readback AFTER finalization
    if (again === false || (fo !== "success" && again !== true)) {
      throw Object.assign(new Error(`${name} finalized but the result could not be confirmed (execution result: ${fo}). Check tx ${hash.slice(0, 12)}…`), { hash });
    }
  } else if (opts.onFinalized) {
    wait("FINALIZED").then((r) => opts.onFinalized(hash, r)).catch(() => {});
  }
  return { hash, receipt: accepted, outcome, verified, finalized };
}
