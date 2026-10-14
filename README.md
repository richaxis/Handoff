# Handoff (GenLayer Studio edition)

Escrow for freelance work, judged by GenLayer. A client locks payment and writes acceptance criteria. The freelancer
hands off a public link; validators snapshot the page. The client approves, or disputes and validators judge the
stored snapshot against the criteria. Timeouts protect both sides if someone goes silent.

- Contract: `chain-and-site/contracts/handoff.py`
- Network: GenLayer Studio, chain 61999, RPC https://studio.genlayer.com/api
- Explorer: https://explorer-studio.genlayer.com

## Run locally
```
npm install
cp .env.example .env        # set VITE_CONTRACT_ADDRESS after deploying
make -C chain-and-site test   # static + helper + 28 behavioural tests
npm test
npm run dev
```

## Deploy the contract
Studio website: paste `handoff.py` (v3.0.0), enter `0` and `0` for the two constructor fields (defaults: 3 day review window, 1 day dispute timeout), deploy.
Or by script: `DEPLOYER_PRIVATE_KEY=0x... npm run deploy:contract`.
Copy the contract address into `.env`, Vercel and `public/deployment.json`.

## Deploy the site to Vercel
1. Push this repo to GitHub, then Vercel > Add New > Project > import it (framework Vite).
2. Environment variables: `VITE_CONTRACT_ADDRESS`, `VITE_RPC_URL`, `VITE_CHAIN_ID=61999`, `VITE_EXPLORER_URL`.
3. Deploy. Redeploy after changing any VITE_ variable. Never add `DEPLOYER_PRIVATE_KEY` to Vercel.

## Verify end to end
```
VITE_CONTRACT_ADDRESS=0x... KEY_A=0x... KEY_B=0x... npm run e2e
```
Add `E2E_EXPIRY=1` (contract deployed with `REVIEW_WINDOW_SECONDS=60 DISPUTE_TIMEOUT_SECONDS=60`) to test timeout recovery.

## Fees
Every write carries a fee deposit quoted by `estimateTransactionFees` (`lib/fees.js`, budgets in `lib/fee-profile.js`, phase timeouts clamped to 30-600).
Your wallet needs the payment plus the fee deposit; unused fee is refunded.

## After deploying
```
npm run configure -- 0xYOUR_CONTRACT https://your-site.vercel.app   # writes the address everywhere
```
Then set `VITE_CONTRACT_ADDRESS` in Vercel. Production builds fail without an address (`scripts/check-config.mjs`).
See `docs/STEWARD_RESPONSE.md` for how each review concern is addressed and verified.

## Studio notes
- Network: GenLayer Studio, chain 61999, RPC https://studio.genlayer.com/api, explorer https://explorer-studio.genlayer.com
- The contract uses the Studio style (`# v0.2.16`, runner `py-genlayer:1jb45aa8…`, `from genlayer import *`, `gl.Contract`).
- Fees: the app asks the network for fees before every write (`lib/fees.js`). If the network cannot estimate fees, it sends without them.
- `chain-and-site/contracts/time_probe.py` is a tiny contract that shows whether this Studio gives contracts the transaction time.
- `package.json` uses the STABLE `genlayer-js` (`latest`): the stable hosted Studio (chain 61999) is a different deployment from the release-candidate preview Studio (chain 61997), and the 2.0.0 release-candidate SDK sends parameters the stable Studio can reject ("Missing or invalid parameters"). If the build fails on a `genlayer-js` import, tell the maintainer.
