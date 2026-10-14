# Verification evidence (fill in after running `npm run e2e`)

- Network: GenLayer Studio, chain 61999, explorer https://explorer-studio.genlayer.com
- Contract address: `0x...`   (must equal VITE_CONTRACT_ADDRESS and public/deployment.json)
- Contract version: `get_version()` returns `3.0.0`
- Frontend URL: https://...
- Deploy transaction: ...

## Main run (`npm run e2e`)
Paste `runs/e2e-report.md` here. It lists, for every write: the transaction link, FINALIZED status, the GenVM result
(FINISHED_WITH_RETURN), the authoritative state readback, and the wallet and contract balance movements.

## Timeout run (`E2E_EXPIRY=1 npm run e2e`, contract deployed with 60 second windows)
Second contract address: `0x...`
Paste the report here. It shows a dispute refused after the review window, `claim_after_review`, and `claim_expired_dispute`.

## Checklist (tick only after confirming in the explorer)
- [ ] job funding · [ ] submission with evidence snapshot · [ ] client approval · [ ] dispute adjudication
- [ ] inconclusive judgment · [ ] cancellation · [ ] concession · [ ] timeout recovery · [ ] unauthorized actions rejected
- [ ] withdrawals: recipient wallet balance rose, contract balance fell by the same credit, ledger reconciled
