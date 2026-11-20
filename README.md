# AgentStreak

A sybil-proof daily loyalty protocol for AI agents, built for the
**Binance Agent ID Hackathon** (Binance Wallet + BNB Chain).

Only **Agent ID** holders can check in on-chain once per UTC day, build a
streak, earn points, and level up:

**1 person = 1 Agent ID (non-transferable) = 1 streak identity.**

- Check in on consecutive days → streak +1
- Miss a day → streak resets to 1
- Points per check-in: `10 + min(newStreak, 20)` (so 11 on day 1, capped at 30/day)
- Levels from lifetime check-ins: **Starter** (1+) → **Regular** (7+) →
  **Committed** (14+) → **Core Agent** (30+)
- Points are a loyalty score only. **Points have no monetary value** and are
  not a token, not transferable, and not a promise of any return.

## How Agent ID is used (core, not cosmetic)

Every core action reverts unless the caller holds an Agent ID:

```solidity
// AgentStreak.checkIn()
if (agentId.balanceOf(msg.sender) == 0) revert NotAgentIdHolder();
```

- The Agent ID contract address is set once in the constructor and is
  **immutable** — it cannot be changed after deployment.
- On BNB Chain mainnet this is the official SPACE ID Agent ID contract:
  `0x60b9262456de011f7d15a54cdd8c48baaa8b022f` (ERC-721, name "SPACE ID
  Agent ID", symbol "AI", non-transferable; claimed only inside the
  Binance App).
- No Agent ID = no streak, no points, no level. The product does not work
  without Agent ID — Agent ID *is* the identity layer, which is what makes
  the daily streak sybil-proof (one person can only ever hold one Agent ID).
- Agent ID is never used to look up other people's wallets by name. The
  leaderboard (built off-chain from `CheckedIn` events) shows shortened
  addresses only.

## Contracts

| File | What it is |
| --- | --- |
| `contracts/AgentStreak.sol` | The product contract (MIT, Solidity ^0.8.24). |
| `contracts/MockAgentID.sol` | Test-only minimal ERC-721-like mock exposing `balanceOf` + a public `mint(to)`. **Not for deployment.** The real Agent ID is mainnet-only, so tests/hackathon testnet runs need a stand-in. |

### AgentStreak surface

- `checkIn()` — holder-only, once per UTC day (`day = block.timestamp / 86400`).
  Emits `CheckedIn(user, day, streak, pointsAwarded, totalPoints)`.
- `canCheckInToday(address)` — view: not paused, holds an Agent ID, and has
  not already checked in today.
- `getUser(address)` — view: `(streak, totalCheckIns, points, level, lastDay)`.
  `level` is a `uint8`: 0 = None, 1 = Starter, 2 = Regular, 3 = Committed,
  4 = Core Agent. `levelOf(count)` and `levelName(level)` expose the same
  mapping in pure/view form.
- `totalUsers()` / `totalCheckIns()` — global counters (unique agents,
  lifetime check-ins).

## Owner permissions (disclosure)

The owner (deployer) can do exactly two things:

- `pause()` — stop new check-ins (emergency only)
- `unpause()` — resume check-ins

The owner **cannot**:

- move funds — the contract holds no BNB and no tokens, ever
- mint anything, change the Agent ID contract (immutable), or edit any
  user's streak, points, level, or history
- transfer, swap, approve, deposit, or withdraw — **no such functions exist
  in the contract at all**

## Red-line compliance (Binance hackathon rules)

- ✅ No QR-code / pairing-code Agentic Wallet login on the website —
  standard wallet connect only; the user confirms in their own wallet.
- ✅ No bypass of user confirmation — every check-in is a transaction the
  user sees and signs themselves.
- ✅ No unauthorized or bundled transfers, no unlimited approvals — the
  contract requests **zero** approvals and moves **zero** assets.
- ✅ No collection of seed phrases, private keys, API secrets, or pairing codes.
- ✅ No "Binance" / "BNB" in the project, token, or domain name — the name
  is AgentStreak, and there is no token.
- ✅ No promised returns / "passive income" wording — points have no
  monetary value, stated here and on the site.
- ✅ No trading product, so no trading risk warning applies; the
  "points are not financial value" note is shown anyway.
- ✅ Agent ID is never packaged as a tool for looking up other people's
  wallets by name.

## Run the tests

Requirements: Node.js (developed on Node v24) and npm. No keys, no
`.env`, no network access needed — everything runs on Hardhat's local
in-process network.

```bash
npm install
npx hardhat test
# or: npm test
npx hardhat compile
```

The test suite (`test/AgentStreak.test.js`, Hardhat + Chai + ethers v6)
covers every case in the spec test plan:

- holder checks in (state, counters, `CheckedIn` event)
- non-holder reverts (`NotAgentIdHolder`) and records nothing
- second check-in on the same UTC day reverts (`AlreadyCheckedInToday`),
  including a 23:59 same-day attempt
- next-day check-in increments the streak (time travel via
  `evm_setNextBlockTimestamp` to exact UTC day boundaries)
- missed-day check-in resets the streak to 1 while keeping totals/points
- points math: `10 + min(streak, 20)` verified per-day over a 22-day run,
  including the +20 cap, and level thresholds at 1 / 7 / 14 / 30 total
  check-ins verified both as pure `levelOf` values and in a real 30-day run
- pause blocks check-in (`IsPaused`), unpause restores it, non-owner
  pause/unpause reverts (`NotOwner`), and pause preserves user state

## Status

Local development only at this stage: compiled and fully tested locally.
**Not deployed** to any network. Any future deployment (BNB Chain mainnet,
verified on BscScan, open-source) is a separate, explicitly confirmed step,
from a wallet the project owner controls directly.

## License

MIT — see the SPDX headers in the contract files.
