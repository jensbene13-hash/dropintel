const WATCHLIST = [
  'AAPL', 'NVDA', 'MSFT', 'META', 'GOOGL',
  'TSLA', 'AMZN', 'JNJ', 'PFE', 'JPM',
  'BAC', 'XOM', 'CVX', 'SPY', 'QQQ'
];

const MIN_TRADE = 10;
const MAX_TRADE = 50;

async function analyzeStock(symbol, apiKey, secretKey) {
  const DATA_URL = 'https://data.alpaca.markets';
  const barsRes = await fetch(`${DATA_URL}/v2/stocks/${symbol}/bars?timeframe=1Day&limit=100&start=2025-01-01`, {
    headers: {
      'APCA-API-KEY-ID': apiKey,
      'APCA-API-SECRET-KEY': secretKey,
    }
  });
  const barsData = await barsRes.json();
  const bars = barsData.bars;
  if (!bars || bars.length < 20) return null;

  const closes = bars.map(b => b.c);
  const ma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const changes = closes.slice(-15).map((c, i, arr) => i === 0 ? 0 : c - arr[i - 1]);
  const gains = changes.map(c => c > 0 ? c : 0);
  const losses = changes.map(c => c < 0 ? Math.abs(c) : 0);
  const avgGain = gains.reduce((a, b) => a + b, 0) / 14;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / 14;
  const rs = avgGain / (avgLoss || 1);
  const rsi = 100 - (100 / (1 + rs));
  const currentPrice = closes[closes.length - 1];

  let signal = 'HOLD';
  let score = 0;

  if (ma10 > ma20 && rsi < 70) {
    signal = 'BUY';
    score = (ma10 - ma20) / ma20 * 100 + (70 - rsi);
  } else if (ma10 < ma20 && rsi > 30) {
    signal = 'SELL';
    score = (ma20 - ma10) / ma20 * 100 + (rsi - 30);
  }

  return { symbol, currentPrice, signal, score, rsi: rsi.toFixed(2), ma10: ma10.toFixed(2), ma20: ma20.toFixed(2) };
}

export default async function handler(req, res) {
  const API_KEY = process.env.ALPACA_API_KEY;
  const SECRET_KEY = process.env.ALPACA_SECRET_KEY;
  const BASE_URL = 'https://paper-api.alpaca.markets';

  try {
    // Scan all stocks
    const results = await Promise.all(
      WATCHLIST.map(symbol => analyzeStock(symbol, API_KEY, SECRET_KEY))
    );

    const signals = results.filter(r => r !== null);
    const buySignals = signals.filter(r => r.signal === 'BUY').sort((a, b) => b.score - a.score);
    const bestBuy = buySignals[0];

    if (!bestBuy) {
      return res.status(200).json({ message: 'No strong buy signals found', signals });
    }

    // Calculate how many shares to buy
    const shares = Math.floor(MAX_TRADE / bestBuy.currentPrice);
    if (shares < 1) {
      return res.status(200).json({ message: `${bestBuy.symbol} too expensive for current limits`, bestBuy, signals });
    }

    // Place the trade
    const orderRes = await fetch(`${BASE_URL}/v2/orders`, {
      method: 'POST',
      headers: {
        'APCA-API-KEY-ID': API_KEY,
        'APCA-API-SECRET-KEY': SECRET_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        symbol: bestBuy.symbol,
        qty: shares,
        side: 'buy',
        type: 'market',
        time_in_force: 'day',
      })
    });

    const order = await orderRes.json();

    res.status(200).json({
      message: `Placed BUY order for ${shares} shares of ${bestBuy.symbol}`,
      order,
      bestBuy,
      allSignals: signals,
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
