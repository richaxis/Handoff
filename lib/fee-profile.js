// Fee budgets per method (consensus v0.6). Phase timeouts must stay inside 30..600 (lib/fees.js clamps them).
// executionBudgetPerRound is left out on purpose so the SDK applies its own floor.
// These are generous STARTING values, not measured numbers. Unused fee budget is refunded.
const base = { leaderTimeunitsAllocation: "125", validatorTimeunitsAllocation: "250", totalMessageFees: "0", rotationsPerRound: "1" };
const heavy = { ...base, leaderTimeunitsAllocation: "500", validatorTimeunitsAllocation: "600" };

export default {
  version: 1,
  network: "studio",
  deploy: { ...base },
  methods: {
    create_job: { ...base },
    cancel_job: { ...base },
    submit_work: { ...heavy }, // every validator fetches the delivered page
    approve: { ...base },
    dispute: { ...base },
    concede: { ...base },
    claim_after_review: { ...base },
    claim_expired_dispute: { ...base },
    resolve: { ...heavy }, // every validator calls the LLM
    withdraw: { ...base }, // totalMessageFees stays 0: fee-bearing messages need a message allocation tree
    reconcile: { ...base },
    recover_failed_transfer: { ...base },
  },
};
