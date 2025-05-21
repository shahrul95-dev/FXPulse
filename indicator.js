const axios = require('axios');
const { EMA, ATR } = require('technicalindicators');

const WEBHOOK_URL = 'https://webhook.site/84fc0916-2530-43e9-863b-2c95b9718f3f'; // Replace with your webhook URL

const symbol = 'XRP-USDT';
const interval = '2m';
const limit = 100;

const getOKXCandles = async () => {
  const url = `https://www.okx.com/api/v5/market/candles?instId=${symbol}&bar=${interval}&limit=${limit}`;
  const response = await axios.get(url);
    console.log(url);
  const candles = response.data.data;

  return candles.map(c => {
    const high = parseFloat(c[2]);
    const low = parseFloat(c[3]);
    const close = parseFloat(c[4]);
    return {
      high,
      low,
      close,
      hl2: (high + low) / 2
    };
  }).reverse(); // Oldest to newest
};

const calculate = async () => {
  const data = await getOKXCandles();

  const hl2 = data.map(d => d.hl2);
  const high = data.map(d => d.high);
  const low = data.map(d => d.low);
  const close = data.map(d => d.close);

  const length = 10;
  const multiplier = 3.0;

  const ema = EMA.calculate({ period: length, values: hl2 });
  const atr = ATR.calculate({ period: 10, high, low, close });

  const offset = data.length - ema.length;

  let signals = [];

  for (let i = 1; i < ema.length; i++) {
    const MAvg = ema[i];
    const atrVal = atr[i];
    const longStop = MAvg - multiplier * atrVal;
    const shortStop = MAvg + multiplier * atrVal;
    const prevMAvg = ema[i - 1];
    const prevLongStop = ema[i - 1] - multiplier * atr[i - 1];
    const prevShortStop = ema[i - 1] + multiplier * atr[i - 1];

    const PMax = MAvg > prevLongStop ? Math.max(longStop, prevLongStop) : longStop;

    const crossedUnder = prevMAvg > PMax && MAvg < PMax;
    const crossedOver = prevMAvg < PMax && MAvg > PMax;

    if (crossedUnder) {
      signals.push({ type: 'SELL', price: close[i + offset] });
    } else if (crossedOver) {
      signals.push({ type: 'BUY', price: close[i + offset] });
    }
  }

  if (signals.length > 0) {
    const lastSignal = signals[signals.length - 1];
    await axios.post(WEBHOOK_URL, {
      symbol,
      signal: lastSignal.type,
      price: lastSignal.price,
      time: new Date().toISOString()
    });
    console.log(`Webhook Sent: ${lastSignal.type} @ ${lastSignal.price}`);
  } else {
    console.log('No signal generated.');
  }
};

calculate();
