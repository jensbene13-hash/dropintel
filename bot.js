const WebSocket = require('ws');
const fetch = require('node-fetch');

const API_KEY = process.env.ALPACA_API_KEY;
const SECRET_KEY = process.env.ALPACA_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const BASE_URL = 'https://paper-api.alpaca.markets';
const DATA_URL = 'https://data.alpaca.markets';

const WATCHLIST = [
  'AAPL', 'NVDA', 'MSFT', 'META', 'GOOGL', 'TSLA', 'AMZN', 'AMD', 'CRM', 'INTC',
  'JPM', 'BAC', 'GS', 'V', 'MA', 'WFC',
  'JNJ', 'PFE', 'UNH', 'LLY',
  'XOM', 'CVX', 'COP', 'EOG',
  'SPY', 'QQQ', 'DIA', 'IWM', 'VTI', 'XLF'
];

const MAX_POSITIONS_MARKET = 8;
const MAX_POSITIONS_EXTENDED = 3;
const MAX_TRADE = 200;
const STOP_LOSS_PCT = 0.005;
const TRAILING_STOP_PCT = 0.005;
const COOLDOWN_MS = 5 * 60 * 1000;
const VOLUME_MULTIPLIER = 1.2;
const EXTENDED_VOLUME_MULTIPLIER = 2.0;

let positions = {};
let dailyIndicators = {};
let minuteIndicators = {};
let volumeData = {};
let cooldowns = {};
let pingInterval = null;
let isTrading = false;
let isSubscribed = false;

function getMarketSession() {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const utcTime = utcHour * 60 + utcMinute;
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return 'closed';
  if (utcTime >= 870 && utcTime < 1260) return 'market';
  if (utcTime >= 1260 && utcTime < 1440) return 'after_hours';
  if (utcTime >= 540 && utcTime < 870) return 'pre_market';
  return 'overnight';
}

function getMaxPositions() {
  const session = getMarketSession();
  if (session === 'market') return MAX_POSITIONS_MARKET;
  if (session === 'pre_market' || session === 'after_hours') return MAX_POSITIONS_EXTENDED;
  return 0;
}

function getVolumeMultiplier() {
  const session = getMarketSession();
  if (session === 'market') return VOLUME_MULTIPLIER;
  return EXTENDED_VOLUME_MULTIPLIER;
}

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
          shares: parseFloat(p.qty),
          highestPrice: parseFloat(p.current_price || p.avg_entry_price),
          trailingStop: parseFloat(p.avg_entry_price) * (1 - TRAILING_STOP_PCT),
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

async function placeOrder(symbol, qty, side, extendedHours = false) {
  const body = {
    symbol,
    qty,
    side,
    type: extendedHours ? 'limit' : 'market',
    time_in_force: 'day',
    extended_hours: extendedHours,
  };
  const res = await fetch(`${BASE_URL}/v2/orders`, {
    method: 'POST',
    headers: {
      'APCA-API-KEY-ID': API_KEY,
      'APCA-API-SECRET-KEY': SECRET_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body)
  });
  return res.json();
}

// Calculate EMA (Exponential Moving Average)
function calculateEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

// Calculate MACD
function calculateMACD(closes) {
  if (closes.length < 26) return null;
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  if (!ema12 || !ema26) return null;
  const macdLine = ema12 - ema26;

  // Signal line = 9 period EMA of MACD
  const macdValues = [];
  for (let i = 26; i <= closes.length; i++) {
    const e12 = calculateEMA(closes.slice(0, i), 12);
    const e26 = calculateEMA(closes.slice(0, i), 26);
    if (e12 && e26) macdValues.push(e12 - e26);
  }
  const signalLine = calculateEMA(macdValues, 9);
  const histogram = macdLine - (signalLine || 0);

  return {
    macd: macdLine,
    signal: signalLine,
    histogram,
    bullish: macdLine > signalLine && histogram > 0,
  };
}

function calculateIndicators(closes) {
  if (closes.length < 26) return null;
  const ma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const changes = closes.slice(-15).map((c, i, arr) => i === 0 ? 0 : c - arr[i - 1]);
  const gains = changes.map(c => c > 0 ? c : 0);
  const losses = changes.map(c => c < 0 ? Math.abs(c) : 0);
  const avgGain = gains.reduce((a, b) => a + b, 0) / 14;
  const avgLoss = losses.reduce((a, b) => a + b, 0) / 14;
  const rs = avgGain / (avgLoss || 1);
  const rsi = 100 - (100 / (1 + rs));
  const macd = calculateMACD(closes);
  return { ma10, ma20, rsi, macd };
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
    if (bars.length < 26) return null;
    const closes = bars.map(b => b.c);
    const volumes = bars.map(b => b.v);
    const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const indicators = calculateIndicators(closes);
    if (indicators) volumeData[symbol] = { avgVolume };
    return indicators;
  } catch (e) {
    return null;
  }
}

