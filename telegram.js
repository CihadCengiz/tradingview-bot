// telegram.js
const TelegramBot = require('node-telegram-bot-api');
// Import all specific keys and the chat ID
const {
  YUKSELEN_KEY,
  DUSEN_KEY,
  FARK_KEY,
  DUSEN_KESISIM_KEY,
  YUKSELEN_KESISIM_KEY,
  TELEGRAM_CHAT_ID,
} = require('./config');

// Map alert types to their corresponding token environment variable names
const alertTypeToTokenMap = {
  difference_alert: 'FARK_KEY',
  bullish_crossover_1d: 'YUKSELEN_KESISIM_KEY',
  bearish_crossover_1h: 'DUSEN_KESISIM_KEY',
  // Add mappings for other alert types if needed, e.g.:
  // 'yukselen_alert': 'YUKSELEN_KEY',
  // 'dusen_alert': 'DUSEN_KEY',
};

// Initialize Telegram Bot instances for each available token
const botInstances = {};

// Get unique tokens that are actually provided in the config
const uniqueTokens = new Set();
if (YUKSELEN_KEY) uniqueTokens.add(YUKSELEN_KEY);
if (DUSEN_KEY) uniqueTokens.add(DUSEN_KEY);
if (FARK_KEY) uniqueTokens.add(FARK_KEY);
if (DUSEN_KESISIM_KEY) uniqueTokens.add(DUSEN_KESISIM_KEY);
if (YUKSELEN_KESISIM_KEY) uniqueTokens.add(YUKSELEN_KESISIM_KEY);

// Initialize a bot instance for each unique token
uniqueTokens.forEach(async (token) => {
  try {
    botInstances[token] = new TelegramBot(token, { polling: false });

    console.log(
      `Telegram Bot initialized for token starting with: ${token.substring(
        0,
        5
      )}...`
    );
  } catch (error) {
    console.error(
      `Error initializing Telegram Bot for token starting with ${token.substring(
        0,
        5
      )}...:`,
      error.message
    );
  }
});

// Function to send Telegram alerts
async function sendTelegramAlert(symbol, alertType, message) {
  // Get the token name for the given alert type
  const tokenName = alertTypeToTokenMap[alertType];

  if (!tokenName) {
    console.warn(
      `[${symbol.toUpperCase()}] No token mapping found for alert type: ${alertType}. Alert not sent.`
    );
    return;
  }

  // Get the actual token value from config
  const botToken = require('./config')[tokenName]; // Re-import config to get latest values if needed, or pass config object

  // Get the bot instance for this token
  const bot = botInstances[botToken];

  if (!botToken || !TELEGRAM_CHAT_ID) {
    console.warn(
      `[${symbol.toUpperCase()}] Telegram credentials not fully set for alert type ${alertType} (Token: ${tokenName}, Chat ID: TELEGRAM_CHAT_ID). Alert not sent.`
    );
    return;
  }

  if (!bot) {
    console.error(
      `[${symbol.toUpperCase()}] Telegram Bot instance not found for token associated with alert type: ${alertType}. Alert not sent.`
    );
    return;
  }

  try {
    // Check cooldown before sending
    const alertKey = `${symbol}_${alertType}`;
    const now = Date.now();
    const { sentAlerts } = require('./data'); // Import here to get the latest state
    const { ALERT_COOLDOWN_MS } = require('./config'); // Import here to get the latest state

    if (
      sentAlerts[alertKey] &&
      now - sentAlerts[alertKey] < ALERT_COOLDOWN_MS
    ) {
      // console.log(`[${symbol.toUpperCase()}] Alert type ${alertType} is on cooldown. Skipping.`);
      return;
    }

    // Use the specific bot instance and the single chat ID
    await bot.sendMessage(TELEGRAM_CHAT_ID, message, {
      parse_mode: 'Markdown',
    });
    console.log(
      `[${symbol.toUpperCase()}] Telegram alert sent for ${alertType} using token ${tokenName}.`
    );

    // Update last sent time
    sentAlerts[alertKey] = now;
  } catch (error) {
    console.error(
      `[${symbol.toUpperCase()}] Error sending Telegram alert for ${alertType} using token ${tokenName}:`,
      error.message
    );
  }
}

module.exports = {
  sendTelegramAlert,
};
