// mostRSI.js
const { SMA, EMA, WMA, VWMA } = require('technicalindicators');

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

  // Implement RMA calculation manually since it's not available
  function calculateRMA(values, period) {
    const result = [];
    let sum = 0;

    // Calculate initial SMA
    for (let i = 0; i < period; i++) {
      sum += values[i] || 0;
    }

    // First value is SMA
    let prevRMA = sum / period;
    result.push(prevRMA);

    // Calculate subsequent RMA values
    for (let i = period; i < values.length; i++) {
      prevRMA = (prevRMA * (period - 1) + values[i]) / period;
      result.push(prevRMA);
    }

    return result;
  }

  const avgGain = calculateRMA(gains, length);
  const avgLoss = calculateRMA(losses, length);

  for (let i = 0; i < avgGain.length; i++) {
    const rs =
      avgLoss[i] === 0 ? 100 : avgGain[i] === 0 ? 0 : avgGain[i] / avgLoss[i];
    rsi.push(100 - 100 / (1 + rs));
  }

  // Pad beginning with nulls to match original input length
  return Array(source.length - rsi.length)
    .fill(null)
    .concat(rsi);
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
    const vCMO = vUD + vDD === 0 ? 0 : (vUD - vDD) / (vUD + vDD);

    const prevVar = varArr[i - 1] ?? source[i];
    const v =
      valpha * Math.abs(vCMO) * source[i] +
      (1 - valpha * Math.abs(vCMO)) * prevVar;
    varArr[i] = v;
  }

  return varArr;
}

// Wrapper for various moving average types
function ma(type, source, length) {
  switch (type) {
    case 'SMA':
      return SMA.calculate({ period: length, values: source });
    case 'EMA':
      return EMA.calculate({ period: length, values: source });
    case 'WMA':
      return WMA.calculate({ period: length, values: source });
    case 'VWMA':
      return VWMA.calculate({ period: length, values: source });
    case 'SMMA':
    case 'SMMA (RMA)': {
      // Implement SMMA (same as RMA) manually
      function calculateRMA(values, period) {
        const result = [];
        let sum = 0;

        // Calculate initial SMA
        for (let i = 0; i < period; i++) {
          sum += values[i] || 0;
        }

        // First value is SMA
        let prevRMA = sum / period;
        result.push(prevRMA);

        // Calculate subsequent RMA values
        for (let i = period; i < values.length; i++) {
          prevRMA = (prevRMA * (period - 1) + values[i]) / period;
          result.push(prevRMA);
        }

        return result;
      }

      const rmaValues = calculateRMA(source, length);
      // Pad with nulls to match original length
      return Array(source.length - rmaValues.length)
        .fill(null)
        .concat(rmaValues);
    }
    case 'VAR':
      return varFunc(source, length); // custom
    default:
      return source;
  }
}

// Main function to compute MOST based on RSI-derived series
function computeMOSTRSI({ close, high, low }, options) {
  const {
    rsiLength = 14,
    maLength = 5,
    maType = 'VAR',
    stopLossPercent = 9.0,
  } = options;

  // Compute base RSI and moving average of RSI
  const rsiVals = rsi(close, rsiLength);
  const rsiMA = ma(maType, rsiVals, maLength);

  // Return the RSI and RSI-MA values directly
  return {
    lastRSI: rsiVals[rsiVals.length - 1],
    lastRsiMa: rsiMA[rsiMA.length - 1],
    // Include full arrays for potential plotting
    rsiValues: rsiVals,
    rsiMaValues: rsiMA,
  };
}

module.exports = { computeMOSTRSI };
