require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const fetch = require('node-fetch');
const { ethers } = require('ethers');
const { sequelize, connectDB } = require('./db');
const { User } = require("../models/User");
const { createWallet, getBalance } = require('../wallet');
const { estimateGas, processWithdrawal } = require("../withdraw");
const { swapTokens } = require("../swap");
const { addLiquidity } = require("../liquidity");

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

connectDB();
sequelize.sync({ alter: true }).then(() => console.log('Database synchronized'));

bot.telegram.setMyCommands([
  { command: '/start', description: 'Start the bot' },
  { command: '/portfolio', description: 'View your portfolio' },
  { command: '/wallet', description: 'View your wallet' },
]);

const DEXSCREENER_API_URL = `https://api.dexscreener.com/tokens/v1/sonic/`;

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
];

function formatNumber(num) {
  return num.toLocaleString('en-US');
}

function escapeHTML(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function getTokenBalance(address, tokenSymbol) {
  try {
    const provider = new ethers.JsonRpcProvider("https://rpc.soniclabs.com");
    const contract = new ethers.Contract(TOKEN_ADDRESSES[tokenSymbol], ERC20_ABI, provider);
    
    const balance = await contract.balanceOf(address);
    
    if (balance.toString() === "0x") {
      return "0"; 
    }
    
    return ethers.formatUnits(balance, 18);
  } catch (error) {
    console.error("Error fetching stS token balance:", error);
    return "Error fetching balance";
  }
}

bot.start(async (ctx) => {
  const { id, username, first_name, last_name } = ctx.from;

  let user = await User.findByPk(id);

  if (!user) {
    const { address, privateKey } = createWallet();

    user = await User.create({
      id,
      username,
      firstName: first_name,
      lastName: last_name,
      walletAddress: address,
      privateKey: privateKey,
    });

    const walletBalance = await getBalance(address);

    ctx.replyWithHTML(
      `🎉 Welcome to Pinkwave – the simplest way to provide liquidity on the Sonic blockchain.\n\n` +
      `💰 <b>Your wallet balance:</b> ${Number(walletBalance).toFixed(3)} S\n\n` +
      `🔹 <b>Wallet Address:\n</b> <code>${address}</code>\n\n` +
      `Deposit S and tokens into the above wallet address to get started.`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Open Position', 'token_select')],
        [Markup.button.callback('Portfolio', 'portfolio'), Markup.button.callback('Wallet', 'wallet')]
      ])
    );
  } else {
    const walletBalance = await getBalance(user.walletAddress);
    ctx.replyWithHTML(
      `🎉 Welcome to Pinkwave – the simplest way to provide liquidity on the Sonic blockchain.\n\n` +
      `💰 <b>Your wallet balance:</b> ${Number(walletBalance).toFixed(3)} S\n\n` +
      `🔹 <b>Wallet Address:\n</b> <code>${user.walletAddress}</code>\n\n` +
      `Deposit S and tokens into the above wallet address to get started.`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Open Position', 'token_select')],
        [Markup.button.callback('Portfolio', 'portfolio'), Markup.button.callback('Wallet', 'wallet')] 
      ])
    );
  }
});

bot.command('portfolio', async (ctx) => {
  await showPortfolio(ctx);
});

bot.command('wallet', async (ctx) => {
  await showWallet(ctx)
})

bot.action('token_select', async (ctx) => {
  ctx.reply(
    'Select a token from the whitelist below to open a position.'
  );
});

