// AgentStreak — network & contract configuration
// Edit the placeholder addresses after each deployment. No keys, no secrets here —
// this file is public static configuration only.

const CONFIG = {
  // Default network shown on load: "testnet" | "mainnet"
  defaultNetwork: "testnet",

  networks: {
    testnet: {
      key: "testnet",
      label: "BSC Testnet",
      chainId: 97,
      chainIdHex: "0x61",
      // Standard network name used only when asking the wallet to add/switch networks.
      walletChainName: "BNB Smart Chain Testnet",
      currencySymbol: "tBNB",
      rpcUrl: "https://bsc-testnet-rpc.publicnode.com",
      explorerUrl: "https://testnet.bscscan.com",

      // PLACEHOLDER — fill after the MockAgentID deploy on testnet.
      // This is the address AgentStreak was constructed with on testnet
      // (the MockAgentID contract, NOT the real Agent ID contract).
      agentIdAddress: "0xaf5DF4eC73dC80CD4bcAe4a135c5064494c6CadA",

      // PLACEHOLDER — fill after the AgentStreak deploy on testnet.
      agentStreakAddress: "0x5DF46de6fe6222E65971116c09d803d21C4AEf5e",
    },

    mainnet: {
      key: "mainnet",
      label: "BSC Mainnet",
      chainId: 56,
      chainIdHex: "0x38",
      walletChainName: "BNB Smart Chain",
      currencySymbol: "BNB",
      rpcUrl: "https://bsc-dataseed.binance.org",
      explorerUrl: "https://bscscan.com",

      // Real Agent ID contract (SPACE ID Agent ID, ERC-721) on mainnet.
      agentIdAddress: "0x60b9262456de011f7d15a54cdd8c48baaa8b022f",

      // PLACEHOLDER — fill after the AgentStreak deploy on mainnet.
      agentStreakAddress: "0xaf5DF4eC73dC80CD4bcAe4a135c5064494c6CadA",
    },
  },
};

// Browser global (this is a plain static site, no build step / modules).
window.CONFIG = CONFIG;
