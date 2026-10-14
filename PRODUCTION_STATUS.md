# Production status

Record only what you have verified on Studio. Accepted is not success: confirm FINALIZED, the GenVM result and the contract state.

- [x] Contract behavioural tests (28, real contract code in a simulator) + static + helper tests: `make -C chain-and-site test`
- [x] Frontend/lib unit tests: `npm test`
- [ ] `npm run build` verified with real dependencies installed
- [ ] Contract v3.0.0 deployed to Studio (address: ____, tx: ____); `npm run configure -- 0xADDR https://site` run and committed
- [ ] Vercel deployed with the same VITE_CONTRACT_ADDRESS (URL: ____); footer shows the address
- [ ] `npm run e2e` passed; report pasted into docs/EVIDENCE.md
- [ ] `E2E_EXPIRY=1 npm run e2e` passed on a 60 second deployment (second address: ____)

Known limits: evidence is the first 6000 characters (partial evidence can never cause a rejection); pages that render with JavaScript or change between validators can fail consensus; the reconciliation relies on the contract balance and can be masked by GEN sent directly to the contract.
