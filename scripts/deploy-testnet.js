// Deploy MockAgentID + AgentStreak to BSC testnet (chain 97) and live-test checkIn.
// Key is read from ../.testnet-deployer.json (0600, testnet project wallet) — never printed.
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const keyFile = path.join(__dirname, "..", ".testnet-deployer.json");
  const { privateKey } = JSON.parse(fs.readFileSync(keyFile));
  const provider = new hre.ethers.JsonRpcProvider("https://bsc-testnet-rpc.publicnode.com");
  const wallet = new hre.ethers.Wallet(privateKey, provider);
  const bal = await provider.getBalance(wallet.address);
  console.log("deployer:", wallet.address);
  console.log("tBNB balance:", hre.ethers.formatEther(bal));
  if (bal === 0n) throw new Error("No tBNB — claim faucet first");

  const Mock = await hre.ethers.getContractFactory("MockAgentID", wallet);
  const mock = await Mock.deploy();
  await mock.waitForDeployment();
  console.log("MockAgentID:", await mock.getAddress(), "tx:", mock.deploymentTransaction().hash);

  const mintTx = await mock.mint(wallet.address);
  await mintTx.wait();
  console.log("mock minted to deployer, balanceOf:", (await mock.balanceOf(wallet.address)).toString());

  const Agent = await hre.ethers.getContractFactory("AgentStreak", wallet);
  const streak = await Agent.deploy(await mock.getAddress());
  await streak.waitForDeployment();
  console.log("AgentStreak:", await streak.getAddress(), "tx:", streak.deploymentTransaction().hash);

  const ci = await streak.checkIn();
  const rc = await ci.wait();
  console.log("checkIn tx:", rc.hash, "status:", rc.status);
  const u = await streak.getUser(wallet.address);
  console.log("getUser raw:", u.toString());

  try {
    await streak.checkIn.staticCall();
    console.log("UNEXPECTED: second checkIn did not revert");
  } catch (e) {
    console.log("second checkIn correctly reverts:", (e.shortMessage || e.message || "").slice(0, 120));
  }
  console.log("totalUsers:", (await streak.totalUsers()).toString(), "totalCheckIns:", (await streak.totalCheckIns()).toString());
}
main().catch((e) => { console.error(e); process.exit(1); });