bot.action(/^choose_(.+)$/, async (ctx) => {
  try {
    const tokenSymbol = ctx.match[1];
    console.log("Chosen token:", tokenSymbol);

    if (!ctx.session) {
      ctx.session = {};
    }

    ctx.session.selectedToken = tokenSymbol;

    const tokenAddress = TOKEN_ADDRESSES[tokenSymbol];

    if (!tokenAddress) {
      console.log("Token not found in whitelist!");
      return ctx.reply('❌ Token not found in the whitelist.');
    }

    const loadingMessage = await ctx.reply(`🔍 Fetching ${tokenSymbol} data...`);

    const response = await fetch(DEXSCREENER_API_URL + tokenAddress);
    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      return ctx.telegram.editMessageText(
        ctx.chat.id,
        loadingMessage.message_id,
        null,
        `❌ Pair for ${tokenSymbol} not found on DexScreener.`
      );
    }

    const pairData = data[0];
    const baseToken = pairData.baseToken;
    const priceUsd = pairData.priceUsd ? `$${formatNumber(parseFloat(pairData.priceUsd))}` : 'N/A';
    const marketCap = pairData.marketCap ? `$${formatNumber(pairData.marketCap)}` : 'N/A';
    const volume1h = pairData.volume.h1 ? `$${formatNumber(pairData.volume.h1)}` : 'N/A';
    const volume6h = pairData.volume.h6 ? `$${formatNumber(pairData.volume.h6)}` : 'N/A';
    const volume24h = pairData.volume.h24 ? `$${formatNumber(pairData.volume.h24)}` : 'N/A';
    const priceChange1h = pairData.priceChange.h1 ? `${pairData.priceChange.h1}%` : 'N/A';
    const priceChange6h = pairData.priceChange.h6 ? `${pairData.priceChange.h6}%` : 'N/A';
    const priceChange24h = pairData.priceChange.h24 ? `${pairData.priceChange.h24}%` : 'N/A';
    const pairUrl = pairData.url;

    const user = await User.findByPk(ctx.from.id);
    const walletAddress = user ? user.walletAddress : 'N/A';

    const tokenBalance = walletAddress !== 'N/A' ? await getTokenBalance(walletAddress, baseToken.symbol) : '0';

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMessage.message_id,
      null,
      `<b>${baseToken.name} | ${baseToken.symbol} | ${baseToken.address}</b>\n\n` +
      `💵 <b>Price:</b> ${priceUsd}\n` +
      `🌍 <b>Mcap:</b> ${marketCap}\n\n` +
      `📊 <b>Price Change:</b>\n` +
      `- 1h: ${priceChange1h}\n` + 
      `- 6h: ${priceChange6h}\n` +
      `- 24h: ${priceChange24h}\n\n` +
      `🏦 <b>Your ${tokenSymbol} balance:</b> ${Number(tokenBalance).toFixed(3)} ${tokenSymbol}\n\n` +
      `<a href="${pairUrl}">🌐 View on DexScreener</a>`,
      {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...Markup.inlineKeyboard([
          [Markup.button.callback('Open Position', 'open_position')],
          [Markup.button.callback('Buy', 'buy_token'), Markup.button.callback('Sell', 'sell_token')],
          [Markup.button.callback('Close', 'close')]
        ])
      }
    );

  } catch (error) {
    console.error(`Error fetching ${tokenSymbol} data:`, error);
    ctx.reply(`❌ Error retrieving ${tokenSymbol} data.`);
  }
});

bot.action('open_position', async (ctx) => {
  try {
    const tokenSymbol = ctx.session.selectedToken;

    if (!tokenSymbol) {
      return ctx.reply('❌ No token has been selected. Please choose a token first.');
    }

    ctx.session.creatingLPPosition = true;

    ctx.replyWithHTML(
      `💡 <b>Create Liquidity Position</b>\n\n` +
      `Please enter the amount of S you wish to use to create liquidity position:`,
      Markup.inlineKeyboard([[Markup.button.callback('Cancel', 'cancel_lp_creation')]])
    );
  } catch (error) {
    console.error('Error handling open position:', error);
    ctx.reply('❌ An error occurred. Please try again.');
  }
});

bot.hears(/^\d+(\.\d+)?$/, async (ctx) => {
  if (!ctx.session) ctx.session = {};

  if (ctx.session.creatingLPPosition) {
    const amount = ctx.message.text.trim();
    const user = await User.findByPk(ctx.from.id);

    if (!user) {
      return ctx.reply('❌ You must register first by using the /start command.');
    }

    const walletBalance = await getBalance(user.walletAddress);

    if (isNaN(amount) || parseFloat(amount) <= 0) {
      return ctx.reply('❌ The amount you entered is invalid. Please provide a valid number.');
    }

    if (parseFloat(amount) > parseFloat(walletBalance)) {
      return ctx.reply('❌ You do not have enough funds. Please enter a smaller amount.');
    }

    ctx.session.lpAmount = amount;
    ctx.session.creatingLPPosition = false;

    const loadingMessage = await ctx.reply('🔍 Searching for the best liquidity pool…');
  }
});

