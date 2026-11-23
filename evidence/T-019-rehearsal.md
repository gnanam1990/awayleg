# T-019 — Submission rehearsal (dry run)

Rehearsal of the submission checklist for the Binance Wallet / BNB Chain
Agent ID Hackathon. **No form was submitted.** Dry run only — records what is
proven and which gates remain unmet.

## Checks performed

| Check | Result | Evidence |
|---|---|---|
| Agent ID registry exists on BSC (chain 56) | PASS — 8,756 bytes deployed at `0x60b9262456de011f7d15a54cdd8c48baaa8b022f`; `balanceOf(address)` callable via public RPC | `eth_getCode` / `eth_call` on bsc-dataseed.binance.org |
| Registry on BSC testnet (chain 97) | NOT DEPLOYED — `eth_getCode` returns `0x`; testnet rehearsal needs a local TestRegistry stand-in | data-seed-prebsc RPCs |
| Operator powers | PASS — `AwayLegSeason` is non-upgradeable; constructor freezes organizer, registry, captains; `createFixture` is organizer-only; no admin can finalize/delete/reset or pick a winner; disputed/expired fixtures are permanently unscored | `contracts/src/AwayLegSeason.sol` |
| Confirmed wallet receipts | PASS (local) — T-007: fresh holder wallets funded, attest rejected pre-window (`AttestWindow 0xb88b9dc5`), retried in-window, two confirmed receipts → Accepted HomeWin | `evidence/T-007-client.json` |
| Public URL logged out | PARTIAL — desk renders full read-only state with no auth against the seeded indexer; not yet a public deployment | desk on :5174 + indexer :3000 |
| Receipts and video links | LOCAL — tx receipts in `evidence/T-007-client.json` + pilot run; desk walkthrough recorded (testing session recording in session artifacts) | this repo + session artifacts |

## Met gates

- Full local rehearsal: 6 fixtures on anvil (3 Accepted, 1 Disputed, 2 Open),
  standings home 9 / away 0, indexer WAL-atomic sync, dedup holder counts
  (T-018: 2 entrants / 2 captains / 2 holders / 3 accepted).
- Real-wallet client flow proven end-to-end on the authorized local deployment.
- Desk UI verified E2E with real indexer data (scoreboard 5/5, board paths,
  evidence drawer, integrity checks).

## Unmet gates (require separate authorization / external resources)

1. **Live BSC deployment** — needs a funded testnet/mainnet wallet
   (`BSC_TESTNET_PRIVATE_KEY` requested) and the pack's separate deploy
   authorization. Testnet also lacks the real Agent ID registry — a rehearsal
   there binds TestRegistry or must target mainnet.
2. **Real clubs and participants** — 30 holder threshold, two independently
   operated referee machines on the live deployment.
3. **Verified source on BscScan** — needs the deployed address + verification
   (requires an API key or manual submission once deployed).
4. **Public desk URL** — desk is local-only; hosting is unapproved.
5. **Hackathon form** — never submitted; the live form's required fields were
   not opened (DEMO-AND-SUBMISSION.md says to use the live form for exact fields).

## Note on window

Submission window runs 18 Nov 08:00 UTC → 9 Dec 08:00 UTC. Evidence preserved
in-repo so a later authorized deployment only re-runs `evidence/pilot.mjs`
against the target chain and re-points the indexer.
