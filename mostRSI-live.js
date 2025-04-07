// multi-symbol MOSTRSI live monitor
const WebSocket = require('ws');
const { computeMOSTRSI } = require('./mostRSI');

// List of symbols to monitor
const SYMBOLS = ['btcusdt', 'ethusdt', 'solusdt', 'arkusdt', 'rareusdt', 'crvusdt', 'straxusdt', 'uftusdt', 'prosusdt', 'funusdt', 'stptusdt', 'ltousdt', 'cvcusdt', 'qkcusdt', 'ardrusdt', 'storjusdt', 'powrusdt', 'leverusdt'];
const INTERVAL = '1h'; // Binance interval (1h candles)
const CANDLE_LIMIT = 500; // Max candles to keep in memory per symbol
const THRESHOLD = 1.5; // Alert threshold for difference in RSI or MOST

// Configuration for two different MOSTRSI setups (top and bottom)
const CONFIG_TOP = { rsiLength: 7, maLength: 7, maType: 'EMA', stopLossPercent: 9 };
const CONFIG_BOTTOM = { rsiLength: 14, maLength: 5, maType: 'VAR', stopLossPercent: 9 };

// Store candle data for each symbol
const candleBuffers = {};

// Initialize WebSocket connection for each symbol
function initSymbol(symbol) {
    candleBuffers[symbol] = []; // Init empty array to store candle history

    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol}@kline_${INTERVAL}`);

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
            volume: parseFloat(k.v)
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

        if (candles.length >= 50) updateMOST(symbol); // Wait until enough data
    });
}

// Compute and compare MOSTRSI for both configurations
function updateMOST(symbol) {
    const candles = candleBuffers[symbol];
    const close = candles.map(c => c.close);
    const high = candles.map(c => c.high);
    const low = candles.map(c => c.low);

    // Compute RSI and MOST for top and bottom config
    const top = computeMOSTRSI({ close, high, low }, CONFIG_TOP);
    const bottom = computeMOSTRSI({ close, high, low }, CONFIG_BOTTOM);

    const rsiDiff = Math.abs(top.lastRSI - bottom.lastRSI);
    const mostDiff = Math.abs(top.lastMOST - bottom.lastMOST);

    // Print current values and differences
    console.log(`\n[${symbol.toUpperCase()}] RSI: ${top.lastRSI.toFixed(2)} / ${bottom.lastRSI.toFixed(2)} Δ${rsiDiff.toFixed(2)}`);
    console.log(`                MOST: ${top.lastMOST.toFixed(2)} / ${bottom.lastMOST.toFixed(2)} Δ${mostDiff.toFixed(2)}`);

    // Trigger alert logic for RSI
    if (rsiDiff >= THRESHOLD) {
        const direction = top.lastRSI > bottom.lastRSI ? "Top > Bottom" : "Bottom > Top";
        const above50 = top.lastRSI > 50 && bottom.lastRSI > 50;
        const below50 = top.lastRSI < 50 && bottom.lastRSI < 50;

        console.log(`🔔 RSI DIFF: ${rsiDiff.toFixed(2)} (${direction})`);
        if (above50) console.log(`📈 RSI both above 50`);
        else if (below50) console.log(`📉 RSI both below 50`);
    }

    // Trigger alert logic for MOST
    if (mostDiff >= THRESHOLD) {
        const direction = top.lastMOST > bottom.lastMOST ? "Top > Bottom" : "Bottom > Top";
        const above50 = top.lastMOST > 50 && bottom.lastMOST > 50;
        const below50 = top.lastMOST < 50 && bottom.lastMOST < 50;

        console.log(`🔔 MOST DIFF: ${mostDiff.toFixed(2)} (${direction})`);
        if (above50) console.log(`📈 MOST both above 50`);
        else if (below50) console.log(`📉 MOST both below 50`);
    }
}

// Start monitoring for each symbol
SYMBOLS.forEach(initSymbol);