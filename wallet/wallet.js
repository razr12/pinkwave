const { ethers } = require('ethers');

const SONIC_MAINNET_RPC_URL = "https://rpc.soniclabs.com";

const provider = new ethers.JsonRpcProvider(SONIC_MAINNET_RPC_URL);

function createWallet() {
  const wallet = ethers.Wallet.createRandom();
  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
  };
}

async function getBalance(address) {
  const balance = await provider.getBalance(address);
  return ethers.formatEther(balance);
}

module.exports = { createWallet, getBalance };
