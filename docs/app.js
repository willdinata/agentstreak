// AgentStreak — static frontend logic (vanilla JS + ethers v6, no build step, no backend)
// Rules honored here:
// - Standard browser-wallet connect only (window.ethereum). No QR / pairing-code login.
// - Never auto-signs: checkIn() is only sent after the user clicks, and the user's
//   own wallet shows and confirms the transaction.
// - Never requests token approvals and never moves funds.
"use strict";

// Minimal ABIs — function/event names match contracts/AgentStreak.sol and the
// Agent ID contract's balanceOf (see contracts/MockAgentID.sol for the mock shape).
const AGENT_STREAK_ABI = [
  "function checkIn() external",
  "function canCheckInToday(address account) view returns (bool)",
  "function getUser(address account) view returns (uint256 streak, uint256 totalCheckIns, uint256 points, uint8 level, uint256 lastDay)",
  "function totalUsers() view returns (uint256)",
  "function totalCheckIns() view returns (uint256)",
  "function levelOf(uint256 totalCheckIns) pure returns (uint8)",
  "function levelName(uint8 level) pure returns (string)",
  "function paused() view returns (bool)",
  "event CheckedIn(address indexed user, uint256 day, uint256 streak, uint256 pointsAwarded, uint256 totalPoints)",
];
const AGENT_ID_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
];

// Level thresholds from AgentStreak.sol levelOf(): total check-ins needed per level.
const LEVELS = [
  { level: 0, name: "None", at: 0 },
  { level: 1, name: "Starter", at: 1 },
  { level: 2, name: "Regular", at: 7 },
  { level: 3, name: "Committed", at: 14 },
  { level: 4, name: "Core Agent", at: 30 },
];

const state = {
  networkKey: (window.CONFIG && window.CONFIG.defaultNetwork) || "testnet",
  account: null,
  walletChainId: null,
  isHolder: null, // true / false / null (unknown)
  canCheckIn: false,
  paused: null,
};

function net() {
  return window.CONFIG.networks[state.networkKey];
}
function isConfigured(address) {
  return typeof address === "string" && window.ethers && ethers.isAddress(address);
}
function shorten(address) {
  if (!address || address.length < 10) return address || "";
  return address.slice(0, 6) + "…" + address.slice(-4);
}
function el(id) {
  return document.getElementById(id);
}
function setStatus(id, text, kind) {
  const node = el(id);
  node.textContent = text || "";
  node.className = "status" + (kind ? " " + kind : "");
}

// ---------- Read-only access (works without a connected wallet) ----------
function readProvider() {
  return new ethers.JsonRpcProvider(net().rpcUrl);
}
function readStreakContract(provider) {
  if (!isConfigured(net().agentStreakAddress)) return null;
  return new ethers.Contract(net().agentStreakAddress, AGENT_STREAK_ABI, provider || readProvider());
}
function readAgentIdContract(provider) {
  if (!isConfigured(net().agentIdAddress)) return null;
  return new ethers.Contract(net().agentIdAddress, AGENT_ID_ABI, provider || readProvider());
}

// ---------- Global stats + recent events ----------
async function refreshGlobal() {
  const contract = readStreakContract();
  const note = el("contractNote");
  if (!contract) {
    el("globalUsers").textContent = "–";
    el("globalCheckIns").textContent = "–";
    note.textContent =
      "The AgentStreak contract address for " + net().label + " is not configured yet (deployment pending). Stats and check-ins will appear here once it is filled in.";
    el("recentList").innerHTML = '<li><span class="muted">Contract not configured yet for this network.</span></li>';
    return;
  }
  note.innerHTML =
    'AgentStreak contract: <a href="' + net().explorerUrl + "/address/" + net().agentStreakAddress + '" target="_blank" rel="noopener">' +
    shorten(net().agentStreakAddress) + "</a> on " + net().label + ".";
  try {
    const [users, checkIns] = await Promise.all([contract.totalUsers(), contract.totalCheckIns()]);
    el("globalUsers").textContent = users.toString();
    el("globalCheckIns").textContent = checkIns.toString();
  } catch (err) {
    el("globalUsers").textContent = "–";
    el("globalCheckIns").textContent = "–";
  }
  refreshRecent(contract);
}

