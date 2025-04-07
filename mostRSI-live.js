// multi-symbol MOSTRSI live monitor
const WebSocket = require('ws');
const { computeMOSTRSI } = require('./mostRSI');

// List of symbols to monitor
const SYMBOLS = [
//   'btcusdt',
//   'ethusdt',
//   'solusdt',
//   'arkusdt',
//   'rareusdt',
//   'crvusdt',
  'straxusdt',
//   'uftusdt',
//   'prosusdt',
//   'funusdt',
//   'stptusdt',
//   'ltousdt',
//   'cvcusdt',
//   'qkcusdt',
//   'ardrusdt',
//   'storjusdt',
//   'powrusdt',
//   'leverusdt',
];
const INTERVAL = '1m'; // Binance interval (1h candles)
const CANDLE_LIMIT = 500; // Max candles to keep in memory per symbol
const THRESHOLD = 1.5; // Alert threshold for difference in RSI or MOST

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

// Initialize WebSocket connection for each symbol
async function initSymbol(symbol) {
  candleBuffers[symbol] = []; // Init empty array to store candle history

  // Fetch historical data first
  try {
    console.log(`[${symbol.toUpperCase()}] Fetching historical data...`);
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
    console.log(
      `[${symbol.toUpperCase()}] Loaded ${
        historicalCandles.length
      } historical candles`
    );

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

    // Create formatted candle object
    const candle = {
      time: k.t,
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
    };

    const candles = candleBuffers[symbol];
    const last = candles[candles.length - 1];

    // Replace last candle if same timestamp, otherwise push new
    if (last && last.time === candle.time) {
      candles[candles.length - 1] = candle;
    } else {
      candles.push(candle);
      if (candles.length > CANDLE_LIMIT) candles.shift(); // Keep memory bounded
    }

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

  // Compute RSI and MOST for top and bottom config using all historical data
  const top = computeMOSTRSI({ close, high, low }, CONFIG_TOP);
  const bottom = computeMOSTRSI({ close, high, low }, CONFIG_BOTTOM);

  // Check if we have valid RSI and MOST values before proceeding
  if (
    top.lastRSI === null ||
    bottom.lastRSI === null ||
    top.lastMOST === null ||
    bottom.lastMOST === null
  ) {
    console.log(
      `[${symbol.toUpperCase()}] Waiting for valid RSI/MOST values...`
    );
    return;
  }

  // Calculate differences between the two indicators
  const rsiDiff = Math.abs(top.lastRSI - bottom.lastRSI);
  const mostDiff = Math.abs(top.lastMOST - bottom.lastMOST);

  // Format timestamp for display
  const date = new Date(lastCandle.time);
  const timeStr = date.toLocaleTimeString();
  const dateStr = date.toLocaleDateString();

  // Store last processed candle time to avoid duplicate alerts
  if (
    !candleBuffers[symbol].lastProcessedTime ||
    candleBuffers[symbol].lastProcessedTime !== lastCandle.time
  ) {
    // Check for high RSI values (above 65)
    const topRSIHigh = top.lastRSI > 65;
    const bottomRSIHigh = bottom.lastRSI > 65;
    
    if (topRSIHigh || bottomRSIHigh) {
      console.log(
        `\n[${symbol.toUpperCase()}] ${dateStr} ${timeStr} - Price: ${lastCandle.close.toFixed(4)}`
      );
      console.log(
        `RSI: ${top.lastRSI.toFixed(2)} / ${bottom.lastRSI.toFixed(2)}`
      );
      
      if (topRSIHigh && bottomRSIHigh) {
        console.log(`⚠️ OVERBOUGHT: Both RSIs above 65!`);
      } else if (topRSIHigh) {
        console.log(`⚠️ OVERBOUGHT: Top RSI(${top.lastRSI.toFixed(2)}) above 65!`);
      } else {
        console.log(`⚠️ OVERBOUGHT: Bottom RSI(${bottom.lastRSI.toFixed(2)}) above 65!`);
      }
    }
    
    // Check if RSI difference is less than or equal to threshold
    if (rsiDiff <= THRESHOLD) {
      // Print current values and differences with timestamp and price
      console.log(
        `\n[${symbol.toUpperCase()}] ${dateStr} ${timeStr} - Price: ${lastCandle.close.toFixed(4)}`
      );
      console.log(
        `RSI: ${top.lastRSI.toFixed(2)} / ${bottom.lastRSI.toFixed(2)} Δ${rsiDiff.toFixed(2)}`
      );
      
      // Determine if both RSIs are above or below 50
      const bothAbove50 = top.lastRSI > 50 && bottom.lastRSI > 50;
      const bothBelow50 = top.lastRSI < 50 && bottom.lastRSI < 50;
      
      console.log(`🔔 RSI CONVERGENCE: ${rsiDiff.toFixed(2)}`);
      if (bothAbove50) console.log(`📈 Both RSIs above 50 (Bullish zone)`);
      else if (bothBelow50) console.log(`📉 Both RSIs below 50 (Bearish zone)`);
      else console.log(`⚖️ RSIs on opposite sides of 50 (Mixed signals)`);
    }

    // Check if MOST difference is less than or equal to threshold
    if (mostDiff <= THRESHOLD) {
      // Only print header if not already printed by RSI alert
      if (rsiDiff > THRESHOLD) {
        console.log(
          `\n[${symbol.toUpperCase()}] ${dateStr} ${timeStr} - Price: ${lastCandle.close.toFixed(4)}`
        );
      }
      
      console.log(
        `MOST: ${top.lastMOST.toFixed(2)} / ${bottom.lastMOST.toFixed(2)} Δ${mostDiff.toFixed(2)}`
      );
      
      // Determine if both MOSTs are above or below 50
      const bothAbove50 = top.lastMOST > 50 && bottom.lastMOST > 50;
      const bothBelow50 = top.lastMOST < 50 && bottom.lastMOST < 50;
      
      console.log(`🔔 MOST CONVERGENCE: ${mostDiff.toFixed(2)}`);
      if (bothAbove50) console.log(`📈 Both MOSTs above 50 (Bullish zone)`);
      else if (bothBelow50) console.log(`📉 Both MOSTs below 50 (Bearish zone)`);
      else console.log(`⚖️ MOSTs on opposite sides of 50 (Mixed signals)`);
    }
    
    // Check for RSI and MOST crossovers within each indicator
    const topRSICrossedAboveMOST = top.lastRSI > top.lastMOST && candleBuffers[symbol].prevTopRSI < candleBuffers[symbol].prevTopMOST;
    const topRSICrossedBelowMOST = top.lastRSI < top.lastMOST && candleBuffers[symbol].prevTopRSI > candleBuffers[symbol].prevTopMOST;
    const bottomRSICrossedAboveMOST = bottom.lastRSI > bottom.lastMOST && candleBuffers[symbol].prevBottomRSI < candleBuffers[symbol].prevBottomMOST;
    const bottomRSICrossedBelowMOST = bottom.lastRSI < bottom.lastMOST && candleBuffers[symbol].prevBottomRSI > candleBuffers[symbol].prevBottomMOST;
    
    // Check for RSI crossing above MOST (bullish signal)
    if (topRSICrossedAboveMOST || bottomRSICrossedAboveMOST) {
      // Only print header if not already printed by other alerts
      if (rsiDiff > THRESHOLD && mostDiff > THRESHOLD && !topRSIHigh && !bottomRSIHigh) {
        console.log(
          `\n[${symbol.toUpperCase()}] ${dateStr} ${timeStr} - Price: ${lastCandle.close.toFixed(4)}`
        );
      }
      
      if (topRSICrossedAboveMOST) {
        console.log(`🚀 TOP BULLISH CROSS: RSI(${top.lastRSI.toFixed(2)}) crossed above MOST(${top.lastMOST.toFixed(2)})`);
        console.log(`Previous values: RSI(${candleBuffers[symbol].prevTopRSI.toFixed(2)}) MOST(${candleBuffers[symbol].prevTopMOST.toFixed(2)})`);
      }
      if (bottomRSICrossedAboveMOST) {
        console.log(`🚀 BOTTOM BULLISH CROSS: RSI(${bottom.lastRSI.toFixed(2)}) crossed above MOST(${bottom.lastMOST.toFixed(2)})`);
        console.log(`Previous values: RSI(${candleBuffers[symbol].prevBottomRSI.toFixed(2)}) MOST(${candleBuffers[symbol].prevBottomMOST.toFixed(2)})`);
      }
    }
    
    // Check for RSI crossing below MOST (bearish signal)
    if (topRSICrossedBelowMOST || bottomRSICrossedBelowMOST) {
      // Only print header if not already printed by other alerts
      if (rsiDiff > THRESHOLD && mostDiff > THRESHOLD && !topRSIHigh && !bottomRSIHigh && 
          !topRSICrossedAboveMOST && !bottomRSICrossedAboveMOST) {
        console.log(
          `\n[${symbol.toUpperCase()}] ${dateStr} ${timeStr} - Price: ${lastCandle.close.toFixed(4)}`
        );
      }
      
      if (topRSICrossedBelowMOST) {
        console.log(`📉 TOP BEARISH CROSS: RSI(${top.lastRSI.toFixed(2)}) crossed below MOST(${top.lastMOST.toFixed(2)})`);
        console.log(`Previous values: RSI(${candleBuffers[symbol].prevTopRSI.toFixed(2)}) MOST(${candleBuffers[symbol].prevTopMOST.toFixed(2)})`);
      }
      if (bottomRSICrossedBelowMOST) {
        console.log(`📉 BOTTOM BEARISH CROSS: RSI(${bottom.lastRSI.toFixed(2)}) crossed below MOST(${bottom.lastMOST.toFixed(2)})`);
        console.log(`Previous values: RSI(${candleBuffers[symbol].prevBottomRSI.toFixed(2)}) MOST(${candleBuffers[symbol].prevBottomMOST.toFixed(2)})`);
      }
    }
    
    // Store current values for next comparison
    candleBuffers[symbol].prevTopRSI = top.lastRSI;
    candleBuffers[symbol].prevTopMOST = top.lastMOST;
    candleBuffers[symbol].prevBottomRSI = bottom.lastRSI;
    candleBuffers[symbol].prevBottomMOST = bottom.lastMOST;
    
    // Update last processed time
    candleBuffers[symbol].lastProcessedTime = lastCandle.time;
  }
}

// Start monitoring for each symbol
// Change to async function to handle promises
async function startMonitoring() {
  for (const symbol of SYMBOLS) {
    await initSymbol(symbol);
    // Small delay between initializing each symbol to avoid rate limits
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

startMonitoring();
