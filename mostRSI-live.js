// mostRSI-live.js
const { computeMOSTRSI } = require('./mostRSI'); // Import the indicator calculation logic
const {
  SYMBOLS,
  ALERT_INTERVALS,
  CANDLE_LIMIT,
  CONFIG_RSI_7_MA_7,
  CONFIG_RSI_21,
  // Import new retry configurations
  MAX_FETCH_RETRIES,
  FETCH_RETRY_DELAY_MS,
} = require('./config');
const { candleData, indicatorData, sentAlerts } = require('./data');
const { createWebSocket } = require('./websocket');
const { checkDifferenceAlert } = require('./alerts');

// Initialize data structures for each symbol and interval
function initializeSymbol(symbol) {
  candleData[symbol] = {};
  indicatorData[symbol] = {};
  sentAlerts[symbol] = {}; // Initialize sentAlerts for the symbol

  // Fetch historical data for all required intervals
  for (const interval of ALERT_INTERVALS) {
    fetchHistoricalData(symbol, interval);
  }
}

// Function to fetch historical data for a specific symbol and interval with retries
async function fetchHistoricalData(symbol, interval) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${CANDLE_LIMIT}`;
  let retries = 0;

  while (retries < MAX_FETCH_RETRIES) {
    try {
      const response = await fetch(url);
      const data = await response.json();

      // Check if data is an array (successful response) or an error object
      if (!Array.isArray(data)) {
        console.error(
          `[${symbol.toUpperCase()}] Attempt ${retries + 1}/${MAX_FETCH_RETRIES}: Error fetching historical data (${interval}): ${JSON.stringify(data)}`
        );
        retries++;
        if (retries < MAX_FETCH_RETRIES) {
          console.log(`[${symbol.toUpperCase()}] Retrying in ${FETCH_RETRY_DELAY_MS}ms...`);
          await new Promise(resolve => setTimeout(resolve, FETCH_RETRY_DELAY_MS));
        } else {
          console.error(`[${symbol.toUpperCase()}] Max retries reached for historical data (${interval}). Skipping.`);
          return; // Give up after max retries
        }
      } else {
        // Process historical candles (successful fetch)
        const historicalCandles = data.map((k) => ({
          time: k[0],
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
          isFinal: true, // Historical data is always final
        }));

        candleData[symbol][interval] = historicalCandles;
        console.log(`[${symbol.toUpperCase()}:${interval}] Fetched ${historicalCandles.length} historical candles.`);

        // Calculate initial indicators after fetching historical data
        calculateIndicators(symbol, interval);

        // Connect to WebSocket stream after historical data is fetched
        const wsUrl = `wss://stream.binance.com:9443/ws/${symbol}@kline_${interval}`;
        const wsHandler = (data) => {
          const json = JSON.parse(data);
          const k = json.k; // kline data object from Binance

          // Create formatted candle object
          const candle = {
            time: k.t,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c), // Current price
            volume: parseFloat(k.v),
            isFinal: k.x, // k.x indicates if the candle is closed (final)
          };

          const candles = candleData[symbol][interval];
          const last = candles[candles.length - 1];

          // Update the last candle if it's the same time, otherwise add a new one
          if (last && last.time === candle.time) {
            candles[candles.length - 1] = candle;
          } else {
            // If it's a new candle, add it and remove the oldest if over limit
            if (last) { // Only push if there's at least one historical candle
               candles.push(candle);
               if (candles.length > CANDLE_LIMIT) candles.shift();
            } else {
                // This case should ideally not happen if historical data fetch was successful
                // But as a fallback, add the first candle received
                candles.push(candle);
            }
          }

          // Calculate indicators after updating candles
          calculateIndicators(symbol, interval);

          // Check alerts based on the updated indicators for this interval
          checkDifferenceAlert(symbol, interval);
        };

        // Create WebSocket connection with reconnection logic
        createWebSocket(wsUrl, wsHandler, `${interval} kline`, symbol); // Pass symbol to createWebSocket
        return; // Exit loop on successful fetch
      }
    } catch (error) {
      console.error(
        `[${symbol.toUpperCase()}] Attempt ${retries + 1}/${MAX_FETCH_RETRIES}: Error fetching historical data (${interval}):`,
        error.message
      );
      retries++;
      if (retries < MAX_FETCH_RETRIES) {
        console.log(`[${symbol.toUpperCase()}] Retrying in ${FETCH_RETRY_DELAY_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, FETCH_RETRY_DELAY_MS));
      } else {
        console.error(`[${symbol.toUpperCase()}] Max retries reached for historical data (${interval}). Skipping.`);
        return; // Give up after max retries
      }
    }
  }
}


// Function to calculate indicators for a specific symbol and interval
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

    // Compute RSI and RSI-MA for the two configurations
    const rsi7ma7Result = computeMOSTRSI({ close, high, low }, CONFIG_RSI_7_MA_7);
    const rsi21Result = computeMOSTRSI({ close, high, low }, CONFIG_RSI_21);

    // Store the latest indicator values, including previous values for crossover checks
    const currentIndicatorData = {
        rsi7ma7: rsi7ma7Result.lastRsiMa, // RSI-based MA (7)
        rsi21: rsi21Result.lastRSI,       // RSI (21)
        rsi21ma21: rsi21Result.lastRsiMa, // RSI-based MA (21) - needed for crossovers
        previousRsi21: indicatorData[symbol][interval]?.rsi21, // Store current RSI(21) as previous for the next update
        previousRsi21ma21: indicatorData[symbol][interval]?.rsi21ma21, // Store current MA(21) as previous for the next update
    };

    indicatorData[symbol][interval] = currentIndicatorData;
}


// Main execution loop
async function startBot() {
  console.log('Starting TradingView Bot...');
  console.log('Symbols:', SYMBOLS.join(', '));
  console.log('Alert Intervals:', ALERT_INTERVALS.join(', '));

  // Initialize and start processing for each symbol
  for (const symbol of SYMBOLS) {
    initializeSymbol(symbol);
  }
}

// Start the bot
startBot();