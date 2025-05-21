// alerts.js
const { candleData, indicatorData, sentAlerts } = require('./data');
const { ALERT_COOLDOWN_MS, CONFIG_RSI_7_MA_7, CONFIG_RSI_21 } = require('./config');
const { sendTelegramAlert } = require('./telegram');

// Function to check the Difference alert
function checkDifferenceAlert(symbol, interval) {
    const indicators = indicatorData[symbol]?.[interval];
    const candles = candleData[symbol]?.[interval];

    // Skip if we don't have indicator values or candles
    if (!indicators || !candles || candles.length === 0) {
        return;
    }

    // Assuming indicators.rsi7ma7 is RSI(21) MA(7) and indicators.rsi21 is RSI(21)
    const rsi7ma7 = indicators.rsi7ma7;
    const rsi21 = indicators.rsi21;
    const livePrice = candles[candles.length - 1]?.close; // Use the close of the latest candle as live price

    // Skip if we don't have valid indicator values or live price
    if (rsi7ma7 === undefined || rsi21 === undefined || livePrice === undefined) {
        return;
    }

    // Check the conditions: both >= 40 and difference <= 1
    if (rsi7ma7 >= 40 && rsi21 >= 40 && Math.abs(rsi7ma7 - rsi21) <= 1) {
        const alertType = 'difference_alert';
        // Cooldown check is now handled inside sendTelegramAlert
        // const alertKey = `${symbol}_${alertType}`; // alertKey is generated inside sendTelegramAlert

        const date = new Date();
        const timeStr = date.toLocaleTimeString();
        const dateStr = date.toLocaleDateString();

        const alertHeader = `\n[${symbol.toUpperCase()}:${interval}] Tarih: ${dateStr} ${timeStr} - Fiyat: ${livePrice.toFixed(4)}`;
        const alertMsg = `🔔 ##### FARK ALARMI ##### 🔔\nRSI(21): ${rsi21.toFixed(2)} / MA(7): ${rsi7ma7.toFixed(2)}\nFark: ${Math.abs(rsi7ma7 - rsi21).toFixed(2)}`;

        const telegramMessage = `${alertHeader}\n\n${alertMsg}`;
        sendTelegramAlert(symbol, alertType, telegramMessage);
    }
}

// Function to check the 1d Bullish Crossover alert
function checkBullishCrossover1d(symbol) {
    const interval = '1d';
    const indicators = indicatorData[symbol]?.[interval];
    const candles = candleData[symbol]?.[interval];

    // Skip if we don't have indicator values or enough candles
    if (!indicators || !candles || candles.length < 2) {
        return;
    }

    // Assuming indicators.rsi21 is RSI(21) and indicators.rsi21ma21 is RSI(21)MA(21)
    const rsi21 = indicators.rsi21;
    const rsi21ma21 = indicators.rsi21ma21;
    const previousRsi21 = indicators.previousRsi21;
    const previousRsi21ma21 = indicators.previousRsi21ma21;
    const livePrice = candles[candles.length - 1]?.close;

    // Skip if we don't have all required values
    if (
        rsi21 === undefined ||
        rsi21ma21 === undefined ||
        previousRsi21 === undefined ||
        previousRsi21ma21 === undefined ||
        livePrice === undefined
    ) {
        return;
    }

    // Check for bullish crossover: RSI(21) crosses above MA(21)
    // Previous RSI(21) was below or equal to Previous MA(21) AND Current RSI(21) is above Current MA(21)
    if (previousRsi21 <= previousRsi21ma21 && rsi21 > rsi21ma21) {
        const alertType = 'bullish_crossover_1d';
        // Cooldown check is now handled inside sendTelegramAlert
        // const alertKey = `${symbol}_${alertType}`; // alertKey is generated inside sendTelegramAlert

        const date = new Date();
        const timeStr = date.toLocaleTimeString();
        const dateStr = date.toLocaleDateString();

        const alertHeader = `\n[${symbol.toUpperCase()}:${interval}] Tarih: ${dateStr} ${timeStr} - Fiyat: ${livePrice.toFixed(4)}`;
        const alertMsg = `📈 ##### BOĞA KESİŞİMİ (1D) ##### 📈\nRSI(21): ${rsi21.toFixed(2)} / MA(21): ${rsi21ma21.toFixed(2)}`;

        const telegramMessage = `${alertHeader}\n\n${alertMsg}`;
        sendTelegramAlert(symbol, alertType, telegramMessage);
    }
}

// Function to check the 1h Bearish Crossover alert
function checkBearishCrossover1h(symbol) {
    const interval = '1h';
    const indicators = indicatorData[symbol]?.[interval];
    const candles = candleData[symbol]?.[interval];

    // Skip if we don't have indicator values or enough candles
    if (!indicators || !candles || candles.length < 2) {
        return;
    }

    // Assuming indicators.rsi21 is RSI(21) and indicators.rsi21ma21 is RSI(21)MA(21)
    const rsi21 = indicators.rsi21;
    const rsi21ma21 = indicators.rsi21ma21;
    const previousRsi21 = indicators.previousRsi21;
    const previousRsi21ma21 = indicators.previousRsi21ma21;
    const livePrice = candles[candles.length - 1]?.close;

    // Skip if we don't have all required values
    if (
        rsi21 === undefined ||
        rsi21ma21 === undefined ||
        previousRsi21 === undefined ||
        previousRsi21ma21 === undefined ||
        livePrice === undefined
    ) {
        return;
    }

    // Check for bearish crossover: RSI(21) crosses below MA(21)
    // Previous RSI(21) was above or equal to Previous MA(21) AND Current RSI(21) is below Current MA(21)
    if (previousRsi21 >= previousRsi21ma21 && rsi21 < rsi21ma21) {
        const alertType = 'bearish_crossover_1h';
        // Cooldown check is now handled inside sendTelegramAlert
        // const alertKey = `${symbol}_${alertType}`; // alertKey is generated inside sendTelegramAlert

        const date = new Date();
        const timeStr = date.toLocaleTimeString();
        const dateStr = date.toLocaleDateString();

        const alertHeader = `\n[${symbol.toUpperCase()}:${interval}] Tarih: ${dateStr} ${timeStr} - Fiyat: ${livePrice.toFixed(4)}`;
        const alertMsg = `📉 ##### AYI KESİŞİMİ (1H) ##### 📉\nRSI(21): ${rsi21.toFixed(2)} / MA(21): ${rsi21ma21.toFixed(2)}`;

        const telegramMessage = `${alertHeader}\n\n${alertMsg}`;
        sendTelegramAlert(symbol, alertType, telegramMessage);
    }
}

module.exports = {
    checkDifferenceAlert,
    checkBullishCrossover1d,
    checkBearishCrossover1h,
};