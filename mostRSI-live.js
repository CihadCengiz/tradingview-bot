// multi-symbol MOSTRSI live monitor
const WebSocket = require('ws');
const { computeMOSTRSI } = require('./mostRSI');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

// Telegram bot setup for different alert types
const TELEGRAM_BOTS = {
  YUKSELEN: {
    token: process.env.YUKSELEN_KEY, // Replace with your bot token for YUKSELEN
    chatId: process.env.CHAT_ID,
    ready: false,
    instance: null,
  },
  DUSEN: {
    token: process.env.DUSEN_KEY, // Replace with your bot token for DUSEN
    chatId: process.env.CHAT_ID,
    ready: false,
    instance: null,
  },
  FARK: {
    token: process.env.FARK_KEY, // Replace with your bot token for FARK
    chatId: process.env.CHAT_ID,
    ready: false,
    instance: null,
  },
  DUSEN_KESISIM: {
    token: process.env.DUSEN_KESISIM_KEY, // Replace with your bot token for DUSEN_KESISIM
    chatId: process.env.CHAT_ID,
    ready: false,
    instance: null,
  },
  YUKSELEN_KESISIM: {
    token: process.env.YUKSELEN_KESISIM_KEY, // Replace with your bot token for YUKSELEN_KESISIM
    chatId: process.env.CHAT_ID,
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
let SYMBOLS = [
  'btcusdt',
  // 'ethusdt',
  // 'solusdt',
  // 'arkusdt',
  // 'rareusdt',
  // 'crvusdt',
  // 'straxusdt',
  // 'uftusdt',
  // 'prosusdt',
  // 'funusdt',
  // 'stptusdt',
  // 'ltousdt',
  // 'cvcusdt',
  // 'qkcusdt',
  // 'ardrusdt',
  // 'storjusdt',
  // 'powrusdt',
  // 'leverusdt',
  // 'xrpusdt',
];
const INTERVAL = '4h'; // Binance interval for indicator calculation
const LIVE_INTERVAL = '1m'; // Interval for real-time price updates
const HOUR_INTERVAL = '1h'; // 1-hour interval for YUKSELEN and DUSEN alerts
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

// Store state for tracking RSI movements
const rsiStateTracking = {};

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
  
  // Initialize live price tracking
  if (!candleBuffers[symbol].livePrice) {
    candleBuffers[symbol].livePrice = null;
  }
  
  // Initialize 1h candle buffer
  candleBuffers[symbol].hourCandles = [];
  
  // Initialize state tracking for this symbol
  rsiStateTracking[symbol] = {
    yukselen: {
      seenAbove69: false,
      seenBelow50: false,
      alertSent: false
    },
    dusen: {
      seenBelow31: false,
      seenAbove50: false,
      alertSent: false
    }
  };

  // Fetch historical data first for indicator calculation (4h)
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
      `[${symbol.toUpperCase()}] Error fetching historical data (4h):`,
      error.message
    );
  }
  
  // Fetch 1h historical data for YUKSELEN and DUSEN alerts
  try {
    const response = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${HOUR_INTERVAL}&limit=${CANDLE_LIMIT}`
    );
    const data = await response.json();

    // Process historical candles
    const historicalHourCandles = data.map((k) => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));

    candleBuffers[symbol].hourCandles = historicalHourCandles;

    // Calculate initial 1h indicators
    updateHourIndicators(symbol);
  } catch (error) {
    console.error(
      `[${symbol.toUpperCase()}] Error fetching historical data (1h):`,
      error.message
    );
  }

  // Connect to WebSocket for 4h candle updates
  const ws4h = new WebSocket(
    `wss://stream.binance.com:9443/ws/${symbol}@kline_${INTERVAL}`
  );

  ws4h.on('message', (data) => {
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

    // Update live price
    candleBuffers[symbol].livePrice = parseFloat(k.c);

    // Calculate with every price update
    updateMOST(symbol);
    
    // Check for FARK alerts based on 4h data
    checkFarkAlerts(symbol);
  });
  
  // Connect to WebSocket for 1h candle updates
  const ws1h = new WebSocket(
    `wss://stream.binance.com:9443/ws/${symbol}@kline_${HOUR_INTERVAL}`
  );

  ws1h.on('message', (data) => {
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

    const hourCandles = candleBuffers[symbol].hourCandles;
    const last = hourCandles[hourCandles.length - 1];

    // Always update the last candle with live data
    if (last && last.time === candle.time) {
      hourCandles[hourCandles.length - 1] = candle;
    } else {
      // If it's a new candle, keep the previous one and add new
      if (last) {
        hourCandles.push(candle);
        if (hourCandles.length > CANDLE_LIMIT) hourCandles.shift();
      }
    }

    // Update 1h indicators
    updateHourIndicators(symbol);
    
    // Check for YUKSELEN and DUSEN alerts based on 1h data
    checkYukselenDusenAlerts(symbol);
  });

  // Connect to WebSocket for real-time price updates
  const wsLive = new WebSocket(
    `wss://stream.binance.com:9443/ws/${symbol}@kline_${LIVE_INTERVAL}`
  );


  wsLive.on('message', (data) => {
    const json = JSON.parse(data);
    const k = json.k; // kline data object from Binance

    // Update live price
    candleBuffers[symbol].livePrice = parseFloat(k.c);

    // Display updated status
    displayStatus();
  });
}

