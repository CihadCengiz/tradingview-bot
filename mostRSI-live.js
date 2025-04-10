// multi-symbol MOSTRSI live monitor
const WebSocket = require('ws');
const { computeMOSTRSI } = require('./mostRSI');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

// Telegram bot setup for different alert types
const TELEGRAM_BOTS = {
  YUKSELEN: {
    token: process.env.YUKSELEN_KEY, // Replace with your bot token for YUKSELEN
    chatId: '',
    ready: false,
    instance: null,
  },
  DUSEN: {
    token: process.env.DUSEN_KEY, // Replace with your bot token for DUSEN
    chatId: '',
    ready: false,
    instance: null,
  },
  FARK: {
    token: process.env.FARK_KEY, // Replace with your bot token for FARK
    chatId: '',
    ready: false,
    instance: null,
  },
  DUSEN_KESISIM: {
    token: process.env.DUSEN_KESISIM_KEY, // Replace with your bot token for DUSEN_KESISIM
    chatId: '',
    ready: false,
    instance: null,
  },
  YUKSELEN_KESISIM: {
    token: process.env.YUKSELEN_KESISIM_KEY, // Replace with your bot token for YUKSELEN_KESISIM
    chatId: '',
    ready: false,
    instance: null,
  },
};

// Track sent alerts to avoid duplicates
const sentAlerts = {};

// Initialize Telegram bots
function initializeTelegramBots() {
  for (const [botType, botConfig] of Object.entries(TELEGRAM_BOTS)) {
    if (botConfig.token) {
      botConfig.instance = new TelegramBot(botConfig.token, { polling: true });

      // Set up message handler for each bot
      botConfig.instance.on('message', (msg) => {
        const chatId = msg.chat.id;

        // Log the chat ID to help users find their chat ID
        console.log(`Received message from ${botType} bot, chat ID: ${chatId}`);

        if (msg.text === '/start') {
          botConfig.instance.sendMessage(
            chatId,
            `MOSTRSI ${botType} Bot is active! You will receive ${botType} alerts here.`
          );
          botConfig.ready = true;

          // If no chat ID is set, use the one from the first message
          if (!botConfig.chatId) {
            console.log(
              `Using chat ID: ${chatId} for ${botType} alerts. Add this to your config.`
            );
            // Store the chat ID globally since we can't modify the const
            global[`${botType}_chatId`] = chatId;
          }
        }
      });

      console.log(
        `${botType} Telegram bot initialized. Send /start to your bot to begin receiving alerts.`
      );
    }
  }
}

// Initialize all bots
initializeTelegramBots();

// Function to send Telegram message through the appropriate bot
async function sendTelegramAlert(symbol, alertType, message) {
  let botType;

  // Map alert types to bot types
  if (alertType === 'overbought') {
    botType = 'YUKSELEN';
  } else if (alertType === 'oversold') {
    botType = 'DUSEN';
  } else if (
    alertType === 'rsi_convergence' ||
    alertType === 'ma_convergence'
  ) {
    botType = 'FARK';
  } else if (alertType === 'top_bearish_cross') {
    botType = 'DUSEN_KESISIM';
  } else if (alertType === 'top_bullish_cross') {
    botType = 'YUKSELEN_KESISIM';
  } else {
    // Default to YUKSELEN bot if no match
    botType = 'YUKSELEN';
  }

  const botConfig = TELEGRAM_BOTS[botType];

  // Skip if bot is not configured
  if (!botConfig || !botConfig.instance) {
    console.log(
      `Bot for ${alertType} (${botType}) is not configured, skipping alert`
    );
    return;
  }

  const chatId = botConfig.chatId || global[`${botType}_chatId`];

  if (botConfig.ready && botConfig.token && chatId) {
    try {
      // Create a unique key for this alert - only use symbol and alert type
      const alertKey = `${symbol}_${alertType}`;

      // Check if we've already sent this alert recently
      if (
        sentAlerts[alertKey] &&
        Date.now() - sentAlerts[alertKey] < 60 * 60 * 1000
      ) {
        return;
      }

      // Send the message
      await botConfig.instance.sendMessage(chatId, message);

      // Mark this alert as sent
      sentAlerts[alertKey] = Date.now();

      // Clean up old alerts (older than 24 hours)
      const now = Date.now();
      for (const key in sentAlerts) {
        if (now - sentAlerts[key] > 24 * 60 * 60 * 1000) {
          delete sentAlerts[key];
        }
      }
    } catch (error) {
      console.error(`Error sending ${botType} Telegram alert:`, error.message);
    }
  } else {
    console.log(
      `${botType} bot is not ready or missing chat ID, alert not sent`
    );
  }
}