async function loadMinuteIndicators(symbol) {
  try {
    const res = await fetch(
      `${DATA_URL}/v2/stocks/${symbol}/bars?timeframe=1Min&limit=60`,
      {
        headers: {
          'APCA-API-KEY-ID': API_KEY,
          'APCA-API-SECRET-KEY': SECRET_KEY,
        }
      }
    );
    const data = await res.json();
    const bars = data.bars || [];
    if (bars.length < 26) return null;
    const closes = bars.map(b => b.c);
    const volumes = bars.map(b => b.v);
    const currentVolume = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const indicators = calculateIndicators(closes);
    if (indicators) {
      if (!volumeData[symbol]) volumeData[symbol] = {};
      volumeData[symbol].currentVolume = currentVolume;
    }
    return indicators;
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

function hasVolumeConfirmation(symbol) {
  const vol = volumeData[symbol];
  if (!vol || !vol.avgVolume || !vol.currentVolume) return true;
  return vol.currentVolume >= vol.avgVolume * getVolumeMultiplier();
}

async function analyzeAndTrade(symbol, currentPrice) {
  if (isTrading) return;

  const session = getMarketSession();
  const daily = dailyIndicators[symbol];
  const minute = minuteIndicators[symbol];
  if (!daily) return;

  const dailyBullish = daily.ma10 > daily.ma20;
  const dailyRSIOk = daily.rsi < 70 && daily.rsi > 30;
  const dailyMACDBullish = daily.macd ? daily.macd.bullish : true;

  const minuteBullish = minute ? minute.ma10 > minute.ma20 : true;
  const minuteRSIOk = minute ? minute.rsi < 70 : true;
  const minuteMACDBullish = minute?.macd ? minute.macd.bullish : true;

  // Always manage existing positions
  if (positions[symbol]) {
    const position = positions[symbol];
    const pnlPct = (currentPrice - position.entryPrice) / position.entryPrice;

    if (currentPrice > position.highestPrice) {
      position.highestPrice = currentPrice;
      position.trailingStop = currentPrice * (1 - TRAILING_STOP_PCT);
      console.log(`📊 ${symbol} new high $${currentPrice} | Trailing stop: $${position.trailingStop.toFixed(2)}`);
    }

    if (currentPrice <= position.trailingStop && pnlPct > 0) {
      isTrading = true;
      console.log(`🟢 TRAILING STOP: Selling ${symbol} at $${currentPrice} (+${(pnlPct*100).toFixed(2)}%) [${session}]`);
      await placeOrder(symbol, position.shares, 'sell', session !== 'market');
      await logTrade({
        symbol, action: 'SELL', price: currentPrice,
        shares: position.shares, outcome: 'WIN',
        profit_loss: ((currentPrice - position.entryPrice) * position.shares).toFixed(2),
      });
      delete positions[symbol];
      cooldowns[symbol] = Date.now();
      isTrading = false;
      return;
    }

    if (pnlPct <= -STOP_LOSS_PCT) {
      isTrading = true;
      console.log(`🔴 STOP LOSS: Selling ${symbol} at $${currentPrice} (${(pnlPct*100).toFixed(2)}%) [${session}]`);
      await placeOrder(symbol, position.shares, 'sell', session !== 'market');
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

  const maxPositions = getMaxPositions();
  if (maxPositions === 0) return;
  if (isOnCooldown(symbol)) return;
  if (Object.keys(positions).length >= maxPositions) return;

  const volumeOk = hasVolumeConfirmation(symbol);
  const rsiLimit = session === 'market' ? 70 : 65;
  const strictDailyRSIOk = daily.rsi < rsiLimit && daily.rsi > 30;

  // All 4 signals must agree: MA + RSI + MACD + Volume
  if (dailyBullish && strictDailyRSIOk && dailyMACDBullish && minuteBullish && minuteRSIOk && minuteMACDBullish && volumeOk) {
    const shares = Math.floor(MAX_TRADE / currentPrice);
    if (shares < 1) return;

    isTrading = true;
    console.log(`📈 BUY: ${symbol} at $${currentPrice} | RSI: ${daily.rsi.toFixed(2)} | MACD: ${daily.macd ? daily.macd.histogram.toFixed(4) : 'N/A'} | Session: ${session} | Positions: ${Object.keys(positions).length + 1}/${maxPositions}`);
    await placeOrder(symbol, shares, 'buy', session !== 'market');
    positions[symbol] = {
      entryPrice: currentPrice,
      shares,
      highestPrice: currentPrice,
      trailingStop: currentPrice * (1 - TRAILING_STOP_PCT),
    };
    await logTrade({
      symbol, action: 'BUY', price: currentPrice, shares,
      rsi: parseFloat(daily.rsi.toFixed(2)),
      ma10: parseFloat(daily.ma10.toFixed(2)),
      ma20: parseFloat(daily.ma20.toFixed(2)),
      score: daily.macd ? parseFloat(daily.macd.histogram.toFixed(4)) : 0,
    });
    isTrading = false;
  }
}

function startBot() {
  console.log('🤖 Trading bot starting — 24/7 with MACD + Volume + Trailing Stops...');
  isSubscribed = false;

  const session = getMarketSession();
  console.log(`📅 Current session: ${session}`);

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
        if (!isSubscribed) {
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
      if (msg.T === 'success' && msg.msg === 'authenticated') {
        console.log('✅ Authenticated! Subscribing to live trades...');
        ws.send(JSON.stringify({
          action: 'subscribe',
          trades: WATCHLIST,
        }));
      }

      if (msg.T === 'subscription') {
        isSubscribed = true;
        console.log('✅ Subscribed! Bot running with MA + RSI + MACD + Volume + Trailing Stops!');
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