bot.action('cancel_lp_creation', async (ctx) => {
  ctx.session.creatingLPPosition = false;
  ctx.reply('❌ The creation of the liquidity position has been canceled.');
});

bot.action(/^(enable_rebalancing|disable_rebalancing)$/, async (ctx) => {
  try {
    const action = ctx.match[0]; 
    const amount = ctx.session.lpAmount; 
    const tokenSymbol = ctx.session.selectedToken; 

    if (!amount || !tokenSymbol) {
      return ctx.reply('❌ No amount or token selected. Please start the process again.');
    }

    const autoRebalancing = action === 'enable_rebalancing';

    ctx.replyWithHTML(
      `📊 <b>Position Preview</b>\n\n` +
      `🎯 <b>Strategy:</b> SPOT\n` +
      `🌊 <b>Pool:</b> ${tokenSymbol}/S\n` +
      `💰 <b>Amount:</b> ${(0.64 / 2).toFixed(2)} ${tokenSymbol} / ${(amount / 2).toFixed(2)} S\n` +
      `🔄 <b>Auto-rebalancing:</b> ${autoRebalancing ? '🟢 enabled' : '🔴 disabled'}\n\n` +
      `✅ Create the position by confirming below.`,
      Markup.inlineKeyboard([
        [Markup.button.callback('No', 'cancel_position'), Markup.button.callback('Yes', 'confirm_position')]
      ])
    );

    ctx.session.autoRebalancing = autoRebalancing;
  } catch (error) {
    console.error('Error handling rebalancing choice:', error);
    ctx.reply('❌ An error occurred. Please try again.');
  }
});

bot.action('cancel_position', async (ctx) => {
  ctx.reply('❌ Position creation canceled.');
  ctx.session.creatingLPPosition = false;
  ctx.session.lpAmount = null;
  ctx.session.autoRebalancing = null;
});

bot.action('confirm_position', async (ctx) => {
  try {
    const amount = ctx.session.lpAmount;
    const tokenSymbol = ctx.session.selectedToken;
    const autoRebalancing = ctx.session.autoRebalancing;

    if (!amount || !tokenSymbol) {
      return ctx.reply('❌ No amount or token selected. Please start the process again.');
    }

    const initMessage = await ctx.reply('⏳ Initializing new position…');

    const user = await User.findByPk(ctx.from.id);
    const walletAddress = user ? user.walletAddress : 'N/A';
  } catch (error) {
    console.error('Error confirming position:', error);
    ctx.reply('❌ An error occurred while creating the position. Please try again.');
  }
});

bot.action('buy_token', async (ctx) => {
  const tokenSymbol = ctx.session.selectedToken;
  ctx.session.transactionType = 'buy'; 
  await ctx.reply(`💰 Enter the amount of S you want to spend to buy ${tokenSymbol}:`);
});

bot.action('sell_token', async (ctx) => {
  const tokenSymbol = ctx.session.selectedToken;
  ctx.session.transactionType = 'sell'; 
  await ctx.reply(`💰 Enter the amount of ${tokenSymbol} you want to sell:`);
});

