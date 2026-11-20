const { expect } = require("chai");
const { ethers, network } = require("hardhat");

// Tests run against Hardhat's in-process chain, whose clock starts at the
// real current time and only moves forward. So the base UTC day is computed
// dynamically in beforeEach: the first whole UTC day after the latest block.
// BASE / BASE_DAY are (re)assigned before every test.
const DAY = 86400;
let BASE;
let BASE_DAY;

/// Set the timestamp of the *next* mined block (e.g. the next tx).
async function setNextBlockTime(ts) {
  await network.provider.send("evm_setNextBlockTimestamp", [ts]);
}

/// Advance to a fixed time-of-day (01:00 UTC) on BASE_DAY + `dayOffset`,
/// so the next transaction lands on that UTC day. If a previous tx already
/// used that exact timestamp (e.g. a second holder the same day), nudge
/// +1s past the latest block — still the same UTC day at 01:00.
async function checkInOnDay(contract, signer, dayOffset) {
  const target = BASE + dayOffset * DAY + 3600;
  const latest = await ethers.provider.getBlock("latest");
  await setNextBlockTime(Math.max(target, latest.timestamp + 1));
  return contract.connect(signer).checkIn();
}

describe("AgentStreak", function () {
  let mock, streak, owner, holder, holder2, nonHolder;

  beforeEach(async function () {
    // Base day = first whole UTC day strictly after the latest block, so
    // setNextBlockTimestamp(BASE + ...) is always in the chain's future,
    // even after a previous test jumped many days ahead.
    const latest = await ethers.provider.getBlock("latest");
    BASE_DAY = Math.floor(latest.timestamp / DAY) + 1;
    BASE = BASE_DAY * DAY;

    [owner, holder, holder2, nonHolder] = await ethers.getSigners();

    const Mock = await ethers.getContractFactory("MockAgentID");
    mock = await Mock.deploy();
    await mock.waitForDeployment();

    const AgentStreak = await ethers.getContractFactory("AgentStreak");
    streak = await AgentStreak.deploy(await mock.getAddress());
    await streak.waitForDeployment();

    // holder and holder2 hold an Agent ID; nonHolder does not.
    await mock.mint(holder.address);
    await mock.mint(holder2.address);
  });

  describe("gate + first check-in (spec §7: holder checks in)", function () {
    it("holder checks in: state, totals and event are correct", async function () {
      expect(await streak.canCheckInToday(holder.address)).to.equal(true);

      const tx = checkInOnDay(streak, holder, 0);
      await expect(tx)
        .to.emit(streak, "CheckedIn")
        .withArgs(holder.address, BASE_DAY, 1, 11, 11);

      const u = await streak.getUser(holder.address);
      expect(u.streak).to.equal(1);
      expect(u.totalCheckIns_).to.equal(1);
      expect(u.points).to.equal(11); // 10 + min(1, 20)
      expect(u.level).to.equal(1); // Starter
      expect(u.lastDay).to.equal(BASE_DAY);
      expect(await streak.levelName(u.level)).to.equal("Starter");

      expect(await streak.totalUsers()).to.equal(1);
      expect(await streak.totalCheckIns()).to.equal(1);
      expect(await streak.canCheckInToday(holder.address)).to.equal(false);
    });

    it("agentId is the contract passed to the constructor", async function () {
      expect(await streak.agentId()).to.equal(await mock.getAddress());
      expect(await streak.owner()).to.equal(owner.address);
    });

    it("a second, distinct holder counts as a second user", async function () {
      await checkInOnDay(streak, holder, 0);
      await checkInOnDay(streak, holder2, 0);
      expect(await streak.totalUsers()).to.equal(2);
      expect(await streak.totalCheckIns()).to.equal(2);
    });
  });

  describe("non-holder (spec §7: non-holder reverts)", function () {
    it("non-holder check-in reverts and records nothing", async function () {
      expect(await mock.balanceOf(nonHolder.address)).to.equal(0);
      expect(await streak.canCheckInToday(nonHolder.address)).to.equal(false);

      await expect(streak.connect(nonHolder).checkIn())
        .to.be.revertedWithCustomError(streak, "NotAgentIdHolder");

      const u = await streak.getUser(nonHolder.address);
      expect(u.streak).to.equal(0);
      expect(u.totalCheckIns_).to.equal(0);
      expect(u.points).to.equal(0);
      expect(u.level).to.equal(0); // None
      expect(await streak.totalUsers()).to.equal(0);
      expect(await streak.totalCheckIns()).to.equal(0);
    });

    it("an address that is minted an Agent ID afterwards can check in", async function () {
      await mock.mint(nonHolder.address);
      await checkInOnDay(streak, nonHolder, 0);
      expect((await streak.getUser(nonHolder.address)).totalCheckIns_).to.equal(1);
    });
  });

  describe("once per UTC day (spec §7: second check-in same day reverts)", function () {
    it("second check-in on the same day reverts", async function () {
      await checkInOnDay(streak, holder, 0);
      await expect(streak.connect(holder).checkIn())
        .to.be.revertedWithCustomError(streak, "AlreadyCheckedInToday");

      // State unchanged by the failed attempt.
      const u = await streak.getUser(holder.address);
      expect(u.streak).to.equal(1);
      expect(u.totalCheckIns_).to.equal(1);
      expect(u.points).to.equal(11);
      expect(await streak.totalCheckIns()).to.equal(1);
    });

    it("a check-in later the same UTC day (23:59) still reverts, next UTC day works", async function () {
      await checkInOnDay(streak, holder, 0); // 01:00 UTC day 0
      await setNextBlockTime(BASE + 23 * 3600 + 59 * 60); // 23:59 UTC day 0
      await expect(streak.connect(holder).checkIn())
        .to.be.revertedWithCustomError(streak, "AlreadyCheckedInToday");

      await checkInOnDay(streak, holder, 1); // 01:00 UTC day 1
      expect((await streak.getUser(holder.address)).streak).to.equal(2);
    });
  });

  describe("streak logic (spec §7: next-day +1, missed-day reset)", function () {
    it("next-day check-in increments the streak", async function () {
      await checkInOnDay(streak, holder, 0);
      const tx = checkInOnDay(streak, holder, 1);
      await expect(tx)
        .to.emit(streak, "CheckedIn")
        .withArgs(holder.address, BASE_DAY + 1, 2, 12, 23);

      const u = await streak.getUser(holder.address);
      expect(u.streak).to.equal(2);
      expect(u.totalCheckIns_).to.equal(2);
      expect(u.lastDay).to.equal(BASE_DAY + 1);
    });

    it("three consecutive days build streak 3", async function () {
      await checkInOnDay(streak, holder, 0);
      await checkInOnDay(streak, holder, 1);
      await checkInOnDay(streak, holder, 2);
      const u = await streak.getUser(holder.address);
      expect(u.streak).to.equal(3);
      expect(u.points).to.equal(11 + 12 + 13);
    });

    it("missing a day resets the streak to 1 but keeps totals/points", async function () {
      await checkInOnDay(streak, holder, 0);
      await checkInOnDay(streak, holder, 1);
      // Skip day 2 entirely, check in on day 3.
      const tx = checkInOnDay(streak, holder, 3);
      await expect(tx)
        .to.emit(streak, "CheckedIn")
        .withArgs(holder.address, BASE_DAY + 3, 1, 11, 34);

      const u = await streak.getUser(holder.address);
      expect(u.streak).to.equal(1);
      expect(u.totalCheckIns_).to.equal(3);
      expect(u.points).to.equal(11 + 12 + 11);
      expect(u.level).to.equal(1); // still Starter (3 total)
    });

    it("missing several days also resets to 1, then rebuilds consecutively", async function () {
      await checkInOnDay(streak, holder, 0);
      await checkInOnDay(streak, holder, 5); // gap of 4 days
      expect((await streak.getUser(holder.address)).streak).to.equal(1);
      await checkInOnDay(streak, holder, 6);
      expect((await streak.getUser(holder.address)).streak).to.equal(2);
    });
  });

  describe("points and levels (spec §7: points/level math)", function () {
    it("pointsAwarded = 10 + min(streak, 20), capped at 30 per check-in", async function () {
      // Walk 22 consecutive days and verify the per-day award + running total.
      let expectedTotal = 0;
      for (let d = 0; d < 22; d++) {
        const newStreak = d + 1;
        const expectedAward = 10 + Math.min(newStreak, 20);
        expectedTotal += expectedAward;
        const tx = checkInOnDay(streak, holder, d);
        await expect(tx)
          .to.emit(streak, "CheckedIn")
          .withArgs(holder.address, BASE_DAY + d, newStreak, expectedAward, expectedTotal);
      }
      const u = await streak.getUser(holder.address);
      expect(u.streak).to.equal(22);
      // Days 1-20: 11..30 (sum 410); days 21-22: 30 + 30.
      expect(u.points).to.equal(410 + 60);
      expect(u.totalCheckIns_).to.equal(22);
    });

    it("levelOf thresholds: Starter 1+, Regular 7+, Committed 14+, Core Agent 30+", async function () {
      expect(await streak.levelOf(0)).to.equal(0);
      expect(await streak.levelOf(1)).to.equal(1);
      expect(await streak.levelOf(6)).to.equal(1);
      expect(await streak.levelOf(7)).to.equal(2);
      expect(await streak.levelOf(13)).to.equal(2);
      expect(await streak.levelOf(14)).to.equal(3);
      expect(await streak.levelOf(29)).to.equal(3);
      expect(await streak.levelOf(30)).to.equal(4);
      expect(await streak.levelOf(100)).to.equal(4);

      expect(await streak.levelName(0)).to.equal("None");
      expect(await streak.levelName(1)).to.equal("Starter");
      expect(await streak.levelName(2)).to.equal("Regular");
      expect(await streak.levelName(3)).to.equal("Committed");
      expect(await streak.levelName(4)).to.equal("Core Agent");
    });

    it("getUser level rises at 7, 14 and 30 total check-ins in a real run", async function () {
      for (let d = 0; d < 30; d++) {
        await checkInOnDay(streak, holder, d);
        const u = await streak.getUser(holder.address);
        if (d + 1 === 7) expect(u.level).to.equal(2); // Regular
        if (d + 1 === 14) expect(u.level).to.equal(3); // Committed
        if (d + 1 === 30) expect(u.level).to.equal(4); // Core Agent
      }
      const u = await streak.getUser(holder.address);
      expect(u.totalCheckIns_).to.equal(30);
      expect(u.streak).to.equal(30);
      expect(await streak.totalUsers()).to.equal(1);
      expect(await streak.totalCheckIns()).to.equal(30);
    });
  });

  describe("pause (spec §7: pause blocks check-in)", function () {
    it("owner pause blocks check-in; unpause restores it", async function () {
      await streak.connect(owner).pause();
      expect(await streak.paused()).to.equal(true);
      expect(await streak.canCheckInToday(holder.address)).to.equal(false);

      await expect(streak.connect(holder).checkIn())
        .to.be.revertedWithCustomError(streak, "IsPaused");

      await streak.connect(owner).unpause();
      expect(await streak.paused()).to.equal(false);
      await checkInOnDay(streak, holder, 0);
      expect((await streak.getUser(holder.address)).totalCheckIns_).to.equal(1);
    });

    it("non-owner cannot pause or unpause", async function () {
      await expect(streak.connect(holder).pause())
        .to.be.revertedWithCustomError(streak, "NotOwner");
      await expect(streak.connect(holder).unpause())
        .to.be.revertedWithCustomError(streak, "NotOwner");
      expect(await streak.paused()).to.equal(false);
    });

    it("pause does not erase existing user state", async function () {
      await checkInOnDay(streak, holder, 0);
      await streak.connect(owner).pause();
      const u = await streak.getUser(holder.address);
      expect(u.streak).to.equal(1);
      expect(u.points).to.equal(11);
      expect(await streak.totalCheckIns()).to.equal(1);
    });
  });

  describe("construction", function () {
    it("reverts on a zero Agent ID address", async function () {
      const AgentStreak = await ethers.getContractFactory("AgentStreak");
      await expect(AgentStreak.deploy(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(AgentStreak, "ZeroAddress");
    });
  });
});
