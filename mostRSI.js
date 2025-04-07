// mostRSI.js
const { SMA, EMA, WMA, VWMA, RMA } = require('technicalindicators');

// Calculate RSI manually using RMA of gains and losses
function rsi(source, length) {
    const gains = [];
    const losses = [];
    const rsi = [];

    for (let i = 1; i < source.length; i++) {
        const diff = source[i] - source[i - 1];
        gains.push(diff > 0 ? diff : 0);
        losses.push(diff < 0 ? -diff : 0);
    }

    const avgGain = RMA.calculate({ values: gains, period: length });
    const avgLoss = RMA.calculate({ values: losses, period: length });

    for (let i = 0; i < avgGain.length; i++) {
        const rs = avgLoss[i] === 0 ? 100 : avgGain[i] === 0 ? 0 : avgGain[i] / avgLoss[i];
        rsi.push(100 - (100 / (1 + rs)));
    }

    // Pad beginning with nulls to match original input length
    return Array(source.length - rsi.length).fill(null).concat(rsi);
}

// Simple sum of recent values up to a given period
function sum(series, period, index) {
    let total = 0;
    for (let i = 0; i < period; i++) {
        const j = index - i;
        if (j >= 0 && series[j] != null) {
            total += series[j];
        }
    }
    return total;
}

// Custom moving average based on Chande Momentum Oscillator (CMO)
function varFunc(source, length) {
    const valpha = 2 / (length + 1);
    const varArr = Array(source.length).fill(null);
    const vudSeries = [];
    const vddSeries = [];

    // Build difference up/down series for use in VAR calc
    for (let i = 1; i < source.length; i++) {
        vudSeries[i] = source[i] > source[i - 1] ? source[i] - source[i - 1] : 0;
        vddSeries[i] = source[i] < source[i - 1] ? source[i - 1] - source[i] : 0;
    }

    // Apply recursive smoothing formula with adaptive alpha
    for (let i = 1; i < source.length; i++) {
        const vUD = sum(vudSeries, 9, i);
        const vDD = sum(vddSeries, 9, i);
        const vCMO = (vUD + vDD) === 0 ? 0 : (vUD - vDD) / (vUD + vDD);

        const prevVar = varArr[i - 1] ?? source[i];
        const v = valpha * Math.abs(vCMO) * source[i] + (1 - valpha * Math.abs(vCMO)) * prevVar;
        varArr[i] = v;
    }

    return varArr;
}

// Wrapper for various moving average types
function ma(type, source, length) {
    switch (type) {
        case 'SMA': return SMA.calculate({ period: length, values: source });
        case 'EMA': return EMA.calculate({ period: length, values: source });
        case 'WMA': return WMA.calculate({ period: length, values: source });
        case 'VWMA': return VWMA.calculate({ period: length, values: source });
        case 'SMMA': return RMA.calculate({ period: length, values: source });
        case 'VAR': return varFunc(source, length); // custom
        default: return source;
    }
}

// Main function to compute MOST based on RSI-derived series
function computeMOSTRSI({ close, high, low }, options) {
    const {
        rsiLength = 14,
        maLength = 5,
        maType = 'VAR',
        stopLossPercent = 9.0
    } = options;

    // Compute base RSI and moving average of RSI
    const rsiVals = rsi(close, rsiLength);
    const rsiMA = ma(maType, rsiVals, maLength);

    const most = [];
    const crossovers = [];
    const crossunders = [];
    const dir = [];

    // Iterate through each value to build MOST line and detect signals
    for (let i = 0; i < rsiMA.length; i++) {
        const exMov = rsiMA[i];
        if (exMov == null) {
            most.push(null);
            dir.push(null);
            continue;
        }

        const prevMost = most[i - 1] ?? exMov;
        const prevDir = dir[i - 1] ?? 1;
        const fark = exMov * stopLossPercent * 0.01; // stop level

        // Calculate long and short stop based on price and trend direction
        let longStop = exMov - fark;
        longStop = exMov > prevMost ? Math.max(longStop, prevMost) : longStop;

        let shortStop = exMov + fark;
        shortStop = exMov < prevMost ? Math.min(shortStop, prevMost) : shortStop;

        let d = prevDir;
        if (prevDir === -1 && exMov > shortStop) d = 1;
        else if (prevDir === 1 && exMov < longStop) d = -1;

        dir.push(d);
        most.push(d === 1 ? longStop : shortStop);

        // Detect signal crossings
        if (i > 0) {
            crossovers.push(rsiMA[i - 1] < most[i - 1] && rsiMA[i] > most[i]);
            crossunders.push(rsiMA[i - 1] > most[i - 1] && rsiMA[i] < most[i]);
        } else {
            crossovers.push(false);
            crossunders.push(false);
        }
    }

    return {
        most,
        crossover: crossovers,
        crossunder: crossunders,
        lastMOST: most[most.length - 1],
        lastRSI: rsiVals[rsiVals.length - 1],
        lastSignal: crossovers[crossovers.length - 1] ? 'BUY' : crossunders[crossunders.length - 1] ? 'SELL' : null
    };
}

module.exports = { computeMOSTRSI };