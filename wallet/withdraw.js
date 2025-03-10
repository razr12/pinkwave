const { ethers } = require("ethers");
const { User } = require("./models/User");

const SONIC_MAINNET_RPC_URL = "https://rpc.soniclabs.com";

const provider = new ethers.JsonRpcProvider(SONIC_MAINNET_RPC_URL);

async function estimateGas(walletAddress, amount) {
  try {
    const gasPrice = await provider.getFeeData();
    const gasPriceValue = gasPrice.gasPrice; 

    const amountInWei = ethers.parseUnits(amount, "ether");

    const estimatedGasLimit = await provider.estimateGas({
      from: walletAddress,
      to: walletAddress,
      value: amountInWei,
    });

    const estimatedGas = estimatedGasLimit * gasPriceValue;

    return {
      gasPrice: ethers.formatUnits(gasPriceValue, "gwei"),
      estimatedFee: ethers.formatEther(estimatedGas.toString()),
    };
  } catch (error) {
    console.error("Error estimating gas:", error);
    return { gasPrice: "N/A", estimatedFee: "N/A" };
  }
}

async function processWithdrawal(userId, amount, recipientAddress) {
  try {
    const user = await User.findByPk(userId);
    if (!user) return { success: false, error: "User not found" };

    const wallet = new ethers.Wallet(user.privateKey, provider);

    const amountInWei = ethers.parseUnits(amount, "ether");

    const balance = await provider.getBalance(wallet.address);
    const balanceInWei = ethers.parseUnits(balance.toString(), "wei");

    if (ethers.toBigInt(balance) < ethers.toBigInt(amountInWei)) {
      return { success: false, error: "Insufficient funds" };
    }

    const tx = await wallet.sendTransaction({
      to: recipientAddress,
      value: amountInWei,
    });

    return { success: true, txHash: tx.hash };
  } catch (error) {
    console.error("Error processing withdrawal:", error);
    return { success: false, error: `Transaction failed: ${error.message}` };
  }
}

module.exports = { estimateGas, processWithdrawal };