bot.hears(/^(\d+(\.\d+)?)$/i, async (ctx) => {
  try {
    const amount = parseFloat(ctx.match[1]);

    const user = await User.findByPk(ctx.from.id);
    const walletBalance = await getBalance(user.walletAddress);

    if (isNaN(amount) || amount <= 0) {
      return ctx.reply('❌ Invalid amount. Please enter a valid number.');
    }

    const transactionType = ctx.session.transactionType;
    const tokenSymbol = ctx.session.selectedToken;
    
    if (transactionType === 'buy') {
      if (amount > parseFloat(walletBalance)) {
        return ctx.reply('❌ Insufficient funds. Please enter a lower amount.');
      }

      await ctx.replyWithHTML(
        `⚡ <b>Confirm Swap</b>\n\n` +
        `🔄 <b>Swap:</b> ${amount} Sonic → ${tokenSymbol}\n` +
        `⏳ Processing time: ~30 sec\n\n` +
        `Click "Confirm" to proceed.`,
        Markup.inlineKeyboard([
          [Markup.button.callback("Confirm Swap", `confirm_swap_${amount}`)]
        ])
      );
    } else if (transactionType === 'sell') {
      const tokenBalance = await getTokenBalance(user.walletAddress, tokenSymbol);

      if (amount > parseFloat(tokenBalance)) {
        return ctx.reply(`❌ You don't have enough ${tokenSymbol} to sell. Please enter a lower amount.`);
      }

      await ctx.replyWithHTML(
        `⚡ <b>Confirm Swap</b>\n\n` +
        `🔄 <b>Swap:</b> ${amount} ${tokenSymbol} → Sonic\n` +
        `⏳ Processing time: ~30 sec\n\n` +
        `Click "Confirm" to proceed.`,
        Markup.inlineKeyboard([
          [Markup.button.callback("Confirm Swap", `confirm_swap_${amount}`)]
        ])
      );
    }
  } catch (error) {
    console.error("❌ Error in amount handler:", error);
    ctx.reply("❌ An error occurred. Please try again.");
  }
});

bot.action(/^confirm_swap_(.*)$/, async (ctx) => {
  try {
    const amount = ctx.match[1];
    const transactionType = ctx.session.transactionType;
    const tokenSymbol = ctx.session.selectedToken;

    console.log(`🔄 Confirming swap for ${amount} ${transactionType === 'buy' ? 'Sonic' : tokenSymbol} → ${transactionType === 'buy' ? tokenSymbol : 'Sonic'}`);

    ctx.reply("⏳ Processing... Please wait.");

    if (transactionType === 'buy') {
      const result = await swapTokens(ctx.from.id, amount, '039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38', TOKEN_ADDRESSES[tokenSymbol].slice(2));
      if (!result.success) return ctx.reply(`❌ Swap failed: ${result.error}`);

      ctx.replyWithHTML(
        `✅ <b>Swap Successful!</b>\n\n` +
        `🔄 <b>Swapped:</b> ${amount} Sonic → ${tokenSymbol}\n` +
        `🔗 <a href="https://sonicscan.org/tx/${result.txHash}">View Transaction</a>`, {disable_web_page_preview: true}
      );
    } else if (transactionType === 'sell') {
      const result = await swapTokens(ctx.from.id, amount, TOKEN_ADDRESSES[tokenSymbol].slice(2), '039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38');
      if (!result.success) return ctx.reply(`❌ Swap failed: ${result.error}`);

      ctx.replyWithHTML(
        `✅ <b>Swap Successful!</b>\n\n` +
        `🔄 <b>Swapped:</b> ${amount} ${tokenSymbol} → Sonic\n` +
        `🔗 <a href="https://sonicscan.org/tx/${result.txHash}">View Transaction</a>`, {disable_web_page_preview: true}
      );
    }
  } catch (error) {
    console.error("❌ Error confirming swap:", error);
    ctx.reply("❌ Swap confirmation failed.");
  }
});

bot.action("withdraw_start", async (ctx) => {
  try {
    const user = await User.findByPk(ctx.from.id);
    if (!user) return ctx.reply("❌ You need to register first by using /start");

    const walletBalance = await getBalance(user.walletAddress);
    const gasInfo = await estimateGas(user.walletAddress, walletBalance);

    ctx.replyWithHTML(
      `💰 <b>Your Balance:</b> ${walletBalance} S\n` +
      `⛽ <b>Estimated Gas Fee:</b> ~${gasInfo.estimatedFee} S\n\n` +
      `Enter the amount you want to withdraw:`
    );

    if (!ctx.session) ctx.session = {};
    ctx.session.waitingForWithdrawAmount = true;
  } catch (error) {
    console.error("Error handling withdrawal start:", error);
    ctx.reply("❌ An error occurred. Please try again.");
  }
});

