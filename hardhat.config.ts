import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { defineConfig } from "hardhat/config";

// PR6 runs fully local: in-process EDR network for tests and the local
// JSON-RPC node on 127.0.0.1:8545 (chainId 31337). No secrets, no external RPC.
export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: { optimizer: { enabled: true, runs: 200 } },
      },
    },
  },
  paths: {
    tests: { nodejs: "./test" },
  },
  networks: {
    hardhatMainnet: { type: "edr-simulated", chainType: "l1" },
    localhost: { type: "http", chainType: "l1", url: "http://127.0.0.1:8545" },
  },
});
