const Alpaca = require('@alpacahq/alpaca-trade-api');
const fetch = require('node-fetch');

const alpaca = new Alpaca({
  keyId: process.env.ALPACA_API_KEY,
  secretKey: process.env.ALPACA_SECRET_KEY,
  paper: true,
});

const WATCHLIST = [
  'AAPL', 'NVDA', 'MSFT', 'META', 'GOOGL',
  'TSLA', 'AMZN', 'JNJ', 'PFE', 'JPM',
  'BAC', 'XOM', 'CVX', 'SPY', 'QQQ'
];

const MAX_TRADE = 200;
const TAKE_PROFIT_PCT = 0.01;
const STOP_LOSS_PCT = 0.005;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

let positions = {};
let lastAnalysis = {};

async function logTrade(trade) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/trades`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(trade)
    });
  } catch (e) {
    console.error('Failed to log trade:', e.message);
  }
}

async function getHistoricalData(symbol) {
  try {
    const res = await fetch(
      `https://data.alpaca.markets/v2/stocks/${symbol}/bars?timeframe=1Day&limit=100&start=2025-01-01`,
      {
        headers: {
          'APCA-API-KEY-ID': process.env.ALPACA_API_KEY,
          'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY,
        }
      }
    );
    const data = await res.json();
    return data.bars || [];
  } catch (e) {
    return [];
  }
}

function calculateIndicators(bars) {
  if (bars.length < 20) return null;
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
  return { ma10, ma20, rsi };
}

async function analyzeAndTrade(symbol, currentPrice) {
  try {
    const bars = await getHistoricalData(symbol);
    const indicators = calculateIndicators(bars);
    if (!indicators) return;

    const { ma10, ma20, rsi } = indicators;
    lastAnalysis[symbol] = { ma10, ma20, rsi, currentPrice };

    // Check existing position
    if (positions[symbol]) {
      const position = positions[symbol];
      const pnlPct = (currentPrice - position.entryPrice) / position.entryPrice;

      if (pnlPct >= TAKE_PROFIT_PCT) {
        console.log(`🟢 TAKE PROFIT: Selling ${symbol} at ${currentPrice} (+${(pnlPct*100).toFixed(2)}%)`);
        await alpaca.createOrder({
          symbol,
          qty: position.shares,
          side: 'sell',
          type: 'market',
          time_in_force: 'day',
        });
        await logTrade({
          symbol,
          action: 'SELL',
          price: currentPrice,
          shares: position.shares,
          outcome: 'WIN',
          profit_loss: ((currentPrice - position.entryPrice) * position.shares).toFixed(2),
        });
        delete positions[symbol];
      } else if (pnlPct <= -STOP_LOSS_PCT) {
        console.log(`🔴 STOP LOSS: Selling ${symbol} at ${currentPrice} (${(pnlPct*100).toFixed(2)}%)`);
        await alpaca.createOrder({
          symbol,
          qty: position.shares,
          side: 'sell',
          type: 'market',
          time_in_force: 'day',
        });
        await logTrade({
          symbol,
          action: 'SELL',
          price: currentPrice,
          shares: position.shares,
          outcome: 'LOSS',
          profit_loss: ((currentPrice - position.entryPrice) * position.shares).toFixed(2),
        });
        delete positions[symbol];
      }
      return;
    }

    // Check for buy signal
    if (ma10 > ma20 && rsi < 70 && !positions[symbol]) {
      const shares = Math.floor(MAX_TRADE / currentPrice);
      if (shares < 1) return;

      console.log(`📈 BUY SIGNAL: ${symbol} at ${currentPrice} | RSI: ${rsi.toFixed(2)} | MA10: ${ma10.toFixed(2)} | MA20: ${ma20.toFixed(2)}`);
      
      await alpaca.createOrder({
        symbol,
        qty: shares,
        side: 'buy',
        type: 'market',
        time_in_force: 'day',
      });

      positions[symbol] = { entryPrice: currentPrice, shares };

      await logTrade({
        symbol,
        action: 'BUY',
        price: currentPrice,
        shares,
        rsi: parseFloat(rsi.toFixed(2)),
        ma10: parseFloat(ma10.toFixed(2)),
        ma20: parseFloat(ma20.toFixed(2)),
      });
    }
  } catch (e) {
    console.error(`Error analyzing ${symbol}:`, e.message);
  }
}

async function startBot() {
  console.log('🤖 Trading bot starting...');

  const socket = alpaca.data_stream_v2;

  socket.onConnect(() => {
    console.log('✅ Connected to Alpaca live data stream!');
    socket.subscribeForTrades(WATCHLIST);
    socket.subscribeForQuotes(WATCHLIST);
  });

  socket.onStockTrade(async (trade) => {
    const symbol = trade.S;
    const price = trade.p;
    console.log(`💹 ${symbol}: $${price}`);
    await analyzeAndTrade(symbol, price);
  });

  socket.onError((err) => {
    console.error('WebSocket error:', err);
  });

  socket.onDisconnect(() => {
    console.log('Disconnected, reconnecting in 5 seconds...');
    setTimeout(startBot, 5000);
  });

  socket.connect();
}

startBot();