bot.hears(/^\d+(\.\d+)?$/, async (ctx) => {
  if (!ctx.session) ctx.session = {};

  if (ctx.session.waitingForWithdrawAmount) {
    const amount = ctx.message.text.trim();
    const user = await User.findByPk(ctx.from.id);
    if (!user) return ctx.reply("❌ You need to register first by using /start");

    const walletBalance = await getBalance(user.walletAddress);
    if (isNaN(amount) || parseFloat(amount) <= 0) {
      return ctx.reply("❌ Invalid amount. Please enter a valid number.");
    }

    if (parseFloat(amount) > parseFloat(walletBalance)) {
      return ctx.reply("❌ Insufficient funds. Enter a lower amount.");
    }

    ctx.session.withdrawAmount = amount;
    ctx.session.waitingForWithdrawAmount = false;
    ctx.session.waitingForRecipient = true;

    ctx.replyWithHTML(
      `✅ <b>Confirm Withdrawal</b>\n\n` +
      `💸 <b>Amount:</b> ${amount} S\n` +
      `📩 Enter the recipient address:`
    );
  }
});

bot.on("text", async (ctx) => {
  if (!ctx.session) ctx.session = {};

  if (ctx.session.waitingForRecipient) {
    const recipientAddress = ctx.message.text.trim();
    if (!ethers.isAddress(recipientAddress)) {
      return ctx.reply("❌ Invalid wallet address. Please enter a valid address.");
    }

    ctx.session.recipientAddress = recipientAddress;
    ctx.session.waitingForRecipient = false; 

    ctx.replyWithHTML(
      `✅ <b>Final Confirmation</b>\n\n` +
      `💸 <b>Amount:</b> ${ctx.session.withdrawAmount} S\n` +
      `📩 <b>Recipient:</b> ${recipientAddress}\n\n` +
      `Click "Confirm" to proceed.`,
      Markup.inlineKeyboard([[Markup.button.callback("Confirm Withdrawal", "withdraw_confirm")]])
    );
  }
});

bot.action("withdraw_confirm", async (ctx) => {
  try {
    const user = await User.findByPk(ctx.from.id);
    if (!user) return ctx.reply("❌ You need to register first by using /start");

    const amount = ctx.session.withdrawAmount;
    const recipient = ctx.session.recipientAddress;

    ctx.reply("⏳ Processing withdrawal...");

    const result = await processWithdrawal(ctx.from.id, amount, recipient);
    if (!result.success) return ctx.reply(`❌ Withdrawal failed: ${result.error}`);

    ctx.replyWithHTML(
      `✅ <b>Withdrawal Successful!</b>\n\n` +
      `💸 <b>Amount:</b> ${amount} S\n` +
      `📩 <b>Recipient:</b> ${recipient}\n\n` +
      `🔗 <a href="https://sonicscan.org/tx/${result.txHash}">View Transaction</a>`
    );

    ctx.session.withdrawAmount = null;
    ctx.session.recipientAddress = null;
  } catch (error) {
    console.error("Error processing withdrawal:", error);
    ctx.reply("❌ An error occurred while processing the withdrawal.");
  }
});

async function showPortfolio(ctx) {
  try {
    const loadingMessage = await ctx.reply('⏳ Fetching positions…');
  } catch (error) {
    console.error('Error fetching portfolio:', error);
    ctx.reply('❌ An error occurred while fetching your portfolio. Please try again.');
  }
}

async function showWallet(ctx) {
  try {
      const user = await User.findByPk(ctx.from.id);
      if (!user) return ctx.reply("❌ You need to register first by using /start");
  
      const walletBalance = await getBalance(user.walletAddress);
      const gasInfo = await estimateGas(user.walletAddress, walletBalance);
  
      ctx.replyWithHTML(
        `💰 <b>Your Balance:</b> ${walletBalance} S`
      );
  } catch (error) {
  }
}

bot.action('portfolio', async (ctx) => {
  await showPortfolio(ctx);
});

bot.action('wallet', async (ctx) => {
  await showWallet(ctx)
})

bot.action('close_position', async (ctx) => {
  try {
    await ctx.reply('⏳ Closing your position…');
  } catch (error) {
    console.error('Error closing position:', error);
    ctx.reply('❌ An error occurred while closing your position. Please try again.');
  }
});

bot.action('refresh_portfolio', async (ctx) => {
  try {
    await ctx.reply('⏳ Refreshing your portfolio…');
  } catch (error) {
    console.error('Error refreshing portfolio:', error);
    ctx.reply('❌ An error occurred while refreshing your portfolio. Please try again.');
  }
});

bot.launch();
console.log('🚀 Bot started!');
