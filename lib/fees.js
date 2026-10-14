import profile from "./fee-profile.js";

// Network limits for a phase timeout (error PhaseTimeoutOutOfBounds(value, min, max)).
export const MIN_PHASE = 30n, MAX_PHASE = 600n;
const clamp = (v) => (v < MIN_PHASE ? MIN_PHASE : v > MAX_PHASE ? MAX_PHASE : v);

const SAMPLE_EXECUTION_BUDGET = 786434n; // from the docs' sample profile; used only when scaling up

// Quote live fees for one method (or "deploy"). `scale` raises every budget (used to retry BudgetTooLow).
export async function quoteFees(client, name, scale = 1n, appealRounds = 1n, zeroMessageFees = false) {
  const p = name === "deploy" ? profile.deploy : profile.methods[name] ?? profile.deploy;
  const rot = BigInt(p.rotationsPerRound ?? "0");
  const opts = {
    leaderTimeunitsAllocation: clamp(BigInt(p.leaderTimeunitsAllocation) * scale),
    validatorTimeunitsAllocation: clamp(BigInt(p.validatorTimeunitsAllocation) * scale),
    totalMessageFees: zeroMessageFees ? 0n : BigInt(p.totalMessageFees ?? "0") * scale,
    appealRounds,
    rotations: Array.from({ length: Number(appealRounds) + 1 }, () => rot),
  };
  // Only set the execution budget when the profile has a measured value or we are scaling up;
  // otherwise let the SDK apply its default floor.
  if (p.executionBudgetPerRound) opts.executionBudgetPerRound = BigInt(p.executionBudgetPerRound) * scale;
  else if (scale > 1n) opts.executionBudgetPerRound = SAMPLE_EXECUTION_BUDGET * scale;
  const estimate = await client.estimateTransactionFees(opts);
  // Submit the returned distribution and feeValue unchanged.
  return { distribution: estimate.distribution, feeValue: estimate.feeValue };
}

export const isBudgetTooLow = (e) => /BudgetTooLow/i.test(String(e?.message ?? e) + String(e?.shortMessage ?? ""));

// Mode1MessageFeesRequireGenVMPerEmissionSupport: fee-bearing messages need a message allocation tree.
export const isMessageFeeError = (e) => /MessageFees|message allocation/i.test(String(e?.message ?? e) + String(e?.shortMessage ?? ""));

// A network (or SDK) without fee estimation: send the transaction without a fee object instead of failing.
export const feesUnsupported = (e) => /not a function|method not found|not supported|unknown method|-32601|does not exist/i.test(String(e?.message ?? e) + String(e?.details ?? ""));