// We'll fetch all symbols from Binance
let SYMBOLS = [];
const INTERVAL = '30m'; // Binance interval
const CANDLE_LIMIT = 500; // Max candles to keep in memory per symbol
const THRESHOLD = 1; // Alert threshold for difference in RSI or MOST

// Configuration for two different MOSTRSI setups (top and bottom)
const CONFIG_TOP = {
  rsiLength: 7,
  maLength: 7,
  maType: 'EMA',
  stopLossPercent: 9,
};
const CONFIG_BOTTOM = {
  rsiLength: 14,
  maLength: 5,
  maType: 'VAR',
  stopLossPercent: 9,
};

// Store candle data for each symbol
const candleBuffers = {};

// Function to fetch all available USDT trading pairs from Binance
async function fetchAllSymbols() {
  try {
    const response = await fetch('https://api.binance.com/api/v3/exchangeInfo');
    const data = await response.json();

    // Filter for USDT trading pairs only and convert to lowercase
    const usdtPairs = data.symbols
      .filter(
        (symbol) =>
          symbol.status === 'TRADING' &&
          symbol.quoteAsset === 'USDT' &&
          !symbol.symbol.includes('UP') &&
          !symbol.symbol.includes('DOWN') &&
          !symbol.symbol.includes('BEAR') &&
          !symbol.symbol.includes('BULL')
      )
      .map((symbol) => symbol.symbol.toLowerCase());


    // Limit the number of pairs to monitor to avoid rate limits
    // You can adjust this number based on your system's capabilities
    const maxPairs = 1000;
    SYMBOLS = usdtPairs.slice(0, maxPairs);

    console.log(
      `Monitoring ${SYMBOLS.length} trading pairs: ${SYMBOLS.join(', ')}`
    );
    return SYMBOLS;
  } catch (error) {
    console.error('Error fetching trading pairs:', error.message);
    // Fallback to the original list if there's an error
    SYMBOLS = [
      'btcusdt',
      'ethusdt',
      'solusdt',
      'arkusdt',
      'rareusdt',
      'crvusdt',
      'straxusdt',
      'uftusdt',
      'prosusdt',
      'funusdt',
      'stptusdt',
      'ltousdt',
      'cvcusdt',
      'qkcusdt',
      'ardrusdt',
      'storjusdt',
      'powrusdt',
      'leverusdt',
      'xrpusdt',
    ];
    console.log(`Falling back to default list of ${SYMBOLS.length} symbols`);
    return SYMBOLS;
  }
}

// Initialize WebSocket connection for each symbol
async function initSymbol(symbol) {
  candleBuffers[symbol] = []; // Init empty array to store candle history

  // Fetch historical data first
  try {
    const response = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${INTERVAL}&limit=${CANDLE_LIMIT}`
    );
    const data = await response.json();

    // Process historical candles
    const historicalCandles = data.map((k) => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));

    candleBuffers[symbol] = historicalCandles;

    // Calculate initial values
    updateMOST(symbol);
  } catch (error) {
    console.error(
      `[${symbol.toUpperCase()}] Error fetching historical data:`,
      error.message
    );
  }

  // Now connect to WebSocket for real-time updates
  const ws = new WebSocket(
    `wss://stream.binance.com:9443/ws/${symbol}@kline_${INTERVAL}`
  );

  ws.on('open', () => {
    console.log(`[${symbol.toUpperCase()}] WebSocket connected.`);
  });

  ws.on('message', (data) => {
    const json = JSON.parse(data);
    const k = json.k; // kline data object from Binance

    // Create formatted candle object with current data
    const candle = {
      time: k.t,
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c), // Current price
      volume: parseFloat(k.v),
    };

    const candles = candleBuffers[symbol];
    const last = candles[candles.length - 1];

    // Always update the last candle with live data
    if (last && last.time === candle.time) {
      candles[candles.length - 1] = candle;
    } else {
      // If it's a new candle, keep the previous one and add new
      if (last) {
        candles.push(candle);
        if (candles.length > CANDLE_LIMIT) candles.shift();
      }
    }

    // Calculate with every price update
    updateMOST(symbol);
  });
}