// New function to update 1h indicators
function updateHourIndicators(symbol) {
  const hourCandles = candleBuffers[symbol].hourCandles;

  // Check if we have enough candles to calculate RSI
  if (
    hourCandles.length <
    Math.max(CONFIG_TOP.rsiLength, CONFIG_BOTTOM.rsiLength) + 10
  ) {
    return;
  }

  const close = hourCandles.map((c) => c.close);
  const high = hourCandles.map((c) => c.high);
  const low = hourCandles.map((c) => c.low);

  // Compute RSI and RSI-MA for top and bottom config
  const top = computeMOSTRSI({ close, high, low }, CONFIG_TOP);
  const bottom = computeMOSTRSI({ close, high, low }, CONFIG_BOTTOM);

  // Get the MA values directly from the lastRsiMa property
  const topMA = top.lastRsiMa;
  const bottomMA = bottom.lastRsiMa;

  // Store the 1h indicators
  candleBuffers[symbol].hourTopRSI = top.lastRSI;
  candleBuffers[symbol].hourBottomRSI = bottom.lastRSI;
  candleBuffers[symbol].hourTopMA = topMA;
  candleBuffers[symbol].hourBottomMA = bottomMA;
}

// Function to check FARK alerts (based on 4h data)
function checkFarkAlerts(symbol) {
  // Skip if we don't have indicator values yet
  if (!candleBuffers[symbol] || 
      !candleBuffers[symbol].topRSI || 
      !candleBuffers[symbol].bottomRSI) {
    return;
  }

  const livePrice = candleBuffers[symbol].livePrice;
  const top = {
    lastRSI: candleBuffers[symbol].topRSI
  };
  const bottom = {
    lastRSI: candleBuffers[symbol].bottomRSI
  };
  const topMA = candleBuffers[symbol].topMA;
  const bottomMA = candleBuffers[symbol].bottomMA;
  const lastCandle = candleBuffers[symbol].lastCandle;
  
  // Skip if we don't have all required values
  if (!livePrice || !top.lastRSI || !bottom.lastRSI || !topMA || !bottomMA || !lastCandle) {
    return;
  }

  // Calculate differences between indicators
  const rsiDiff = Math.abs(top.lastRSI - bottom.lastRSI);
  const maDiff = topMA && bottomMA ? Math.abs(topMA - bottomMA) : null;

  // Format timestamp for display
  const date = new Date();
  const timeStr = date.toLocaleTimeString();
  const dateStr = date.toLocaleDateString();

  // Store alerts in a buffer instead of clearing console
  if (!candleBuffers[symbol].alerts) {
    candleBuffers[symbol].alerts = [];
  }

  // Check for alerts only if we haven't processed this price recently
  const priceKey = Math.round(livePrice * 100) / 100; // Round to 2 decimals
  if (
    !candleBuffers[symbol].lastProcessedPrice ||
    candleBuffers[symbol].lastProcessedPrice !== priceKey
  ) {
    // Check if RSI difference is less than or equal to threshold
    if (rsiDiff <= THRESHOLD) {
      const alertHeader = `\n[${symbol.toUpperCase()}] Tarih: ${dateStr} ${timeStr} - Fiyat: ${livePrice.toFixed(4)}`;
      const alertRSI = `🔔 ##### MAVİ ##### 🔔\nÜST: ${top.lastRSI.toFixed(2)} / ALT: ${bottom.lastRSI.toFixed(2)}`;
      
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
      const alertHeader = rsiDiff > THRESHOLD ? 
        `\n[${symbol.toUpperCase()}] Tarih: ${dateStr} ${timeStr} - Fiyat: ${livePrice.toFixed(4)}` : '';
      
      if (rsiDiff > THRESHOLD) {
        candleBuffers[symbol].alerts.push(alertHeader);
      }
      
      const alertMA = `🔔 ##### KIRMIZI ##### 🔔\nÜST: ${topMA.toFixed(2)} / ALT: ${bottomMA.toFixed(2)}`;
      
      // Store the alert
      candleBuffers[symbol].alerts.push(alertMA);
      
      // Send Telegram alert
      const telegramMessage = `${alertHeader}\n\n${alertMA}`;
      sendTelegramAlert(symbol, 'ma_convergence', telegramMessage);
    }
    
    // Update the last processed price
    candleBuffers[symbol].lastProcessedPrice = priceKey;
  }
}

