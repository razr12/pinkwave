const { ethers } = require("ethers");
const { User } = require("./models/User");

const SONIC_MAINNET_RPC_URL = "https://rpc.soniclabs.com";

const provider = new ethers.JsonRpcProvider(SONIC_MAINNET_RPC_URL);
const abiCoder = ethers.AbiCoder.defaultAbiCoder();

const SHADOW_DEX_ABI = [
  "function execute(bytes commands, bytes[] inputs, uint256 deadline)"
];

async function swapTokens(userId, amountInSonic, tokenIn, tokenOut) {
    try {
        if (!amountInSonic || isNaN(amountInSonic) || Number(amountInSonic) <= 0) {
            throw new Error("Invalid swap amount");
        }

        const user = await User.findByPk(userId);
        if (!user) return { success: false, error: "User not found" };

        const wallet = new ethers.Wallet(user.privateKey, provider);
        const contract = new ethers.Contract(SHADOW_DEX_CONTRACT, SHADOW_DEX_ABI, wallet);

        const amountInWei = ethers.parseUnits(amountInSonic, "ether");

        const amountIn = amountInWei;
        const amountOutMin = ethers.parseUnits("0.0", "ether");

        if (isBuy) {
            const tickSpacing = TOKEN_TICKSPACING[tokenOut];
            console.log('Tickspacing: ', tickSpacing)

            const commands = ethers.toBeHex(0x0b00)
            const payerIsUser = false;
            const encodedBytes = ethers.solidityPacked(
                ["address", "uint24", "address"],
                [tokenIn, tickSpacing, tokenOut]
            );
            const nativeToken = [
                abiCoder.encode(
                    ["address", "uint256"],
                    [targetNativeAdress, amountIn]
                )
            ]
            const preInputs = [
                abiCoder.encode(
                    ["address", "uint256", "uint256", "bytes", "bool"],
                    [targetAdress, amountIn, amountOutMin, encodedBytes, payerIsUser]
                )
            ]
            const inputs = [...nativeToken, ...preInputs];
            console.log("📜 Commands:", commands);
            console.log("📥 Inputs:", inputs);

            const tx = await contract.execute(
                commands,
                inputs,
                Math.floor(Date.now() / 1000) + 3600,
                {
                    gasLimit: 1_500_000,
                    value: ethers.parseEther(amountInSonic)
                }
            );
            console.log(`✅ Swap successful! TX Hash: ${tx.hash}`);

            return { success: true, txHash: tx.hash };
        } else {
            const tokenContract = new ethers.Contract('0x' + tokenIn, [
                "function approve(address spender, uint256 amount) public returns (bool)"
            ], wallet);

            console.log('Token contract: ', tokenContract)
            
            const maxUint256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
            console.log('Max uint256: ', maxUint256);

            const approveTx = await tokenContract.approve(SHADOW_DEX_CONTRACT, maxUint256);
            await approveTx.wait();

            console.log(`✅ Approval successful! TX Hash: ${approveTx.hash}`);

            const tickSpacing = TOKEN_TICKSPACING[tokenIn];
            console.log('Tickspacing: ', tickSpacing)

            const commands = '0x000c'
            const payerIsUser = true;
            const encodedBytes = ethers.solidityPacked(
                ["address", "uint24", "address"],
                [tokenIn, tickSpacing, tokenOut]
            );
            const preInputs = [
                abiCoder.encode(
                    ["address", "uint256", "uint256", "bytes", "bool"],
                    [targetNativeAdress, amountIn, amountOutMin, encodedBytes, payerIsUser]
                )
            ]
            const nativeToken = [
                abiCoder.encode(
                    ["address", "uint256"],
                    [targetAdress, amountIn]
                )
            ]
            const inputs = [...preInputs, ...nativeToken];
            console.log("📜 Commands:", commands);
            console.log("📥 Inputs:", inputs);

            const tx = await contract.execute(
                commands,
                inputs,
                Math.floor(Date.now() / 1000) + 3600, 
                {
                    gasLimit: 1_500_000, 
                    value: ethers.parseEther("0")
                }
            );
            console.log(`✅ Swap successful! TX Hash: ${tx.hash}`);
            return { success: true, txHash: tx.hash };
        }
    } catch (error) {
        console.error("❌ Swap error:", error);
        return { success: false, error: `Swap failed: ${error.message}` };
    }
}

module.exports = { swapTokens };