// Compute and compare MOSTRSI for both configurations
function updateMOST(symbol) {
  const candles = candleBuffers[symbol];

  // Check if we have enough candles to calculate RSI
  if (
    candles.length <
    Math.max(CONFIG_TOP.rsiLength, CONFIG_BOTTOM.rsiLength) + 10
  ) {
    console.log(
      `[${symbol.toUpperCase()}] Waiting for more data... (${
        candles.length
      } candles)`
    );
    return;
  }

  // Get the last candle for alert calculations
  const lastCandle = candles[candles.length - 1];

  const close = candles.map((c) => c.close);
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);

  // Compute RSI and RSI-MA for top and bottom config
  const top = computeMOSTRSI({ close, high, low }, CONFIG_TOP);
  const bottom = computeMOSTRSI({ close, high, low }, CONFIG_BOTTOM);

  // Get the MA values directly from the lastRsiMa property
  const topMA = top.lastRsiMa;
  const bottomMA = bottom.lastRsiMa;

  // Check if we have valid RSI and RSI-MA values
  if (
    top.lastRSI === null ||
    bottom.lastRSI === null ||
    topMA === null ||
    bottomMA === null
  ) {
    console.log(`[${symbol.toUpperCase()}] Waiting for valid RSI/MA values...`);
    return;
  }

  // Calculate differences between indicators
  const rsiDiff = Math.abs(top.lastRSI - bottom.lastRSI);
  const maDiff = topMA && bottomMA ? Math.abs(topMA - bottomMA) : null;

  // Format timestamp for display
  const date = new Date(lastCandle.time);
  const timeStr = date.toLocaleTimeString();
  const dateStr = date.toLocaleDateString();

  // Store alerts in a buffer instead of clearing console
  if (!candleBuffers[symbol].alerts) {
    candleBuffers[symbol].alerts = [];
  }

  // Create status message for this symbol
  const statusMessage = [
    `\n[${symbol.toUpperCase()}] ${dateStr} ${timeStr} - Live Price: ${lastCandle.close.toFixed(
      4
    )}`,
    `RSI (${CONFIG_TOP.rsiLength}/${CONFIG_TOP.maType}): ${top.lastRSI.toFixed(
      2
    )} | MA: ${topMA ? topMA.toFixed(2) : 'N/A'}`,
    `RSI (${CONFIG_BOTTOM.rsiLength}/${
      CONFIG_BOTTOM.maType
    }): ${bottom.lastRSI.toFixed(2)} | MA: ${
      bottomMA ? bottomMA.toFixed(2) : 'N/A'
    }`,
    `Differences: RSI Δ${rsiDiff.toFixed(2)} | MA Δ${
      maDiff ? maDiff.toFixed(2) : 'N/A'
    }`,
  ];

  // Display crossover status
  const topCrossStatus = topMA
    ? top.lastRSI > topMA
      ? 'RSI > MA (Bullish)'
      : 'RSI < MA (Bearish)'
    : 'MA not available';
  const bottomCrossStatus = bottomMA
    ? bottom.lastRSI > bottomMA
      ? 'RSI > MA (Bullish)'
      : 'RSI < MA (Bearish)'
    : 'MA not available';
  statusMessage.push(`Top Status: ${topCrossStatus}`);
  statusMessage.push(`Bottom Status: ${bottomCrossStatus}`);

  // Store the current status
  candleBuffers[symbol].statusMessage = statusMessage;

  // Clear console for updates
  console.clear();


  // Store last processed candle time to avoid duplicate alerts
  if (
    !candleBuffers[symbol].lastProcessedTime ||
    candleBuffers[symbol].lastProcessedTime !== lastCandle.time
  ) {
    // Check for high RSI values (above 69)
    const topRSIHigh = top.lastRSI > 69;

    // Check for low RSI values (below 31)
    const topRSILow = top.lastRSI < 31;

    if (topRSIHigh) {
      const alertHeader = `\n[${symbol.toUpperCase()}] Tarih: ${dateStr} ${timeStr}`;

      let alertMsg = '';
      if (topRSIHigh) {
        alertMsg = `⚠️ ##### YÜKSELEN ##### ⚠️\nÜST MAVİ: (${top.lastRSI.toFixed(
          2
        )}) | KIRMIZI: (${topMA.toFixed(
          2
        )})\nALT MAVİ: (${bottom.lastRSI.toFixed(
          2
        )}) | KIRMIZI: (${bottomMA.toFixed(2)})`;
      }

      // Store the alert
      candleBuffers[symbol].alerts.push(alertMsg);
      candleBuffers[symbol].alerts.push(alertHeader);

      // Send Telegram alert with type
      const telegramMessage = `${alertHeader}\n\n${alertMsg}`;
      sendTelegramAlert(symbol, 'overbought', telegramMessage);
    }

    // New alert for low RSI values (below 31)
    if (topRSILow) {
      const alertHeader = `\n[${symbol.toUpperCase()}] Tarih: ${dateStr} ${timeStr}`;

      let alertMsg = '';
      if (topRSILow) {
        alertMsg = `⚠️ ##### DÜŞEN ##### ⚠️ \nÜST MAVİ: (${top.lastRSI.toFixed(
          2
        )}) | KIRMIZI: (${topMA.toFixed(
          2
        )})\nALT MAVİ: (${bottom.lastRSI.toFixed(
          2
        )}) | KIRMIZI: (${bottomMA.toFixed(2)})`;
      }

      // Store the alert
      candleBuffers[symbol].alerts.push(alertMsg);
      candleBuffers[symbol].alerts.push(alertHeader);

      // Send Telegram alert with type
      const telegramMessage = `${alertHeader}\n\n${alertMsg}`;
      sendTelegramAlert(symbol, 'oversold', telegramMessage);
    }

    // Check if RSI difference is less than or equal to threshold
    if (rsiDiff <= THRESHOLD) {
      const alertHeader = `\n[${symbol.toUpperCase()}] Tarih: ${dateStr} ${timeStr}`;
      const alertRSI = `🔔 ##### MAVİ ##### 🔔\nÜST: ${top.lastRSI.toFixed(
        2
      )} / ALT: ${bottom.lastRSI.toFixed(2)}`;

      // Store the alert
      candleBuffers[symbol].alerts.push(alertHeader);
      candleBuffers[symbol].alerts.push(alertRSI);

      // Send Telegram alert
      const telegramMessage = `${alertHeader}\n\n${alertRSI}`;
      sendTelegramAlert(symbol, 'rsi_convergence', telegramMessage);
    }

    // Check if MA difference is less than or equal to threshold
    if (maDiff !== null && maDiff <= THRESHOLD) {
      // Only add header if not already added by RSI alert
      const alertHeader =
        rsiDiff > THRESHOLD
          ? `\n[${symbol.toUpperCase()}] Tarih: ${dateStr} ${timeStr}`
          : '';

      if (rsiDiff > THRESHOLD) {
        candleBuffers[symbol].alerts.push(alertHeader);
      }

      const alertMA = `🔔 ##### KIRMIZI ##### 🔔\nÜST: ${topMA.toFixed(
        2
      )} / ALT: ${bottomMA.toFixed(2)}`;

      // Store the alert
      candleBuffers[symbol].alerts.push(alertMA);

      // Send Telegram alert
      const telegramMessage = `${alertHeader}\n\n${alertMA}`;
      sendTelegramAlert(symbol, 'ma_convergence', telegramMessage);
    }

    // Check for RSI and MA crossovers within each indicator
    const topRSICrossedAboveMA =
      topMA &&
      candleBuffers[symbol].prevTopMA &&
      top.lastRSI > topMA &&
      candleBuffers[symbol].prevTopRSI < candleBuffers[symbol].prevTopMA;

    const topRSICrossedBelowMA =
      topMA &&
      candleBuffers[symbol].prevTopMA &&
      top.lastRSI < topMA &&
      candleBuffers[symbol].prevTopRSI > candleBuffers[symbol].prevTopMA;

    // Check for RSI crossing above MA (bullish signal)
    if (topRSICrossedAboveMA) {
      // Only add header if not already added by other alerts
      if (rsiDiff > THRESHOLD && maDiff > THRESHOLD && !topRSIHigh) {
        const alertHeader = `\n[${symbol.toUpperCase()}] Tarih: ${dateStr} ${timeStr}`;
        candleBuffers[symbol].alerts.push(alertHeader);
      }

      if (topRSICrossedAboveMA) {
        const crossMsg = `🚀 ##### ÜST GRAFİK YUKARI KESTİ ##### 🚀\nÜST MAVİ: (${top.lastRSI.toFixed(
          2
        )}) | KIRMIZI: (${topMA.toFixed(
          2
        )})\nALT MAVİ: (${bottom.lastRSI.toFixed(
          2
        )}) | KIRMIZI: (${bottomMA.toFixed(2)})`;
        candleBuffers[symbol].alerts.push(crossMsg);

        // Send Telegram alert
        const alertHeader = `\n[${symbol.toUpperCase()}] Tarih: ${dateStr} ${timeStr}`;
        sendTelegramAlert(
          symbol,
          'top_bullish_cross',
          `${alertHeader}\n${crossMsg}`
        );
      }
    }

    // Check for RSI crossing below MA (bearish signal)
    if (topRSICrossedBelowMA) {
      // Only add header if not already added by other alerts
      if (
        rsiDiff > THRESHOLD &&
        maDiff > THRESHOLD &&
        !topRSIHigh &&
        !topRSICrossedAboveMA
      ) {
        const alertHeader = `\n[${symbol.toUpperCase()}] Tarih: ${dateStr} ${timeStr}`;
        candleBuffers[symbol].alerts.push(alertHeader);
      }

      if (topRSICrossedBelowMA) {
        const crossMsg = `📉 ÜST GRAFİK AŞAĞI KESTİ:\nÜST MAVİ: (${top.lastRSI.toFixed(
          2
        )}) | KIRMIZI: (${topMA.toFixed(
          2
        )})\nALT MAVİ: (${bottom.lastRSI.toFixed(
          2
        )}) | KIRMIZI: (${bottomMA.toFixed(2)})`;
        candleBuffers[symbol].alerts.push(crossMsg);

        // Send Telegram alert
        const alertHeader = `\n[${symbol.toUpperCase()}] Tarih: ${dateStr} ${timeStr}`;
        sendTelegramAlert(
          symbol,
          'top_bearish_cross',
          `${alertHeader}\n${crossMsg}`
        );
      }
    }

    // Store current values for next comparison
    candleBuffers[symbol].prevTopRSI = top.lastRSI;
    candleBuffers[symbol].prevTopMA = topMA;
    candleBuffers[symbol].prevBottomRSI = bottom.lastRSI;
    candleBuffers[symbol].prevBottomMA = bottomMA;

    // At the end of the alert processing, limit the number of stored alerts
    // Keep only the most recent 30 lines of alerts
    if (candleBuffers[symbol].alerts.length > 30) {
      candleBuffers[symbol].alerts = candleBuffers[symbol].alerts.slice(-30);
    }

    // Update the last processed time
    candleBuffers[symbol].lastProcessedTime = lastCandle.time;
  }
}

// Start monitoring for each symbol
async function startMonitoring() {
  // First fetch all available symbols
  await fetchAllSymbols();

  // Then initialize each symbol with a delay to avoid rate limits
  for (const symbol of SYMBOLS) {
    await initSymbol(symbol);
    // Increased delay between initializing each symbol to avoid rate limits
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

startMonitoring();