// Function to check YUKSELEN and DUSEN alerts (based on 1h data)
function checkYukselenDusenAlerts(symbol) {
  // Skip if we don't have 1h indicator values yet
  if (!candleBuffers[symbol] || 
      !candleBuffers[symbol].hourTopRSI || 
      !candleBuffers[symbol].hourBottomRSI) {
    return;
  }

  const livePrice = candleBuffers[symbol].livePrice;
  const top = {
    lastRSI: candleBuffers[symbol].hourTopRSI
  };
  const bottom = {
    lastRSI: candleBuffers[symbol].hourBottomRSI
  };
  const topMA = candleBuffers[symbol].hourTopMA;
  const bottomMA = candleBuffers[symbol].hourBottomMA;
  
  // Skip if we don't have all required values
  if (!livePrice || !top.lastRSI || !bottom.lastRSI || !topMA || !bottomMA) {
    return;
  }

  // Format timestamp for display
  const date = new Date();
  const timeStr = date.toLocaleTimeString();
  const dateStr = date.toLocaleDateString();

  // Store alerts in a buffer instead of clearing console
  if (!candleBuffers[symbol].alerts) {
    candleBuffers[symbol].alerts = [];
  }

  // Get state tracking for this symbol
  const state = rsiStateTracking[symbol];
  
  // YUKSELEN state tracking logic (above 69 → below 50 → above 50)
  if (top.lastRSI > 69) {
    state.yukselen.seenAbove69 = true;
  } 
  else if (state.yukselen.seenAbove69 && top.lastRSI < 50) {
    state.yukselen.seenBelow50 = true;
  }
  else if (state.yukselen.seenAbove69 && state.yukselen.seenBelow50 && top.lastRSI > 50 && !state.yukselen.alertSent) {
    // All conditions met, send YUKSELEN alert
    const alertHeader = `\n[${symbol.toUpperCase()}] Tarih: ${dateStr} ${timeStr} - Fiyat: ${livePrice.toFixed(4)}`;
    const alertMsg = `⚠️ ##### YÜKSELEN ##### ⚠️\nÜST MAVİ: (${top.lastRSI.toFixed(2)}) | KIRMIZI: (${topMA.toFixed(2)})\nALT MAVİ: (${bottom.lastRSI.toFixed(2)}) | KIRMIZI: (${bottomMA.toFixed(2)})`;
    
    // Store the alert
    candleBuffers[symbol].alerts.push(alertHeader);
    candleBuffers[symbol].alerts.push(alertMsg);
    
    // Send Telegram alert with type
    const telegramMessage = `${alertHeader}\n\n${alertMsg}`;
    sendTelegramAlert(symbol, 'overbought', telegramMessage);
    
    // Mark alert as sent
    state.yukselen.alertSent = true;
    
    // Log the state transition
  }
  
  // Reset YUKSELEN state if RSI drops below 50 after alert
  if (state.yukselen.alertSent && top.lastRSI < 50) {
    state.yukselen.seenAbove69 = false;
    state.yukselen.seenBelow50 = false;
    state.yukselen.alertSent = false;
  }
  
  // DUSEN state tracking logic (below 31 → above 50 → below 50)
  if (top.lastRSI < 31) {
    state.dusen.seenBelow31 = true;
  } 
  else if (state.dusen.seenBelow31 && top.lastRSI > 50) {
    state.dusen.seenAbove50 = true;
  }
  else if (state.dusen.seenBelow31 && state.dusen.seenAbove50 && top.lastRSI < 50 && !state.dusen.alertSent) {
    // All conditions met, send DUSEN alert
    const alertHeader = `\n[${symbol.toUpperCase()}] Tarih: ${dateStr} ${timeStr} - Fiyat: ${livePrice.toFixed(4)}`;
    const alertMsg = `⚠️ ##### DÜŞEN ##### ⚠️ \nÜST MAVİ: (${top.lastRSI.toFixed(2)}) | KIRMIZI: (${topMA.toFixed(2)})\nALT MAVİ: (${bottom.lastRSI.toFixed(2)}) | KIRMIZI: (${bottomMA.toFixed(2)})`;
    
    // Store the alert
    candleBuffers[symbol].alerts.push(alertHeader);
    candleBuffers[symbol].alerts.push(alertMsg);
    
    // Send Telegram alert with type
    const telegramMessage = `${alertHeader}\n\n${alertMsg}`;
    sendTelegramAlert(symbol, 'oversold', telegramMessage);
    
    // Mark alert as sent
    state.dusen.alertSent = true;
    
    // Log the state transition
  }
  
  // Reset DUSEN state if RSI goes above 50 after alert
  if (state.dusen.alertSent && top.lastRSI > 50) {
    state.dusen.seenBelow31 = false;
    state.dusen.seenAbove50 = false;
    state.dusen.alertSent = false;
  }
}

