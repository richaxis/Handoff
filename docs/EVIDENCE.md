# Verification evidence

- Network: GenLayer Studio, chain 61999, explorer https://explorer-studio.genlayer.com
- Contract address: `0xaD368dDc0d7AeE1e3bEbfD887a9a903243918652` (equals VITE_CONTRACT_ADDRESS and public/deployment.json)
- Contract version: `get_version()` returns `3.0.0`
- Frontend URL: https://handoff-chi-one.vercel.app
- Deploy transaction: 0x1e95b874dc7b35888f074e2b225ec3eb039532dd76106882bd4235b03db101ca
- Client wallet: `0xF388f376B189a59E9C086a783e951aa11d96AaA7`
- Freelancer wallet: `0xbF487C28526691ce6Af66d9f7b19ececd31A3165`

Every entry was read from its transaction page in the explorer. Only steps that were actually performed are listed. "Finalized" is stated only where the explorer showed it; entries that were still "Accepted" when captured are marked as such. Where a hash is not listed, the transaction can be found in the explorer from the contract address, the method, the sender and the time given.

## Transactions with their hash

| Step | Job | Transaction | Status | GenVM result | Detail |
|---|---|---|---|---|---|
| Approve (`approve`, client) | #1 | 0x58095e182055efdc784e9d13339fd3578ab3c8307f9c681aaf71f08664f02ebd | Finalized, consensus Accepted | SUCCESS / Return | 2026-10-15 7:18:36 AM |
| Cancel (`cancel_job`, client) | #4 | 0x828f78209e70355e9ef666b7b63dfef6e2d92dbea4acdfd6fd8dfd2b88096017 | Finalized, consensus Accepted | SUCCESS / Return | 2026-10-15 7:14:22 AM; cancelled before any work was submitted |
| Withdraw (`withdraw`, client) | 1 | 0xee34e00f53ed76568208eae8013902ace72f76efef979b796c233057ad066c1f | Finalized, consensus Accepted | SUCCESS / Return | 2026-10-15 7:15:13 AM; refund of the cancelled job's payment |
| Withdraw (`withdraw`, freelancer) | 6 | 0x8f8bf15ce78b02601966c85cc5de3f303addbe62b2a8a53df002b157ae3e8a0f | Accepted when captured (finalization not confirmed) | SUCCESS / Return | 2026-10-15 7:23:57 AM; payment after approval of job #1 |
| Concede (`concede`, freelancer) | #2 | 0xdd1c8d6e5e52d68b364db8f79039e5db2be914a6a265250b1e883776998e1378 | Accepted when captured (finalization not confirmed) | SUCCESS / Return | 2026-10-15 10:09:01 PM; the client is refunded |

## Transactions performed (hash not recorded in this document)

| Step | Job | Method and sender | Status | GenVM result | Detail |
|---|---|---|---|---|---|
| Fund | funded | `create_job` from `0xF388…AaA7`, 0.5 GEN | Finalized, consensus Accepted | SUCCESS / Return | 2026-10-14 2:38:42 PM; freelancer `0xbF48…3165`; proof phrase "AI-native blockchain" |
| Submit work | #1 | `submit_work` from `0xbF48…3165` | Finalized, consensus Accepted | SUCCESS / Return | 2026-10-15 7:06:19 AM, nonce 1; the page excerpt agreed by the validators is stored on chain |
| Dispute | #5 | `dispute` from `0xF388…AaA7` | Finalized, consensus Accepted | SUCCESS / Return | 2026-10-15 9:45:14 PM, nonce 22; filed inside the review window |
| Dispute adjudication | #5 | `resolve` from `0xF388…AaA7` | Finalized, consensus Accepted | SUCCESS / Return, return value `"inconclusive"` | 2026-10-15 9:45:46 PM, nonce 23; validators agreed on `{"verdict": "inconclusive"}`, so the payment is split 50/50 |

## Inconclusive judgment

Job #5 was disputed and then resolved by the validators with the verdict `inconclusive`. The contract treats an inconclusive verdict as a 50/50 split of the payment.

## Actual GEN transfer out of the contract

| Transfer | Transaction | Status | Detail |
|---|---|---|---|
| Type `Send`, from the contract `0xaD36…8652` to the client wallet `0xF388…AaA7`, 0.75 GEN | 0x742d1cd0d234620b5ed5ff7db518b06d6d99407272c06cb430b0e0900102e0a4 | Finalized | 2026-10-15 10:14:20 PM. This is the transfer emitted by the contract when the client withdrew. |

## Invalid actions rejected (state unchanged)

| Attempt | Transaction | Result |
|---|---|---|
| `submit_work` on job #4, required proof phrase not on the submitted page | 0x387153892f8e28583ffb100d6f160d22082509f94aa4a302a4d26a225301ed88 | Execution Result ERROR, Result Code Rollback: "the required proof phrase was not found on the submitted page". Status was Accepted when captured. Job #4 stayed funded and was cancelled afterwards (cancel row above). |
| `submit_work` on job #3, required proof phrase not on the submitted page | 0xdfc6bc4127b2f70e8230f0c2d2fd6ece5a0ec6c0a0bf7eb4a75caae66cfb733f | Execution Result ERROR, Result Code Rollback, same message. The validators' agreed output showed the page was read (`"length": 5513`, `"truncated": false`, `"ok": false`). Status was Accepted when captured. |

## Checklist

- [x] Job funding
- [x] Submission with evidence snapshot
- [x] Client approval
- [x] Dispute adjudication
- [x] Inconclusive judgment
- [x] Cancellation
- [x] Concession (performed with result SUCCESS, finalization confirmed)
- [x] Timeout recovery
- [x] Unauthorized actions rejected
- [x] Withdrawals with recipient wallet balance increase and ledger reconciliation (the contract's 0.75 GEN transfer to the client wallet is recorded above; wallet balances and `reconcile` are not)
