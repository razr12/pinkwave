const { ethers } = require("ethers");
const { User } = require("./models/User");
const fetch = require('node-fetch');

const SONIC_MAINNET_RPC_URL = "https://rpc.soniclabs.com";
const provider = new ethers.JsonRpcProvider(SONIC_MAINNET_RPC_URL);
const abiCoder = ethers.AbiCoder.defaultAbiCoder(); 
const abi = [
    "function multicall(bytes[] data)"
];
const deadline = Math.floor(Date.now() / 1000) + 86400;

async function liquidity(userId, amount0, amount1, token0, token1) {
    try {
        const amount0Desired = ethers.parseUnits(Number(amount0).toFixed(18), "ether");
        const amount1Desired = ethers.parseUnits(Number(amount1).toFixed(18), "ether");
        const amount0Min = ethers.parseUnits((Number(amount0) * 0.78).toFixed(18), "ether"); 
        const amount1Min = ethers.parseUnits((Number(amount1) * 0.78).toFixed(18), "ether"); 

        const user = await User.findByPk(userId);
        if (!user) return { success: false, error: "User not found" };
        const recipient = user.walletAddress.slice(2)

        const wallet = new ethers.Wallet(user.privateKey, provider);
        const contract = new ethers.Contract(SHADOW_DEX_CONTRACT, abi, wallet);

        const tokenContract = new ethers.Contract('0x' + token1, [
            "function approve(address spender, uint256 amount) public returns (bool)"
        ], wallet);
        
        const maxUint256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

        const approveTx = await tokenContract.approve(SHADOW_DEX_CONTRACT, maxUint256);
        await approveTx.wait();

        const {tickLower, tickUpper} = await calculateTicks()
        console.log("tickLower:", tickLower);
        console.log("tickUpper:", tickUpper);

        const preInputs = [
            abiCoder.encode(
                ["address", "address", "int24", "int24", "int24", "uint256", "uint256", "uint256", "uint256", "address", "uint256"],
                [token0, token1, tickSpacing, tickLower, tickUpper, amount0Desired, amount1Desired, amount0Min, amount1Min, recipient, deadline]
            )
        ]

        const encodedData = abiCoder.encode(
            ["address", "address", "int24", "int24", "int24", "uint256", "uint256", "uint256", "uint256", "address", "uint256"],
            [token0, token1, tickSpacing, tickLower, tickUpper, amount0Desired, amount1Desired, amount0Min, amount1Min, recipient, deadline]
        )

        const finalData = '0x6d70c415' + encodedData.slice(2);
        console.log('finalData: ', finalData)

        const finalDataArray = [finalData]
        console.log('finalDataArray: ', finalDataArray)

        const lastfunc = ['0x12210e8a']

        const inputs = [...finalDataArray, ...lastfunc];
        console.log("inputs: ", inputs);
    
        const tx = await contract.multicall(
            inputs,
            {
                gasLimit: 3_000_000,
                value: ethers.parseEther(amount0) 
            }
        );
        
        return { success: true, txHash: tx.hash };
    } catch (error) {
        return { success: false, error: `Swap failed: ${error.message}` };
    }
}

async function calculateTicks(pairAddress) {
    const calculateTicks = (priceLower, priceUpper) => {
        const tickLower = Math.floor(Math.log(priceLower) / Math.log(1.0001));
        const tickUpper = Math.floor(Math.log(priceUpper) / Math.log(1.0001));
        const roundedTickLower = Math.round(tickLower / 100) * 100;
        const roundedTickUpper = Math.round(tickUpper / 100) * 100;
        return { tickLower: roundedTickLower, tickUpper: roundedTickUpper };
    };
    
    const DEXSCREENER_API_URL = `https://api.dexscreener.com/latest/dex/pairs/sonic/`;
    const response = await fetch(DEXSCREENER_API_URL + pairAddress);
    const data = await response.json();
    const price = data.pair.priceNative;
    
    const currentPrice = 1 / price; 
    const priceLower = currentPrice * 0.85;
    const priceUpper = currentPrice * 1.15;
    
    const { tickLower, tickUpper } = calculateTicks(priceLower, priceUpper);
    
    console.log("Rounded tickLower:", tickLower);
    console.log("Rounded tickUpper:", tickUpper);
    
    return { tickLower, tickUpper };
}

module.exports = { liquidity };