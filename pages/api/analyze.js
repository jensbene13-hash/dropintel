export default async function handler(req, res) {
  const API_KEY = process.env.ALPACA_API_KEY;
  const SECRET_KEY = process.env.ALPACA_SECRET_KEY;
  const DATA_URL = 'https://data.alpaca.markets';
  const symbol = req.query.symbol || 'AAPL';

  try {
    // Get 50 days of historical data
    const barsRes = await fetch(`${DATA_URL}/v2/stocks/${symbol}/bars?timeframe=1Day&limit=50`, {
      headers: {
        'APCA-API-KEY-ID': API_KEY,
        'APCA-API-SECRET-KEY': SECRET_KEY,
      }
    });
    const barsData = await barsRes.json();
    const bars = barsData.bars;

    if (!bars || bars.length < 20) {
      return res.status(200).json({ signal: 'HOLD', reason: 'Not enough data' });
    }

    const closes = bars.map(b => b.c);

    // Calculate 10 day and 20 day moving averages
    const ma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;

    // Calculate RSI
    const changes = closes.slice(-15).map((c, i, arr) => i === 0 ? 0 : c - arr[i - 1]);
    const gains = changes.map(c => c > 0 ? c : 0);
    const losses = changes.map(c => c < 0 ? Math.abs(c) : 0);
    const avgGain = gains.reduce((a, b) => a + b, 0) / 14;
    const avgLoss = losses.reduce((a, b) => a + b, 0) / 14;
    const rs = avgGain / (avgLoss || 1);
    const rsi = 100 - (100 / (1 + rs));

    const currentPrice = closes[closes.length - 1];

    // Generate signal
    let signal = 'HOLD';
    let reason = '';

    if (ma10 > ma20 && rsi < 70) {
      signal = 'BUY';
      reason = `MA10 (${ma10.toFixed(2)}) > MA20 (${ma20.toFixed(2)}) and RSI (${rsi.toFixed(2)}) not overbought`;
    } else if (ma10 < ma20 && rsi > 30) {
      signal = 'SELL';
      reason = `MA10 (${ma10.toFixed(2)}) < MA20 (${ma20.toFixed(2)}) and RSI (${rsi.toFixed(2)}) not oversold`;
    } else {
      reason = `RSI: ${rsi.toFixed(2)}, MA10: ${ma10.toFixed(2)}, MA20: ${ma20.toFixed(2)}`;
    }

    res.status(200).json({
      symbol,
      currentPrice,
      signal,
      reason,
      rsi: rsi.toFixed(2),
      ma10: ma10.toFixed(2),
      ma20: ma20.toFixed(2),
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