async function refreshRecent(contract) {
  const list = el("recentList");
  try {
    const provider = readProvider();
    const latest = await provider.getBlockNumber();
    const fromBlock = latest > 20000 ? latest - 20000 : 0;
    const events = await contract.queryFilter(contract.filters.CheckedIn(), fromBlock, latest);
    if (!events.length) {
      list.innerHTML = '<li><span class="muted">No check-ins yet on this network. Be the first.</span></li>';
      return;
    }
    const recent = events.slice(-10).reverse();
    list.innerHTML = "";
    for (const ev of recent) {
      const a = ev.args;
      const li = document.createElement("li");
      const left = document.createElement("span");
      // Shortened address only — recent activity, never a name-to-wallet lookup.
      left.innerHTML =
        '<span class="addr">' + shorten(a.user) + "</span> · streak " + a.streak.toString() +
        " · +" + a.pointsAwarded.toString() + " pts";
      const right = document.createElement("a");
      right.href = net().explorerUrl + "/tx/" + ev.transactionHash;
      right.target = "_blank";
      right.rel = "noopener";
      right.textContent = "Day " + a.day.toString() + " ↗";
      li.appendChild(left);
      li.appendChild(right);
      list.appendChild(li);
    }
  } catch (err) {
    list.innerHTML = '<li><span class="muted">Could not load recent check-ins right now.</span></li>';
  }
}

// ---------- User state ----------
function levelProgress(total) {
  let current = LEVELS[0];
  let next = null;
  for (let i = 0; i < LEVELS.length; i++) {
    if (total >= LEVELS[i].at) current = LEVELS[i];
    if (total < LEVELS[i].at && !next) next = LEVELS[i];
  }
  return { current, next };
}

function updateCheckInButton(reason) {
  const btn = el("checkInBtn");
  btn.disabled = !state.canCheckIn;
  el("checkInReason").textContent = reason || "";
}

