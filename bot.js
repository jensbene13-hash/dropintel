const WebSocket = require('ws');
const fetch = require('node-fetch');

const API_KEY = process.env.ALPACA_API_KEY;
const SECRET_KEY = process.env.ALPACA_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const BASE_URL = 'https://paper-api.alpaca.markets';
const DATA_URL = 'https://data.alpaca.markets';

const WATCHLIST = [
  'AAPL', 'NVDA', 'MSFT', 'META', 'GOOGL',
  'TSLA', 'AMZN', 'JNJ', 'PFE', 'JPM',
  'BAC', 'XOM', 'CVX', 'SPY', 'QQQ'
];

const MAX_TRADE = 200;
const TAKE_PROFIT_PCT = 0.01;
const STOP_LOSS_PCT = 0.005;

let positions = {};
let pingInterval = null;

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

async function placeOrder(symbol, qty, side) {
  const res = await fetch(`${BASE_URL}/v2/orders`, {
    method: 'POST',
    headers: {
      'APCA-API-KEY-ID': API_KEY,
      'APCA-API-SECRET-KEY': SECRET_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      symbol,
      qty,
      side,
      type: 'market',
      time_in_force: 'day',
    })
  });
  return res.json();
}

async function getHistoricalData(symbol) {
  try {
    const res = await fetch(
      `${DATA_URL}/v2/stocks/${symbol}/bars?timeframe=1Day&limit=100&start=2025-01-01`,
      {
        headers: {
          'APCA-API-KEY-ID': API_KEY,
          'APCA-API-SECRET-KEY': SECRET_KEY,
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

    if (positions[symbol]) {
      const position = positions[symbol];
      const pnlPct = (currentPrice - position.entryPrice) / position.entryPrice;

      if (pnlPct >= TAKE_PROFIT_PCT) {
        console.log(`🟢 TAKE PROFIT: Selling ${symbol} at ${currentPrice} (+${(pnlPct*100).toFixed(2)}%)`);
        await placeOrder(symbol, position.shares, 'sell');
        await logTrade({
          symbol, action: 'SELL', price: currentPrice,
          shares: position.shares, outcome: 'WIN',
          profit_loss: ((currentPrice - position.entryPrice) * position.shares).toFixed(2),
        });
        delete positions[symbol];
      } else if (pnlPct <= -STOP_LOSS_PCT) {
        console.log(`🔴 STOP LOSS: Selling ${symbol} at ${currentPrice} (${(pnlPct*100).toFixed(2)}%)`);
        await placeOrder(symbol, position.shares, 'sell');
        await logTrade({
          symbol, action: 'SELL', price: currentPrice,
          shares: position.shares, outcome: 'LOSS',
          profit_loss: ((currentPrice - position.entryPrice) * position.shares).toFixed(2),
        });
        delete positions[symbol];
      }
      return;
    }

    if (ma10 > ma20 && rsi < 70) {
      const shares = Math.floor(MAX_TRADE / currentPrice);
      if (shares < 1) return;

      console.log(`📈 BUY: ${symbol} at $${currentPrice} | RSI: ${rsi.toFixed(2)} | MA10: ${ma10.toFixed(2)} | MA20: ${ma20.toFixed(2)}`);
      await placeOrder(symbol, shares, 'buy');
      positions[symbol] = { entryPrice: currentPrice, shares };
      await logTrade({
        symbol, action: 'BUY', price: currentPrice, shares,
        rsi: parseFloat(rsi.toFixed(2)),
        ma10: parseFloat(ma10.toFixed(2)),
        ma20: parseFloat(ma20.toFixed(2)),
      });
    }
  } catch (e) {
    console.error(`Error analyzing ${symbol}:`, e.message);
  }
}

function startBot() {
  console.log('🤖 Trading bot starting...');
  
  const ws = new WebSocket('wss://stream.data.alpaca.markets/v2/sip');

  ws.on('open', () => {
    console.log('✅ Connected to Alpaca WebSocket!');
    ws.send(JSON.stringify({ action: 'auth', key: API_KEY, secret: SECRET_KEY }));
    
    // Keep connection alive
    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        console.log('🔄 Ping sent to keep connection alive');
      }
    }, 10000);
  });

  ws.on('message', async (data) => {
    const messages = JSON.parse(data);
    for (const msg of messages) {
      console.log('📨 Message:', JSON.stringify(msg));
      
      if (msg.T === 'success' && msg.msg === 'authenticated') {
        console.log('✅ Authenticated! Subscribing to live trades...');
        ws.send(JSON.stringify({
          action: 'subscribe',
          trades: WATCHLIST,
        }));
      }

      if (msg.T === 'subscription') {
        console.log('✅ Subscribed to:', JSON.stringify(msg));
      }

      if (msg.T === 't') {
        const symbol = msg.S;
        const price = msg.p;
        console.log(`💹 ${symbol}: $${price}`);
        await analyzeAndTrade(symbol, price);
      }
    }
  });

  ws.on('pong', () => {
    console.log('🏓 Pong received');
  });

  ws.on('error', (err) => {
    console.error('❌ WebSocket error:', err.message);
  });

  ws.on('close', (code, reason) => {
    console.log(`Disconnected (${code}: ${reason}), reconnecting in 5 seconds...`);
    if (pingInterval) clearInterval(pingInterval);
    setTimeout(startBot, 5000);
  });
}

startBot();
