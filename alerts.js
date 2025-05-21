// alerts.js
const { candleData, indicatorData, sentAlerts } = require('./data');
const { sendTelegramAlert } = require('./telegram');

// Function to check the Difference alert
function checkDifferenceAlert(symbol, interval) {
    const indicators = indicatorData[symbol]?.[interval];
    const candles = candleData[symbol]?.[interval];

    // Skip if we don't have indicator values or candles
    if (!indicators || !candles || candles.length === 0) {
        return;
    }

    // Assuming indicators.rsi7ma7 is RSI(7) MA(5) and indicators.rsi21 is RSI(21)
    const rsi7ma7 = indicators.rsi7ma7;
    const rsi21 = indicators.rsi21;
    const livePrice = candles[candles.length - 1]?.close; // Use the close of the latest candle as live price

    // Skip if we don't have valid indicator values or live price
    if (rsi7ma7 === undefined || rsi21 === undefined || livePrice === undefined) {
        return;
    }

    // Check the conditions: absolute difference <= 1 AND (rsi7ma7 >= 40 OR rsi21 >= 40)
    if (Math.abs(rsi7ma7 - rsi21) <= 1 && (rsi7ma7 >= 40 || rsi21 >= 40)) {
        const alertType = 'difference_alert';
        // Cooldown check is now handled inside sendTelegramAlert

        const date = new Date();
        const timeStr = date.toLocaleTimeString();
        const dateStr = date.toLocaleDateString();

        const alertHeader = `\n[${symbol.toUpperCase()}:${interval}] Tarih: ${dateStr} ${timeStr} - Fiyat: ${livePrice.toFixed(4)}`;
        // Updated message to reflect RSI(7) MA(5) and RSI(21)
        const alertMsg = `🔔 ##### FARK ALARMI ##### 🔔\nRSI(7) MA(5): ${rsi7ma7.toFixed(2)} / RSI(21): ${rsi21.toFixed(2)}\nFark: ${Math.abs(rsi7ma7 - rsi21).toFixed(2)}`;

        const telegramMessage = `${alertHeader}\n\n${alertMsg}`;
        // Pass the interval parameter
        sendTelegramAlert(symbol, alertType, telegramMessage, interval);
    }
}

module.exports = {
    checkDifferenceAlert,
};