async function refreshUser() {
  const holderBadge = el("holderBadge");
  if (!state.account) {
    holderBadge.textContent = "Agent ID: unknown";
    holderBadge.className = "badge";
    state.isHolder = null;
    state.canCheckIn = false;
    updateCheckInButton("Connect your wallet first.");
    return;
  }
  if (!isOnCorrectNetwork()) {
    holderBadge.textContent = "Agent ID: wrong network";
    holderBadge.className = "badge warn";
    state.canCheckIn = false;
    updateCheckInButton("Switch to " + net().label + " to check in.");
    return;
  }
  const agentId = readAgentIdContract();
  const streak = readStreakContract();
  if (!agentId || !streak) {
    holderBadge.textContent = "Agent ID: not configured";
    holderBadge.className = "badge warn";
    state.canCheckIn = false;
    updateCheckInButton("Contracts for " + net().label + " are not configured yet (deployment pending).");
    return;
  }

  try {
    const balance = await agentId.balanceOf(state.account);
    state.isHolder = balance > 0n;
    holderBadge.textContent = state.isHolder ? "Agent ID: Holder ✓" : "Agent ID: Not a holder";
    holderBadge.className = "badge " + (state.isHolder ? "ok" : "no");
  } catch (err) {
    state.isHolder = null;
    holderBadge.textContent = "Agent ID: could not verify";
    holderBadge.className = "badge warn";
  }

  try {
    const [user, can, isPaused] = await Promise.all([
      streak.getUser(state.account),
      streak.canCheckInToday(state.account),
      streak.paused().catch(function () { return null; }),
    ]);
    state.paused = isPaused;
    const streakVal = Number(user.streak);
    const totalVal = Number(user.totalCheckIns);
    const pointsVal = Number(user.points);
    const levelVal = Number(user.level);

    el("statStreak").textContent = streakVal.toString();
    el("statTotal").textContent = totalVal.toString();
    el("statPoints").textContent = pointsVal.toString();

    // Prefer the contract's own levelName(); fall back to the local table.
    let levelText = (LEVELS[levelVal] && LEVELS[levelVal].name) || "None";
    try {
      levelText = await streak.levelName(levelVal);
    } catch (err) { /* local fallback already set */ }
    el("statLevel").textContent = levelText;

    const prog = levelProgress(totalVal);
    if (prog.next) {
      const span = prog.next.at - prog.current.at;
      const done = totalVal - prog.current.at;
      const pct = span > 0 ? Math.round((done / span) * 100) : 0;
      el("levelProgressBar").style.width = pct + "%";
      el("levelProgressText").textContent =
        "Level " + prog.current.name + " — " + (prog.next.at - totalVal) + " more check-in(s) to reach " + prog.next.name + ".";
    } else {
      el("levelProgressBar").style.width = "100%";
      el("levelProgressText").textContent = "Level " + prog.current.name + " — highest level reached. Keep the streak going.";
    }

    state.canCheckIn = Boolean(can) && state.isHolder === true;
    if (state.paused) {
      state.canCheckIn = false;
      updateCheckInButton("Check-ins are temporarily paused by the contract owner (emergency pause).");
    } else if (state.isHolder === false) {
      updateCheckInButton("Only Agent ID holders can check in. This wallet does not hold an Agent ID on " + net().label + ".");
    } else if (!can) {
      updateCheckInButton("You have already checked in today. Come back tomorrow (UTC) to grow your streak.");
    } else {
      updateCheckInButton("Ready — your wallet will ask you to confirm the check-in transaction.");
    }
  } catch (err) {
    state.canCheckIn = false;
    updateCheckInButton("Could not read your streak from the contract right now.");
  }
}

// ---------- Network handling ----------
function isOnCorrectNetwork() {
  return state.walletChainId === net().chainId;
}
function refreshNetworkBadge() {
  const badge = el("networkBadge");
  const switchBtn = el("switchBtn");
  if (!state.account) {
    badge.textContent = "Not connected";
    badge.className = "badge warn";
    switchBtn.classList.add("hidden");
    return;
  }
  if (isOnCorrectNetwork()) {
    badge.textContent = "On " + net().label;
    badge.className = "badge ok";
    switchBtn.classList.add("hidden");
  } else {
    badge.textContent = "Wrong network";
    badge.className = "badge warn";
    switchBtn.classList.remove("hidden");
  }
}
async function switchNetwork() {
  if (!window.ethereum) return;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: net().chainIdHex }],
    });
  } catch (err) {
    // 4902 = chain not added to the wallet yet.
    if (err && err.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: net().chainIdHex,
          chainName: net().walletChainName,
          nativeCurrency: { name: net().currencySymbol, symbol: net().currencySymbol, decimals: 18 },
          rpcUrls: [net().rpcUrl],
          blockExplorerUrls: [net().explorerUrl],
        }],
      });
    } else {
      setStatus("connectStatus", "Network switch was not completed in your wallet.", "error");
    }
  }
}

// ---------- Connect + check-in ----------
async function connectWallet() {
  if (!window.ethereum) {
    setStatus("connectStatus", "No browser wallet found. Install a wallet extension (for example MetaMask) and reload this page.", "error");
    return;
  }
  if (!window.ethers) {
    setStatus("connectStatus", "The ethers library did not load. Check your connection and reload.", "error");
    return;
  }
  try {
    setStatus("connectStatus", "Waiting for your wallet to connect…");
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    state.account = accounts && accounts[0] ? accounts[0] : null;
    const chainHex = await window.ethereum.request({ method: "eth_chainId" });
    state.walletChainId = parseInt(chainHex, 16);
    onAccountChanged();
    setStatus("connectStatus", state.account ? "Wallet connected." : "No account was shared by the wallet.", state.account ? "good" : "error");
  } catch (err) {
    setStatus("connectStatus", "Connection was cancelled or failed in your wallet.", "error");
  }
}

