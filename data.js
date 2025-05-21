// data.js

// Store candle data for each symbol and interval
const candleData = {};

// Store calculated indicator data for each symbol and interval
const indicatorData = {};

// Store timestamps of the last sent alert for each symbol and type
const sentAlerts = {};

module.exports = {
    candleData,
    indicatorData,
    sentAlerts,
};