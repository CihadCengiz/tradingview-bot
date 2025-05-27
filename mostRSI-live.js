// mostRSI-live.js
const { computeMOSTRSI } = require('./mostRSI'); // Import the indicator calculation logic
const { checkDifferenceAlert } = require('./alerts'); // Import alert checking functions
const { createWebSocket } = require('./websocket'); // Import WebSocket creation function
const { candleData, indicatorData } = require('./data'); // Import data storage
const {
  SYMBOLS,
  SYMBOL_INTERVALS, // Import the new symbol-specific intervals object
  CANDLE_LIMIT,
  CONFIG_RSI_7_MA_7,
  CONFIG_RSI_21,
  // Import new retry configurations
  MAX_FETCH_RETRIES,
  FETCH_RETRY_DELAY_MS,
} = require('./config');

// Store WebSocket instances
const websockets = {};

// Function to fetch historical candle data
// Function to fetch historical kline data from Binance API
async function fetchHistoricalData(symbol, interval) {
  // Remove 'BINANCE:' prefix if it exists
  const cleanSymbol = symbol.replace(/^BINANCE:/, '');
  const url = `https://api.binance.com/api/v3/klines?symbol=${cleanSymbol.toUpperCase()}&interval=${interval}&limit=${CANDLE_LIMIT}`;
  let retries = 0;
  while (retries < MAX_FETCH_RETRIES) {
    try {
      // Log the URL being requested
      console.log(`[${symbol.toUpperCase()}:${interval}] Attempting to fetch historical data from: ${url}`);

      const response = await fetch(url);
      if (!response.ok) {
        // Log the status and attempt to log the response body for more details
        const errorBody = await response.text().catch(() => 'N/A');
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
      }
      const data = await response.json();

      // Binance klines are [timestamp, open, high, low, close, volume, close_time, quote_asset_volume, number_of_trades, taker_buy_base_asset_volume, taker_buy_quote_asset_volume, ignore]
      candleData[symbol][interval] = data.map(d => ({
        timestamp: d[0],
        open: parseFloat(d[1]),
        high: parseFloat(d[2]),
        low: parseFloat(d[3]),
        close: parseFloat(d[4]),
        volume: parseFloat(d[5]),
        closeTime: d[6],
      }));
      console.log(`[${symbol.toUpperCase()}:${interval}] Successfully fetched ${candleData[symbol][interval].length} historical candles.`);

      // After fetching historical data, calculate initial indicators and check alerts
      calculateIndicators(symbol, interval);
      // checkDifferenceAlert(symbol, interval); // Check alerts based on historical data

      return; // Success, exit retry loop
    } catch (error) {
      retries++;
      console.error(`[${symbol.toUpperCase()}:${interval}] Error fetching historical data (Attempt ${retries}/${MAX_FETCH_RETRIES}):`, error.message);
      if (retries < MAX_FETCH_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, FETCH_RETRY_DELAY_MS));
      }
    }
  }
  console.error(`[${symbol.toUpperCase()}:${interval}] Failed to fetch historical data after ${MAX_FETCH_RETRIES} retries. Skipping symbol/interval.`);
}

// Function to initialize data structures for a symbol and its intervals
async function initializeSymbol(symbol) {
  candleData[symbol] = {};
  indicatorData[symbol] = {};

  // Get intervals for the current symbol, default to 'default' if not specified
  const intervals = SYMBOL_INTERVALS[symbol] || SYMBOL_INTERVALS['default'];

  // Fetch historical data for all required intervals
  for (const interval of intervals) {
    await fetchHistoricalData(symbol, interval);
  }
}

// Function to start the bot
async function startBot() {
  console.log('Starting TradingView Bot...');
  console.log('Symbols:', SYMBOLS.join(', '));
  console.log('Symbol Intervals:', JSON.stringify(SYMBOL_INTERVALS)); // Log the new structure

  // Initialize data structures and fetch historical data for each symbol
  for (const symbol of SYMBOLS) {
    await initializeSymbol(symbol);

    // Get intervals for the current symbol
    const intervals = SYMBOL_INTERVALS[symbol] || SYMBOL_INTERVALS['default'];

    // Set up WebSocket for each interval for the symbol
    for (const interval of intervals) {
        const wsUrl = `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${interval}`;
        websockets[`${symbol}:${interval}`] = createWebSocket(wsUrl, (data) => handleWebSocketMessage(symbol, interval, data), 'kline', symbol);
    }
  }

  console.log('Bot started. Connecting to WebSockets...');
}

// Start the bot using an immediately invoked async function
(async () => {
  await startBot();
})();

// Function to calculate indicators for a symbol and interval
function calculateIndicators(symbol, interval) {
    const candles = candleData[symbol][interval];

    // Need at least enough candles for the largest RSI length + MA length
    const requiredCandles = Math.max(CONFIG_RSI_7_MA_7.rsiLength + CONFIG_RSI_7_MA_7.maLength, CONFIG_RSI_21.rsiLength + CONFIG_RSI_21.maLength) + 10; // Add buffer
    if (!candles || candles.length < requiredCandles) {
        // console.log(`[${symbol.toUpperCase()}:${interval}] Not enough candles (${candles?.length || 0}/${requiredCandles}) to calculate indicators.`);
        return;
    }

    const close = candles.map((c) => c.close);
    const high = candles.map((c) => c.high);
    const low = candles.map((c) => c.low);

    // Calculate MOST RSI indicators for RSI(7) MA(5)
    const indicators7ma7 = computeMOSTRSI({ close, high, low }, CONFIG_RSI_7_MA_7);

    // Calculate MOST RSI indicators for RSI(21)
    const indicators21 = computeMOSTRSI({ close, high, low }, CONFIG_RSI_21);

    // Store the latest indicator values
    indicatorData[symbol][interval] = {
        // Access the correct properties from the results of computeMOSTRSI
        rsi7ma7: indicators7ma7.lastRsiMa, // Assuming you want the last MA value for RSI(7)
        rsi21: indicators21.lastRSI, // Assuming you want the last RSI value for RSI(21)
    };

    // console.log(`[${symbol.toUpperCase()}:${interval}] Indicators calculated. RSI(7) MA(5): ${indicatorData[symbol][interval].rsi7ma7}, RSI(21): ${indicatorData[symbol][interval].rsi21}`);
}

// Function to handle WebSocket messages
function handleWebSocketMessage(symbol, interval, data) {
  // Check if the message is a kline event and contains kline data
  if (data && data.e === 'kline' && data.k) {
    const kline = data.k;

    // Only process if the candle is closed
    if (kline.x) { // 'x' is the boolean indicating if the candle is closed
      const newCandle = {
        timestamp: kline.t,
        open: parseFloat(kline.o),
        high: parseFloat(kline.h),
        low: parseFloat(kline.l),
        close: parseFloat(kline.c),
        volume: parseFloat(kline.v),
        closeTime: kline.T,
      };

      // Add the new closed candle and remove the oldest if we exceed the limit
      if (!candleData[symbol][interval]) {
          candleData[symbol][interval] = [];
      }
      candleData[symbol][interval].push(newCandle);
      if (candleData[symbol][interval].length > CANDLE_LIMIT) {
        candleData[symbol][interval].shift(); // Remove the oldest candle
      }

      // Recalculate indicators with the updated candle data
      calculateIndicators(symbol, interval);

      // Check for alerts based on the closed candle's indicators
      checkDifferenceAlert(symbol, interval);
    }
  } else {
    // Optionally log other message types for debugging
    // console.log(`[${symbol.toUpperCase()}:${interval}] Received non-kline message:`, data);
  }
}