// Function to fetch symbols from TradingView watchlist
async function fetchTradingViewSymbols() {
  try {
    console.log('Using hardcoded watchlist symbols...');
    
    // Hardcoded watchlist from TradingView
    const watchlistString = "BINANCE:RVNUSDT,BINANCE:ZILUSDT,BINANCE:GALAUSDT,BINANCE:ACHUSDT,BINANCE:UTKUSDT,BINANCE:ACAUSDT,BINANCE:OGNUSDT,BINANCE:AUDIOUSDT,BINANCE:OXTUSDT,BINANCE:REQUSDT,BINANCE:TKOUSDT,BINANCE:DOGEUSDT,BINANCE:IOTAUSDT,BINANCE:MINAUSDT,BINANCE:XLMUSDT,BINANCE:MANAUSDT,BINANCE:DIAUSDT,BINANCE:SUSDT,BINANCE:ADAUSDT,BINANCE:XRPUSDT,###GENEL,BINANCE:SCUSDT,BINANCE:PEOPLEUSDT,BINANCE:REZUSDT,BINANCE:FIOUSDT,BINANCE:TUSDT,BINANCE:SUNUSDT,BINANCE:ANKRUSDT,BINANCE:IOTXUSDT,BINANCE:REIUSDT,BINANCE:SKLUSDT,BINANCE:ARPAUSDT,BINANCE:IDEXUSDT,BINANCE:WAXPUSDT,BINANCE:VETUSDT,BINANCE:ROSEUSDT,BINANCE:ASTRUSDT,BINANCE:ALPHAUSDT,BINANCE:MDTUSDT,BINANCE:TRUUSDT,BINANCE:SYSUSDT,BINANCE:MBOXUSDT,BINANCE:GMTUSDT,BINANCE:MAVUSDT,BINANCE:ZKUSDT,BINANCE:HFTUSDT,BINANCE:ATAUSDT,BINANCE:CHESSUSDT,BINANCE:C98USDT,BINANCE:LOKAUSDT,BINANCE:CTSIUSDT,BINANCE:DFUSDT,BINANCE:WOOUSDT,BINANCE:RAREUSDT,BINANCE:ENJUSDT,BINANCE:CFXUSDT,BINANCE:COTIUSDT,BINANCE:DUSKUSDT,BINANCE:GRTUSDT,BINANCE:ADXUSDT,BINANCE:CHRUSDT,BINANCE:LRCUSDT,BINANCE:BICOUSDT,BINANCE:BLURUSDT,BINANCE:PHAUSDT,BINANCE:WANUSDT,BINANCE:EDUUSDT,BINANCE:CVCUSDT,BINANCE:BAKEUSDT,BINANCE:NTRNUSDT,BINANCE:KMDUSDT,BINANCE:BATUSDT,BINANCE:FISUSDT,BINANCE:ONTUSDT,BINANCE:POLYXUSDT,BINANCE:YGGUSDT,BINANCE:JOEUSDT,BINANCE:HBARUSDT,BINANCE:1INCHUSDT,BINANCE:SEIUSDT,BINANCE:POWRUSDT,BINANCE:SCRTUSDT,BINANCE:ALGOUSDT,BINANCE:ONGUSDT,BINANCE:OSMOUSDT,BINANCE:SXPUSDT,BINANCE:FLUXUSDT,BINANCE:HIVEUSDT,BINANCE:GTCUSDT,BINANCE:ZRXUSDT,BINANCE:SANDUSDT,BINANCE:PUNDIXUSDT,BINANCE:STORJUSDT,BINANCE:ARBUSDT,BINANCE:CELOUSDT,BINANCE:CTKUSDT,BINANCE:KNCUSDT,BINANCE:FLOWUSDT,BINANCE:BNTUSDT,BINANCE:ALICEUSDT,BINANCE:IMXUSDT,BINANCE:APEUSDT,BINANCE:KAVAUSDT,BINANCE:ARKMUSDT,BINANCE:FETUSDT,BINANCE:XTZUSDT,BINANCE:AVAUSDT,BINANCE:SUPERUSDT,BINANCE:DYDXUSDT,BINANCE:STXUSDT,BINANCE:CRVUSDT,OKX:PIUSDT,BINANCE:EOSUSDT,BINANCE:SNXUSDT,BINANCE:THETAUSDT,BINANCE:OPUSDT,BINANCE:BANDUSDT,BINANCE:LDOUSDT,BINANCE:WLDUSDT,BINANCE:API3USDT,BINANCE:BELUSDT,BINANCE:TWTUSDT,BINANCE:MTLUSDT,BINANCE:PYRUSDT,BINANCE:UMAUSDT,BINANCE:NEXOUSDT,BINANCE:RUNEUSDT,BINANCE:NEARUSDT,BINANCE:SUIUSDT,BINANCE:RAYUSDT,BINANCE:ZROUSDT,BINANCE:FILUSDT,###İZLEME LİSTESİNDE,BINANCE:FLMUSDT,BINANCE:VOXELUSDT";
    
    // Split the string by commas
    const rawSymbols = watchlistString.split(',');
    
    // Filter out non-symbol entries (like section headers that start with ###)
    const validSymbols = rawSymbols
      .filter(item => !item.startsWith('###'))
      .map(symbol => {
        // Remove exchange prefix and convert to lowercase
        return symbol.replace(/^(BINANCE:|OKX:)/, '').toLowerCase();
      })
      .filter(symbol => symbol.endsWith('usdt')); // Ensure we only have USDT pairs
    
    console.log(`Successfully processed ${validSymbols.length} symbols from hardcoded watchlist`);
    
    // Update the SYMBOLS array
    SYMBOLS = validSymbols;
    return SYMBOLS;
  } catch (error) {
    console.error('Error processing hardcoded symbols, using defaults:', error.message);
    console.log('Falling back to default symbols');
    return SYMBOLS;
  }
}

