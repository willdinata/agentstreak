// Deploy AgentStreak to BSC MAINNET (chain 56), gate = real Agent ID contract.
// Key read from ../.testnet-deployer.json (0600) — never printed.
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const AGENT_ID = "0x60b9262456de011f7d15a54cdd8c48baaa8b022f";
const BAW = "0x977cF5DA555A401c0B78Cc7aaAfb130794F5F49a"; // Will's Agent ID holder wallet (read-only checks)

async function main() {
  const { privateKey } = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".testnet-deployer.json")));
  const provider = new hre.ethers.JsonRpcProvider("https://bsc-dataseed.binance.org");
  const wallet = new hre.ethers.Wallet(privateKey, provider);
  const net = await provider.getNetwork();
  if (net.chainId !== 56n) throw new Error("Wrong chain: " + net.chainId);
  const bal = await provider.getBalance(wallet.address);
  console.log("deployer:", wallet.address, "BNB:", hre.ethers.formatEther(bal));

  const Agent = await hre.ethers.getContractFactory("AgentStreak", wallet);
  const deployTxReq = await Agent.getDeployTransaction(AGENT_ID);
  // Simulate before broadcast (rails): estimateGas from deployer
  const gasEst = await provider.estimateGas({ ...deployTxReq, from: wallet.address });
  const fee = await provider.getFeeData();
  const cost = gasEst * (fee.gasPrice ?? 0n);
  console.log("simulate estimateGas OK:", gasEst.toString(), "gasPrice:", (fee.gasPrice ?? 0n).toString(), "est cost BNB:", hre.ethers.formatEther(cost));
  if (bal < cost) throw new Error("Insufficient BNB for estimated gas");

  const streak = await Agent.deploy(AGENT_ID);
  await streak.waitForDeployment();
  const addr = await streak.getAddress();
  console.log("AgentStreak MAINNET:", addr, "tx:", streak.deploymentTransaction().hash);
  const rc = await streak.deploymentTransaction().wait();
  console.log("deploy receipt status:", rc.status, "gasUsed:", rc.gasUsed.toString());

  console.log("agentId():", await streak.agentId());
  console.log("totalUsers:", (await streak.totalUsers()).toString(), "totalCheckIns:", (await streak.totalCheckIns()).toString());
  console.log("canCheckInToday(deployer, non-holder):", await streak.canCheckInToday(wallet.address));
  console.log("canCheckInToday(Will baw, holder):", await streak.canCheckInToday(BAW));
  try { await streak.checkIn.staticCall(); console.log("UNEXPECTED: deployer checkIn did not revert"); }
  catch (e) { console.log("deployer checkIn correctly reverts (non-holder)"); }
  console.log("BNB left:", hre.ethers.formatEther(await provider.getBalance(wallet.address)));
}
main().catch((e) => { console.error(e); process.exit(1); });
