// telegram.js
const TelegramBot = require('node-telegram-bot-api');
// Import all specific keys and the chat ID
const {
  TELEGRAM_CHAT_ID, // Import chat ID
  DIFF_ALERT_1H_KEY,
  DIFF_ALERT_4H_KEY,
  DIFF_ALERT_1D_KEY,
  ETH_DIFF_ALERT_KEY, // Import the new ETH specific key
} = require('./config');

// Map alert types and symbols/intervals to their corresponding token environment variable names
// This map is now simplified to prioritize symbol-specific keys
const alertTokenMap = {
  // ETHUSDT difference alerts use a single key for all intervals
  'ETHUSDT_difference_alert': 'ETH_DIFF_ALERT_KEY', // This mapping looks correct
  // Other symbols/intervals use interval-specific keys
  'difference_alert_1h': 'DIFF_ALERT_1H_KEY',
  'difference_alert_4h': 'DIFF_ALERT_4H_KEY',
  'difference_alert_1d': 'DIFF_ALERT_1D_KEY',
};


// Initialize Telegram Bot instances for each available token
const botInstances = {};

// Get unique tokens that are actually provided in the config
const uniqueTokens = new Set();
// Add tokens from the new interval-specific keys
if (DIFF_ALERT_1H_KEY) uniqueTokens.add(DIFF_ALERT_1H_KEY);
if (DIFF_ALERT_4H_KEY) uniqueTokens.add(DIFF_ALERT_4H_KEY);
if (DIFF_ALERT_1D_KEY) uniqueTokens.add(DIFF_ALERT_1D_KEY);
if (ETH_DIFF_ALERT_KEY) uniqueTokens.add(ETH_DIFF_ALERT_KEY); // Add the new ETH key

// Initialize a bot instance for each unique token
uniqueTokens.forEach(async (token) => {
  try {
    // Only initialize if the token is not undefined or null
    if (token) {
      botInstances[token] = new TelegramBot(token, { polling: false });

      console.log(
        `Telegram Bot initialized for token starting with: ${token.substring(
          0,
          5
        )}...`
      );
    }
  } catch (error) {
    console.error(
      `Error initializing Telegram Bot for token starting with ${token?.substring(
        0,
        5
      )}...:`,
      error.message
    );
  }
});

// Function to send Telegram alerts
// Added 'interval' parameter
async function sendTelegramAlert(symbol, alertType, message, interval) {
  // Determine the key to look up the token name
  let lookupKey;
  if (alertType === 'difference_alert') {
    if (symbol === 'ETHUSDT') {
      lookupKey = 'ETHUSDT_difference_alert'; // Specific key for ETHUSDT
    } else if (interval) {
      lookupKey = `${alertType}_${interval}`; // Interval-specific key for others
    }
  }

  if (!lookupKey) {
      console.warn(
          `[${symbol.toUpperCase()}] Unsupported alert type or missing info: ${alertType}, Interval: ${interval}. Alert not sent.`
      );
      return;
  }


  // Get the token name from the map
  const tokenName = alertTokenMap[lookupKey];

  if (!tokenName) {
    console.warn(
      `[${symbol.toUpperCase()}] No token mapping found for lookup key: ${lookupKey}. Alert not sent.`
    );
    return;
  }

  // Get the actual token value from config using the tokenName
  // Re-import config here to ensure latest values are used, especially if config changes dynamically
  const config = require('./config');
  const botToken = config[tokenName];

  // Get the bot instance for this token
  const bot = botInstances[botToken];

  if (!botToken || !config.TELEGRAM_CHAT_ID) {
    // Use config.TELEGRAM_CHAT_ID from the re-imported config
    console.warn(
      `[${symbol.toUpperCase()}] Telegram credentials not fully set for alert type ${alertType} (${interval}) (Token: ${tokenName}, Chat ID: TELEGRAM_CHAT_ID). Alert not sent.`
    );
    return;
  }

  if (!bot) {
    console.error(
      `[${symbol.toUpperCase()}] Telegram Bot instance not found for token associated with lookup key: ${lookupKey}. Alert not sent.`
    );
    return;
  }

  try {
    // Check cooldown before sending
    // Update alertKey to include interval for difference alerts
    const alertKey = `${symbol}_${alertType}_${interval}`; // Added interval to key for cooldown tracking
    const now = Date.now();
    const { sentAlerts } = require('./data'); // Import here to get the latest state
    const { ALERT_COOLDOWN_MS } = require('./config'); // Import here to get the latest state

    if (
      sentAlerts[alertKey] &&
      now - sentAlerts[alertKey] < ALERT_COOLDOWN_MS
    ) {
      return;
    }

    // Use the specific bot instance and the single chat ID
    await bot.sendMessage(config.TELEGRAM_CHAT_ID, message, {
      // Use config.TELEGRAM_CHAT_ID
      parse_mode: 'Markdown',
    });
    console.log(
      `[${symbol.toUpperCase()}] Telegram alert sent for ${alertType} (${interval}) using token ${tokenName}.`
    );

    // Update last sent time
    sentAlerts[alertKey] = now;
  } catch (error) {
    console.error(
      `[${symbol.toUpperCase()}] Error sending Telegram alert for ${alertType} (${interval}) using token ${tokenName}:`,
      error.message
    );
  }
}

module.exports = {
  sendTelegramAlert,
};
