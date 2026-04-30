const WebSocket = require('ws');
const fetch = require('node-fetch');

const API_KEY = process.env.ALPACA_API_KEY;
const SECRET_KEY = process.env.ALPACA_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const BASE_URL = 'https://paper-api.alpaca.markets';
const DATA_URL = 'https://data.alpaca.markets';

const WATCHLIST = [
  'AAPL', 'NVDA', 'MSFT', 'META', 'GOOGL', 'TSLA', 'AMZN', 'AMD', 'INTC', 'CRM',
  'JPM', 'BAC', 'GS', 'MS', 'V', 'MA', 'WFC', 'C', 'AXP', 'BLK',
  'JNJ', 'PFE', 'UNH', 'ABBV', 'MRK', 'CVS', 'LLY', 'TMO', 'ABT', 'DHR',
  'XOM', 'CVX', 'COP', 'SLB', 'EOG', 'MPC', 'VLO', 'PSX', 'OXY', 'HAL',
  'SPY', 'QQQ', 'DIA', 'IWM', 'VTI'
];

const MAX_POSITIONS = 8;
const MAX_TRADE = 200;
const TAKE_PROFIT_PCT = 0.01;
const STOP_LOSS_PCT = 0.005;
const COOLDOWN_MS = 5 * 60 * 1000;

let positions = {};
let dailyIndicators = {};
let minuteIndicators = {};
let cooldowns = {};
let pingInterval = null;
let isTrading = false;
let isSubscribed = false;

async function loadExistingPositions() {
  try {
    const res = await fetch(`${BASE_URL}/v2/positions`, {
      headers: {
        'APCA-API-KEY-ID': API_KEY,
        'APCA-API-SECRET-KEY': SECRET_KEY,
      }
    });
    const existing = await res.json();
    if (Array.isArray(existing)) {
      positions = {};
      for (const p of existing) {
        positions[p.symbol] = {
          entryPrice: parseFloat(p.avg_entry_price),
          shares: parseFloat(p.qty)
        };
        console.log(`📋 Loaded existing position: ${p.symbol} | ${p.qty} shares @ $${p.avg_entry_price}`);
      }
    }
    console.log(`✅ Loaded ${Object.keys(positions).length} existing positions`);
  } catch (e) {
    console.error('Failed to load existing positions:', e.message);
  }
}

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

function calculateIndicators(closes) {
  if (closes.length < 20) return null;
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

async function loadDailyIndicators(symbol) {
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
    const bars = data.bars || [];
    if (bars.length < 20) return null;
    const closes = bars.map(b => b.c);
    return calculateIndicators(closes);
  } catch (e) {
    return null;
  }
}

async function loadMinuteIndicators(symbol) {
  try {
    const res = await fetch(
      `${DATA_URL}/v2/stocks/${symbol}/bars?timeframe=1Min&limit=50`,
      {
        headers: {
          'APCA-API-KEY-ID': API_KEY,
          'APCA-API-SECRET-KEY': SECRET_KEY,
        }
      }
    );
    const data = await res.json();
    const bars = data.bars || [];
    if (bars.length < 20) return null;
    const closes = bars.map(b => b.c);
    return calculateIndicators(closes);
  } catch (e) {
    return null;
  }
}

async function loadAllDailyIndicators() {
  console.log('📊 Loading daily indicators for all stocks...');
  for (const symbol of WATCHLIST) {
    const data = await loadDailyIndicators(symbol);
    if (data) dailyIndicators[symbol] = data;
  }
  console.log(`✅ Daily indicators loaded for ${Object.keys(dailyIndicators).length} stocks!`);
}

async function refreshMinuteIndicators() {
  for (const symbol of WATCHLIST) {
    const data = await loadMinuteIndicators(symbol);
    if (data) minuteIndicators[symbol] = data;
  }
  console.log(`🔄 Minute indicators refreshed for ${Object.keys(minuteIndicators).length} stocks`);
}

function scheduleRefresh() {
  setInterval(async () => {
    await loadAllDailyIndicators();
    await loadExistingPositions();
  }, 30 * 60 * 1000);

  setInterval(async () => {
    await refreshMinuteIndicators();
  }, 2 * 60 * 1000);
}

function isOnCooldown(symbol) {
  if (!cooldowns[symbol]) return false;
  return Date.now() - cooldowns[symbol] < COOLDOWN_MS;
}

