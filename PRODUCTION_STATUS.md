# Production status

- [x] Contract behavioural tests (28, real contract code in a simulator) + static + helper tests: `make -C chain-and-site test`
- [x] Frontend/lib unit tests: `npm test`
- [ ] `npm run build` verified with real dependencies installed
- [ ] Contract v3.0.0 deployed to Studio (address:0xaD368dDc0d7AeE1e3bEbfD887a9a903243918652, tx: 0x470f8a7c77d138837811afbee6c2c906e7219527a8c9d8692ecab570cca434a0); `https://handoff-chi-one.vercel.app` run and committed
- [ ] Vercel deployed with the same VITE_CONTRACT_ADDRESS (URL: https://explorer-studio.genlayer.com/address/0xaD368dDc0d7AeE1e3bEbfD887a9a903243918652); footer shows the address
- [ ] `npm run e2e` passed; report pasted into docs/EVIDENCE.md
- [ ] `E2E_EXPIRY=1 npm run e2e` passed on a 60 second deployment (second address:0xbF487C28526691ce6Af66d9f7b19ececd31A3165)

Known limits: evidence is the first 6000 characters (partial evidence can never cause a rejection); pages that render with JavaScript or change between validators can fail consensus; the reconciliation relies on the contract balance and can be masked by GEN sent directly to the contract.