function onAccountChanged() {
  el("walletAddress").textContent = state.account
    ? "Connected: " + state.account + " (" + shorten(state.account) + ")"
    : "No wallet connected yet.";
  el("connectBtn").textContent = state.account ? "Reconnect Wallet" : "Connect Wallet";
  refreshNetworkBadge();
  refreshUser();
}

async function doCheckIn() {
  setStatus("checkInStatus", "");
  if (!state.account || !window.ethereum) {
    setStatus("checkInStatus", "Connect your wallet first.", "error");
    return;
  }
  if (!isOnCorrectNetwork()) {
    setStatus("checkInStatus", "Switch to " + net().label + " first.", "error");
    return;
  }
  const streakAddress = net().agentStreakAddress;
  if (!isConfigured(streakAddress)) {
    setStatus("checkInStatus", "The AgentStreak contract is not configured for this network yet.", "error");
    return;
  }
  try {
    el("checkInBtn").disabled = true;
    setStatus("checkInStatus", "Please review and confirm the check-in in your wallet…");
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const contract = new ethers.Contract(streakAddress, AGENT_STREAK_ABI, signer);
    const tx = await contract.checkIn();
    setStatus("checkInStatus", "Transaction sent — waiting for confirmation…");
    const receipt = await tx.wait();
    setStatus(
      "checkInStatus",
      "Checked in. Tx: " + receipt.hash + " — view it on the explorer from Recent check-ins below.",
      "good"
    );
    await refreshUser();
    await refreshGlobal();
  } catch (err) {
    let msg = "Check-in failed.";
    if (err && (err.code === "ACTION_REJECTED" || err.code === 4001)) {
      msg = "You rejected the transaction in your wallet — nothing was sent.";
    } else if (err && err.reason) {
      msg = "Check-in failed: " + err.reason;
    } else if (err && err.message && err.message.indexOf("AlreadyCheckedInToday") !== -1) {
      msg = "You have already checked in today.";
    } else if (err && err.message && err.message.indexOf("NotAgentIdHolder") !== -1) {
      msg = "This wallet does not hold an Agent ID on this network.";
    }
    setStatus("checkInStatus", msg, "error");
    refreshUser();
  }
}

// ---------- Wiring ----------
function init() {
  const select = el("networkSelect");
  select.value = state.networkKey;
  select.addEventListener("change", function () {
    state.networkKey = select.value;
    state.isHolder = null;
    state.canCheckIn = false;
    refreshNetworkBadge();
    refreshGlobal();
    refreshUser();
  });
  el("connectBtn").addEventListener("click", connectWallet);
  el("switchBtn").addEventListener("click", switchNetwork);
  el("checkInBtn").addEventListener("click", doCheckIn);

  if (window.ethereum) {
    window.ethereum.on("accountsChanged", function (accounts) {
      state.account = accounts && accounts[0] ? accounts[0] : null;
      onAccountChanged();
    });
    window.ethereum.on("chainChanged", function (chainHex) {
      state.walletChainId = parseInt(chainHex, 16);
      refreshNetworkBadge();
      refreshUser();
    });
    // If the wallet is already connected from a previous visit, pick it up silently
    // (eth_accounts does not prompt).
    window.ethereum.request({ method: "eth_accounts" }).then(function (accounts) {
      if (accounts && accounts[0]) {
        state.account = accounts[0];
        return window.ethereum.request({ method: "eth_chainId" }).then(function (chainHex) {
          state.walletChainId = parseInt(chainHex, 16);
          onAccountChanged();
        });
      }
    }).catch(function () { /* stay disconnected */ });
  }

  refreshGlobal();
}
document.addEventListener("DOMContentLoaded", init);
