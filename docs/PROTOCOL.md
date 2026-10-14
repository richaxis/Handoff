# Handoff protocol (contract v3.0.0, GenLayer Studio, Studio-style contract: `from genlayer import *`, runner py-genlayer:1jb45aa8…)

1. `create_job(title, criteria, freelancer, proof_phrase)` payable: the client locks the payment. `proof_phrase` is optional.
2. `submit_work(id, url)` (freelancer): validators fetch the https page. If a proof phrase is set it must appear on the live page
   (checked on the FULL text), otherwise the call reverts. The contract stores the first 6000 normalized characters, the page length,
   a `truncated` flag, the SHA-256 of the excerpt and `submitted_at`.
3. `approve(id)` (client): the freelancer is credited.
4. `dispute(id)` (client): only while `now < submitted_at + review_window`. After that the freelancer's claim has matured.
5. `resolve(id)` (anyone): validators judge the STORED evidence. Guard rails applied inside the consensus block:
   - `accepted` needs a `support_quote` (8+ characters) that really occurs in the stored evidence, otherwise it becomes `inconclusive`;
   - `rejected` on truncated evidence becomes `inconclusive` (absence cannot be proven from a partial page);
   - unparsable, ambiguous or failed model output is `inconclusive`.
   `accepted` credits the freelancer, `rejected` the client, `inconclusive` splits 50/50 with no lost dust.

## Escrow recovery
`cancel_job` (before submission) · `concede` (freelancer refunds client) · `claim_after_review` (silent client) ·
`claim_expired_dispute` (unresolved dispute splits).

## Time
`_now_strict()` reads the transaction time (`gl.message_raw["datetime"]`). If the runner does not provide it, validators read a public
clock (worldtimeapi.org, then timeapi.io) and agree by consensus on the value rounded DOWN to 5 minutes, so timeouts are then accurate to
about 5 minutes (use windows of 10 minutes or more when testing on the fallback). If neither source works, every time-dependent write
(`submit_work`, `dispute`, `claim_after_review`, `claim_expired_dispute`, `recover_failed_transfer`) reverts and changes nothing, so no
invalid timestamp is ever stored. Create, cancel, approve, concede, resolve and withdraw never need time.

## Withdrawals and reconciliation
`withdraw()` zeroes the credit, records a pending transfer (with its time, or 0 if unknown) and emits the transfer.
The contract keeps `funds_in` (cumulative deposits) and `confirmed_out`. `reconcile()` compares the real contract balance with
`funds_in - confirmed_out`; whatever has left the contract confirms the OLDEST pending transfers first.
`recover_failed_transfer()` re-credits the oldest pending transfer only if ALL hold: nothing has left the contract, the transfer time is known,
`TRANSFER_GRACE` (1 hour) has passed and no unexplained outflow was ever detected. If an original transfer lands late after a re-credit,
`reconcile()` records it as `unexplained_outflow`, which is visible in `get_ledger()` and disables further recovery.
Limit: GEN sent straight to the contract (not via `create_job`) can mask a delivered transfer until the balance changes again.

## Validation
Title 1-120, criteria 20-800, proof phrase empty or 4-200, valid freelancer address different from the client, non-zero payment,
https URLs under 300 chars, role checks on every action, unknown ids rejected.
Phase timeouts are clamped to the network range 30-600 in `lib/fees.js`.