async function analyzeAndTrade(symbol, currentPrice) {
  if (isTrading) return;

  const daily = dailyIndicators[symbol];
  const minute = minuteIndicators[symbol];
  if (!daily) return;

  const dailyBullish = daily.ma10 > daily.ma20;
  const dailyRSIOk = daily.rsi < 70 && daily.rsi > 30;
  const minuteBullish = minute ? minute.ma10 > minute.ma20 : true;
  const minuteRSIOk = minute ? minute.rsi < 70 : true;

  if (positions[symbol]) {
    const position = positions[symbol];
    const pnlPct = (currentPrice - position.entryPrice) / position.entryPrice;

    if (pnlPct >= TAKE_PROFIT_PCT) {
      isTrading = true;
      console.log(`🟢 TAKE PROFIT: Selling ${symbol} at $${currentPrice} (+${(pnlPct*100).toFixed(2)}%)`);
      await placeOrder(symbol, position.shares, 'sell');
      await logTrade({
        symbol, action: 'SELL', price: currentPrice,
        shares: position.shares, outcome: 'WIN',
        profit_loss: ((currentPrice - position.entryPrice) * position.shares).toFixed(2),
      });
      delete positions[symbol];
      cooldowns[symbol] = Date.now();
      isTrading = false;
    } else if (pnlPct <= -STOP_LOSS_PCT) {
      isTrading = true;
      console.log(`🔴 STOP LOSS: Selling ${symbol} at $${currentPrice} (${(pnlPct*100).toFixed(2)}%)`);
      await placeOrder(symbol, position.shares, 'sell');
      await logTrade({
        symbol, action: 'SELL', price: currentPrice,
        shares: position.shares, outcome: 'LOSS',
        profit_loss: ((currentPrice - position.entryPrice) * position.shares).toFixed(2),
      });
      delete positions[symbol];
      cooldowns[symbol] = Date.now();
      isTrading = false;
    }
    return;
  }

  if (isOnCooldown(symbol)) return;
  if (Object.keys(positions).length >= MAX_POSITIONS) return;

  if (dailyBullish && dailyRSIOk && minuteBullish && minuteRSIOk) {
    const shares = Math.floor(MAX_TRADE / currentPrice);
    if (shares < 1) return;

    isTrading = true;
    console.log(`📈 BUY: ${symbol} at $${currentPrice} | Daily RSI: ${daily.rsi.toFixed(2)} | Minute RSI: ${minute ? minute.rsi.toFixed(2) : 'N/A'} | Positions: ${Object.keys(positions).length + 1}/${MAX_POSITIONS}`);
    await placeOrder(symbol, shares, 'buy');
    positions[symbol] = { entryPrice: currentPrice, shares };
    await logTrade({
      symbol, action: 'BUY', price: currentPrice, shares,
      rsi: parseFloat(daily.rsi.toFixed(2)),
      ma10: parseFloat(daily.ma10.toFixed(2)),
      ma20: parseFloat(daily.ma20.toFixed(2)),
    });
    isTrading = false;
  }
}

function startBot() {
  console.log('🤖 Trading bot starting with multi-timeframe analysis...');
  isSubscribed = false;

  const ws = new WebSocket('wss://stream.data.alpaca.markets/v2/iex');

  loadAllDailyIndicators().then(() => refreshMinuteIndicators());
  loadExistingPositions();
  scheduleRefresh();

  ws.on('open', () => {
    console.log('✅ Connected to Alpaca IEX WebSocket!');
    ws.send(JSON.stringify({ action: 'auth', key: API_KEY, secret: SECRET_KEY }));

    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        // Resubscribe if not subscribed
        if (!isSubscribed) {
          console.log('🔄 Resubscribing...');
          ws.send(JSON.stringify({
            action: 'subscribe',
            trades: WATCHLIST,
          }));
        }
      }
    }, 30000);
  });

  ws.on('message', async (data) => {
    const messages = JSON.parse(data);
    for (const msg of messages) {
      console.log('📨', JSON.stringify(msg).substring(0, 100));

      if (msg.T === 'success' && msg.msg === 'authenticated') {
        console.log('✅ Authenticated! Subscribing to live trades...');
        ws.send(JSON.stringify({
          action: 'subscribe',
          trades: WATCHLIST,
        }));
      }

      if (msg.T === 'subscription') {
        isSubscribed = true;
        console.log('✅ Subscribed! Bot is now trading live!');
      }

      if (msg.T === 'error') {
        console.error('❌ Alpaca error:', JSON.stringify(msg));
      }

      if (msg.T === 't') {
        const symbol = msg.S;
        const price = msg.p;
        await analyzeAndTrade(symbol, price);
      }
    }
  });

  ws.on('pong', () => {});

  ws.on('error', (err) => {
    console.error('❌ WebSocket error:', err.message);
  });

  ws.on('close', (code, reason) => {
    console.log(`Disconnected (${code}), reconnecting in 5 seconds...`);
    if (pingInterval) clearInterval(pingInterval);
    isSubscribed = false;
    setTimeout(startBot, 5000);
  });
}

startBot();