// Start monitoring for each symbol
async function startMonitoring() {
  // First fetch symbols from hardcoded watchlist
  try {
    await fetchTradingViewSymbols();
  } catch (error) {
    console.error('Error fetching symbols from watchlist, using defaults:', error.message);
  }
  
  // If watchlist fetch failed or returned empty, fetch from Binance
  if (SYMBOLS.length <= 1) {
    console.log('No symbols from watchlist, fetching from Binance instead');
    await fetchAllSymbols();
  }

  // Then initialize each symbol with a delay to avoid rate limits
  for (const symbol of SYMBOLS) {
    await initSymbol(symbol);
    // Increased delay between initializing each symbol to avoid rate limits
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

startMonitoring();

// Function to update MOST indicators for 4h data
function updateMOST(symbol) {
  const candles = candleBuffers[symbol];

  // Check if we have enough candles to calculate RSI
  if (
    candles.length <
    Math.max(CONFIG_TOP.rsiLength, CONFIG_BOTTOM.rsiLength) + 10
  ) {
    return;
  }

  const close = candles.map((c) => c.close);
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);

  // Compute RSI and RSI-MA for top and bottom config
  const top = computeMOSTRSI({ close, high, low }, CONFIG_TOP);
  const bottom = computeMOSTRSI({ close, high, low }, CONFIG_BOTTOM);

  // Get the MA values directly from the lastRsiMa property
  const topMA = top.lastRsiMa;
  const bottomMA = bottom.lastRsiMa;
  
  // Get the last candle for price information
  const lastCandle = candles[candles.length - 1];

  // Format timestamp for display
  const date = new Date(lastCandle.time);
  const timeStr = date.toLocaleTimeString();
  const dateStr = date.toLocaleDateString();

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
  ];

  // Store the current status
  candleBuffers[symbol].statusMessage = statusMessage;
  candleBuffers[symbol].topRSI = top.lastRSI;
  candleBuffers[symbol].bottomRSI = bottom.lastRSI;
  candleBuffers[symbol].topMA = topMA;
  candleBuffers[symbol].bottomMA = bottomMA;
  candleBuffers[symbol].lastCandle = lastCandle;
}
