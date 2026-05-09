const WebSocket = require('ws');
const fetch = require('node-fetch');

const API_KEY = process.env.ALPACA_API_KEY;
const SECRET_KEY = process.env.ALPACA_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const BASE_URL = 'https://paper-api.alpaca.markets';
const DATA_URL = 'https://data.alpaca.markets';

const WATCHLIST = [
  'AAPL', 'NVDA', 'MSFT', 'META', 'GOOGL', 'TSLA', 'AMZN', 'AMD',
  'JPM', 'GS', 'V', 'MA',
  'SPY', 'QQQ', 'IWM'
];

// ── CONSTANTS ─────────────────────────────────────────────────────
const OPENING_RANGE_MINUTES = 15;
const MIN_BREAKOUT_VOLUME_MULT = 1.1;  // Loosened from 1.5x to 1.1x
const STOP_LOSS_MULT = 1.0;
const TAKE_PROFIT_MULT = 2.0;
const MAX_POSITIONS = 4;
const MAX_DAILY_TRADES = 10;
const MAX_DAILY_LOSS_PCT = 0.015;
const POSITION_SIZE_USD = 200;
const COOLDOWN_MS = 3 * 60 * 1000;
const AVOID_LOSS_THRESHOLD = 4;
const AVOID_RESET_HOURS = 24;
const MIN_RANGE_SIZE_PCT = 0.001; // Range must be at least 0.1% of price

const MARKET_OPEN_UTC = 14 * 60 + 30;
const OPENING_RANGE_END_UTC = MARKET_OPEN_UTC + OPENING_RANGE_MINUTES;
const MARKET_CLOSE_UTC = 21 * 60;

// ── STATE ─────────────────────────────────────────────────────────
let openingRanges = {};
let vwapData = {};
let tickVolumes = {};
let avgVolumes = {};
let positions = {};
let shortPositions = {};
let cooldowns = {};
let tradingLocks = {};
let todayTradeCount = 0;
let dailyTradingHalted = false;
let startingPortfolioValue = null;
let avoidSymbols = {};
let pingInterval = null;
let isSubscribed = false;
let marketOpenToday = false;
let lastVwapCross = {}; // Track last VWAP cross direction per symbol

function getUTCMinutes() {
  const now = new Date();
  return now.getUTCHours() * 60 + now.getUTCMinutes();
}

function isMarketOpen() {
  const day = new Date().getUTCDay();
  if (day === 0 || day === 6) return false;
  const t = getUTCMinutes();
  return t >= MARKET_OPEN_UTC && t < MARKET_CLOSE_UTC;
}

function isOpeningRangeWindow() {
  const t = getUTCMinutes();
  return t >= MARKET_OPEN_UTC && t < OPENING_RANGE_END_UTC;
}

function isSymbolLocked(s) { return tradingLocks[s] === true; }
function lockSymbol(s) { tradingLocks[s] = true; }
function unlockSymbol(s) { tradingLocks[s] = false; }

function isAvoided(symbol) {
  if (!avoidSymbols[symbol]) return false;
  const elapsed = Date.now() - avoidSymbols[symbol];
  if (elapsed > AVOID_RESET_HOURS * 60 * 60 * 1000) {
    delete avoidSymbols[symbol];
    return false;
  }
  return true;
}

function isOnCooldown(symbol) {
  if (!cooldowns[symbol]) return false;
  return Date.now() - cooldowns[symbol] < COOLDOWN_MS;
}

// ── VWAP ──────────────────────────────────────────────────────────
function updateVWAP(symbol, price, volume) {
  if (!vwapData[symbol]) vwapData[symbol] = { sumPV: 0, sumV: 0, vwap: price, lastPrice: price };
  const prev = vwapData[symbol];
  prev.lastPrice = prev.vwap ? prev.vwap : price;
  prev.sumPV += price * volume;
  prev.sumV += volume;
  if (prev.sumV > 0) prev.vwap = prev.sumPV / prev.sumV;
  return prev.vwap;
}

function getVWAP(symbol) {
  return vwapData[symbol]?.vwap || null;
}

// ── OPENING RANGE ─────────────────────────────────────────────────
function updateOpeningRange(symbol, price, volume) {
  if (!openingRanges[symbol]) {
    openingRanges[symbol] = { high: price, low: price, volume: 0, established: false };
  }
  const range = openingRanges[symbol];
  if (price > range.high) range.high = price;
  if (price < range.low) range.low = price;
  range.volume += volume;
}

function markOpeningRangeComplete() {
  for (const symbol of WATCHLIST) {
    if (openingRanges[symbol] && !openingRanges[symbol].established) {
      openingRanges[symbol].established = true;
      const r = openingRanges[symbol];
      const size = r.high - r.low;
      const sizePct = (size / r.low * 100).toFixed(2);
      console.log(`📏 ${symbol} range: $${r.low.toFixed(2)}-$${r.high.toFixed(2)} | Size: $${size.toFixed(2)} (${sizePct}%)`);
    }
  }
}

// ── VOLUME ────────────────────────────────────────────────────────
function updateTickVolume(symbol, volume) {
  if (!tickVolumes[symbol]) tickVolumes[symbol] = [];
  tickVolumes[symbol].push(volume);
  if (tickVolumes[symbol].length > 20) tickVolumes[symbol].shift();
}

function hasBreakoutVolume(symbol, currentVolume) {
  const avg = avgVolumes[symbol];
  if (!avg) return true;
  return currentVolume >= avg * MIN_BREAKOUT_VOLUME_MULT;
}

function getRecentAvgVolume(symbol) {
  const vols = tickVolumes[symbol];
  if (!vols || vols.length < 3) return 0;
  return vols.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, vols.length);
}

// ── LOAD VOLUMES ──────────────────────────────────────────────────
async function loadAverageVolumes() {
  console.log('📊 Loading average volumes...');
  for (const symbol of WATCHLIST) {
    try {
      const res = await fetch(
        `${DATA_URL}/v2/stocks/${symbol}/bars?timeframe=1Day&limit=20&start=2025-01-01`,
        { headers: { 'APCA-API-KEY-ID': API_KEY, 'APCA-API-SECRET-KEY': SECRET_KEY } }
      );
      const data = await res.json();
      const bars = data.bars || [];
      if (bars.length > 0) {
        const totalVol = bars.reduce((sum, b) => sum + b.v, 0);
        avgVolumes[symbol] = (totalVol / bars.length) / 390;
      }
    } catch (e) { console.error(`Volume load failed ${symbol}:`, e.message); }
  }
  console.log(`✅ Volumes loaded for ${Object.keys(avgVolumes).length} stocks`);
}

// ── DAILY RESET ───────────────────────────────────────────────────
function resetDailyState() {
  console.log('🔔 Market opening — resetting daily state...');
  openingRanges = {};
  vwapData = {};
  tickVolumes = {};
  lastVwapCross = {};
  todayTradeCount = 0;
  dailyTradingHalted = false;
  startingPortfolioValue = null;
  marketOpenToday = true;
  for (const symbol of Object.keys(avoidSymbols)) {
    if (Date.now() - avoidSymbols[symbol] > AVOID_RESET_HOURS * 60 * 60 * 1000) {
      delete avoidSymbols[symbol];
    }
  }
}

// ── PORTFOLIO ─────────────────────────────────────────────────────
async function checkDailyLossLimit() {
  try {
    const res = await fetch(`${BASE_URL}/v2/account`, {
      headers: { 'APCA-API-KEY-ID': API_KEY, 'APCA-API-SECRET-KEY': SECRET_KEY }
    });
    const account = await res.json();
    const currentValue = parseFloat(account.portfolio_value);
    if (!startingPortfolioValue) {
      startingPortfolioValue = currentValue;
      console.log(`💰 Starting value: $${startingPortfolioValue.toFixed(2)}`);
      return;
    }
    const lossPct = (startingPortfolioValue - currentValue) / startingPortfolioValue;
    if (lossPct >= MAX_DAILY_LOSS_PCT && !dailyTradingHalted) {
      dailyTradingHalted = true;
      console.log(`🛑 DOWN ${(lossPct*100).toFixed(2)}% — halting trades!`);
    }
  } catch (e) { console.error('Portfolio check failed:', e.message); }
}

// ── ORDERS ────────────────────────────────────────────────────────
async function placeOrder(symbol, qty, side) {
  try {
    const res = await fetch(`${BASE_URL}/v2/orders`, {
      method: 'POST',
      headers: {
        'APCA-API-KEY-ID': API_KEY,
        'APCA-API-SECRET-KEY': SECRET_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ symbol, qty, side, type: 'market', time_in_force: 'day' })
    });
    return res.json();
  } catch (e) { console.error(`Order failed ${symbol}:`, e.message); }
}

// ── SUPABASE ──────────────────────────────────────────────────────
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
  } catch (e) { console.error('Log trade failed:', e.message); }
}

async function updateOutcome(symbol, action, outcome, profitLoss) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/trades?symbol=eq.${symbol}&action=eq.${action}&outcome=is.null&order=created_at.desc&limit=1`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const trades = await res.json();
    if (trades && trades.length > 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/trades?id=eq.${trades[0].id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ outcome, profit_loss: parseFloat(profitLoss) })
      });
      console.log(`📝 ${symbol} ${action} → ${outcome} | P&L: $${profitLoss}`);
    }
  } catch (e) { console.error('Update outcome failed:', e.message); }
}

// ── LOAD POSITIONS ────────────────────────────────────────────────
async function loadExistingPositions() {
  try {
    const res = await fetch(`${BASE_URL}/v2/positions`, {
      headers: { 'APCA-API-KEY-ID': API_KEY, 'APCA-API-SECRET-KEY': SECRET_KEY }
    });
    const existing = await res.json();
    if (Array.isArray(existing)) {
      positions = {};
      shortPositions = {};
      for (const p of existing) {
        if (p.side === 'short') {
          shortPositions[p.symbol] = {
            entryPrice: parseFloat(p.avg_entry_price),
            shares: Math.abs(parseFloat(p.qty)),
            stopLoss: parseFloat(p.avg_entry_price) * 1.01,
            takeProfit: parseFloat(p.avg_entry_price) * 0.98,
            strategy: 'loaded',
          };
        } else {
          positions[p.symbol] = {
            entryPrice: parseFloat(p.avg_entry_price),
            shares: parseFloat(p.qty),
            stopLoss: parseFloat(p.avg_entry_price) * 0.99,
            takeProfit: parseFloat(p.avg_entry_price) * 1.02,
            strategy: 'loaded',
          };
        }
      }
      console.log(`✅ Loaded ${Object.keys(positions).length} long, ${Object.keys(shortPositions).length} short`);
    }
  } catch (e) { console.error('Load positions failed:', e.message); }
}

// ── MANAGE POSITIONS ──────────────────────────────────────────────
async function managePosition(symbol, currentPrice) {
  if (positions[symbol] && !isSymbolLocked(symbol)) {
    const pos = positions[symbol];
    const pnl = (currentPrice - pos.entryPrice) * pos.shares;
    const pnlPct = (currentPrice - pos.entryPrice) / pos.entryPrice;

    if (currentPrice >= pos.takeProfit) {
      lockSymbol(symbol);
      console.log(`🟢 TAKE PROFIT: ${symbol} @ $${currentPrice.toFixed(2)} (+${(pnlPct*100).toFixed(2)}%) $${pnl.toFixed(2)} [${pos.strategy}]`);
      await placeOrder(symbol, pos.shares, 'sell');
      await updateOutcome(symbol, 'BUY', 'WIN', pnl.toFixed(2));
      delete positions[symbol];
      cooldowns[symbol] = Date.now();
      unlockSymbol(symbol);
      return;
    }

    if (currentPrice <= pos.stopLoss) {
      lockSymbol(symbol);
      console.log(`🔴 STOP LOSS: ${symbol} @ $${currentPrice.toFixed(2)} (${(pnlPct*100).toFixed(2)}%) $${pnl.toFixed(2)} [${pos.strategy}]`);
      await placeOrder(symbol, pos.shares, 'sell');
      await updateOutcome(symbol, 'BUY', 'LOSS', pnl.toFixed(2));
      delete positions[symbol];
      cooldowns[symbol] = Date.now();
      unlockSymbol(symbol);
      return;
    }

    // Trailing stop — move up as price rises
    if (pnlPct > 0.008) {
      const newStop = currentPrice * 0.993;
      if (newStop > pos.stopLoss) pos.stopLoss = newStop;
    }
  }

  if (shortPositions[symbol] && !isSymbolLocked(symbol)) {
    const pos = shortPositions[symbol];
    const pnl = (pos.entryPrice - currentPrice) * pos.shares;
    const pnlPct = (pos.entryPrice - currentPrice) / pos.entryPrice;

    if (currentPrice <= pos.takeProfit) {
      lockSymbol(symbol);
      console.log(`🟢 SHORT PROFIT: ${symbol} @ $${currentPrice.toFixed(2)} (+${(pnlPct*100).toFixed(2)}%) $${pnl.toFixed(2)} [${pos.strategy}]`);
      await placeOrder(symbol, pos.shares, 'buy');
      await updateOutcome(symbol, 'SHORT', 'WIN', pnl.toFixed(2));
      delete shortPositions[symbol];
      cooldowns[symbol] = Date.now();
      unlockSymbol(symbol);
      return;
    }

    if (currentPrice >= pos.stopLoss) {
      lockSymbol(symbol);
      console.log(`🔴 SHORT STOP: ${symbol} @ $${currentPrice.toFixed(2)} (${(pnlPct*100).toFixed(2)}%) $${pnl.toFixed(2)} [${pos.strategy}]`);
      await placeOrder(symbol, pos.shares, 'buy');
      await updateOutcome(symbol, 'SHORT', 'LOSS', pnl.toFixed(2));
      delete shortPositions[symbol];
      cooldowns[symbol] = Date.now();
      unlockSymbol(symbol);
      return;
    }

    // Trailing stop for shorts
    if (pnlPct > 0.008) {
      const newStop = currentPrice * 1.007;
      if (newStop < pos.stopLoss) pos.stopLoss = newStop;
    }
  }
}

// ── ENTER TRADE ───────────────────────────────────────────────────
async function enterLong(symbol, price, stopLoss, takeProfit, strategy) {
  const shares = Math.max(1, Math.floor(POSITION_SIZE_USD / price));
  lockSymbol(symbol);
  todayTradeCount++;
  console.log(`📈 LONG [${strategy}]: ${symbol} @ $${price.toFixed(2)} | Stop: $${stopLoss.toFixed(2)} | Target: $${takeProfit.toFixed(2)} | Trade ${todayTradeCount}/${MAX_DAILY_TRADES}`);
  await placeOrder(symbol, shares, 'buy');
  positions[symbol] = { entryPrice: price, shares, stopLoss, takeProfit, strategy };
  await logTrade({ symbol, action: 'BUY', price, shares, rsi: 0, ma10: getVWAP(symbol) || 0, ma20: 0, score: 0 });
  unlockSymbol(symbol);
}

async function enterShort(symbol, price, stopLoss, takeProfit, strategy) {
  const shares = Math.max(1, Math.floor(POSITION_SIZE_USD / price));
  lockSymbol(symbol);
  todayTradeCount++;
  console.log(`📉 SHORT [${strategy}]: ${symbol} @ $${price.toFixed(2)} | Stop: $${stopLoss.toFixed(2)} | Target: $${takeProfit.toFixed(2)} | Trade ${todayTradeCount}/${MAX_DAILY_TRADES}`);
  await placeOrder(symbol, shares, 'sell');
  shortPositions[symbol] = { entryPrice: price, shares, stopLoss, takeProfit, strategy };
  await logTrade({ symbol, action: 'SHORT', price, shares, rsi: 0, ma10: getVWAP(symbol) || 0, ma20: 0, score: 0 });
  unlockSymbol(symbol);
}

// ── MAIN LOGIC ────────────────────────────────────────────────────
async function analyzeAndTrade(symbol, price, volume) {
  if (!isMarketOpen()) return;
  if (isAvoided(symbol)) return;
  if (isSymbolLocked(symbol)) return;
  if (dailyTradingHalted) return;

  const vwap = updateVWAP(symbol, price, volume);
  updateTickVolume(symbol, volume);

  // Build opening range during first 15 min
  if (isOpeningRangeWindow()) {
    updateOpeningRange(symbol, price, volume);
    return;
  }

  // Manage existing positions
  await managePosition(symbol, price);

  const totalPositions = Object.keys(positions).length + Object.keys(shortPositions).length;
  if (totalPositions >= MAX_POSITIONS) return;
  if (todayTradeCount >= MAX_DAILY_TRADES) return;
  if (isOnCooldown(symbol)) return;
  if (positions[symbol] || shortPositions[symbol]) return;

  const range = openingRanges[symbol];
  if (!range || !range.established) return;

  const rangeSize = range.high - range.low;
  if (rangeSize < range.low * MIN_RANGE_SIZE_PCT) return; // Skip if range too tiny

  const stopDistance = rangeSize * STOP_LOSS_MULT;
  const targetDistance = rangeSize * TAKE_PROFIT_MULT;

  // ── STRATEGY 1: OPENING RANGE BREAKOUT ────────────────────────
  if (price > range.high && price > vwap && hasBreakoutVolume(symbol, volume)) {
    const rr = targetDistance / stopDistance;
    if (rr < 1.5) return;
    await enterLong(symbol, price, range.high - stopDistance, price + targetDistance, 'ORB');
    return;
  }

  if (price < range.low && price < vwap && hasBreakoutVolume(symbol, volume)) {
    const rr = targetDistance / stopDistance;
    if (rr < 1.5) return;
    await enterShort(symbol, price, range.low + stopDistance, price - targetDistance, 'ORB');
    return;
  }

  // ── STRATEGY 2: RANGE FADE (fade failed breakouts) ────────────
  // Price spikes above range but comes back down = short the failed breakout
  if (price < range.high && price > range.high * 0.998 && price < vwap) {
    const stop = range.high * 1.005;
    const target = range.low;
    const rr = (price - target) / (stop - price);
    if (rr >= 1.5) {
      await enterShort(symbol, price, stop, target, 'FADE');
      return;
    }
  }

  // Price drops below range but bounces back up = buy the failed breakdown
  if (price > range.low && price < range.low * 1.002 && price > vwap) {
    const stop = range.low * 0.995;
    const target = range.high;
    const rr = (target - price) / (price - stop);
    if (rr >= 1.5) {
      await enterLong(symbol, price, stop, target, 'FADE');
      return;
    }
  }

  // ── STRATEGY 3: VWAP RECROSS ──────────────────────────────────
  // Only after 10am EST (14:30 + 30min = UTC 15:00)
  const utcTime = getUTCMinutes();
  if (utcTime < OPENING_RANGE_END_UTC + 30) return;

  const prevVwapSide = lastVwapCross[symbol];
  const currentVwapSide = price > vwap ? 'above' : 'below';

  // Detect cross
  if (prevVwapSide && prevVwapSide !== currentVwapSide) {
    const recentVol = getRecentAvgVolume(symbol);
    const avgVol = avgVolumes[symbol] || 1;
    const hasVol = recentVol >= avgVol * 1.0; // Just needs average volume

    if (currentVwapSide === 'above' && hasVol) {
      // Crossed above VWAP — go long
      const stop = vwap * 0.994;
      const target = vwap * 1.012;
      const rr = (target - price) / (price - stop);
      if (rr >= 1.3) {
        await enterLong(symbol, price, stop, target, 'VWAP-X');
      }
    } else if (currentVwapSide === 'below' && hasVol) {
      // Crossed below VWAP — go short
      const stop = vwap * 1.006;
      const target = vwap * 0.988;
      const rr = (price - target) / (stop - price);
      if (rr >= 1.3) {
        await enterShort(symbol, price, stop, target, 'VWAP-X');
      }
    }
  }

  lastVwapCross[symbol] = currentVwapSide;
}

// ── SCHEDULE ──────────────────────────────────────────────────────
function scheduleJobs() {
  setInterval(checkDailyLossLimit, 5 * 60 * 1000);
  setInterval(loadAverageVolumes, 24 * 60 * 60 * 1000);

  setInterval(() => {
    const t = getUTCMinutes();
    const day = new Date().getUTCDay();
    if (day === 0 || day === 6) return;

    if (t === MARKET_OPEN_UTC && !marketOpenToday) {
      resetDailyState();
      checkDailyLossLimit();
    }

    if (t === OPENING_RANGE_END_UTC) {
      console.log('⏰ Opening range complete — watching for breakouts, fades, and VWAP crosses...');
      markOpeningRangeComplete();
    }

    if (t === MARKET_CLOSE_UTC) {
      marketOpenToday = false;
      console.log('🔔 Market closed — closing all positions...');
      for (const symbol of Object.keys(positions)) {
        const pos = positions[symbol];
        placeOrder(symbol, pos.shares, 'sell').then(() => {
          updateOutcome(symbol, 'BUY', 'LOSS', '0');
          delete positions[symbol];
        });
      }
      for (const symbol of Object.keys(shortPositions)) {
        const pos = shortPositions[symbol];
        placeOrder(symbol, pos.shares, 'buy').then(() => {
          updateOutcome(symbol, 'SHORT', 'LOSS', '0');
          delete shortPositions[symbol];
        });
      }
    }
  }, 60 * 1000);
}

// ── WEBSOCKET ─────────────────────────────────────────────────────
function startBot() {
  console.log('🤖 dropintel v3 — ORB + Range Fade + VWAP Cross');
  console.log(`📏 Opening range: first ${OPENING_RANGE_MINUTES} min`);
  console.log(`🎯 ORB: 2x target | 1x stop | VWAP-X: 1.2% target | 0.6% stop`);
  console.log(`📊 Volume: ${MIN_BREAKOUT_VOLUME_MULT}x average`);
  isSubscribed = false;

  const ws = new WebSocket('wss://stream.data.alpaca.markets/v2/iex');

  loadAverageVolumes();
  loadExistingPositions();
  scheduleJobs();

  ws.on('open', () => {
    console.log('✅ Connected!');
    ws.send(JSON.stringify({ action: 'auth', key: API_KEY, secret: SECRET_KEY }));
    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        if (!isSubscribed) ws.send(JSON.stringify({ action: 'subscribe', trades: WATCHLIST }));
      }
    }, 30000);
  });

  ws.on('message', async (data) => {
    const messages = JSON.parse(data);
    for (const msg of messages) {
      if (msg.T === 'success' && msg.msg === 'authenticated') {
        console.log('✅ Authenticated!');
        ws.send(JSON.stringify({ action: 'subscribe', trades: WATCHLIST }));
      }
      if (msg.T === 'subscription') {
        isSubscribed = true;
        console.log(`✅ Subscribed! 3 strategies active — ORB | Range Fade | VWAP Cross`);
      }
      if (msg.T === 'error') console.error('❌ Alpaca error:', JSON.stringify(msg));
      if (msg.T === 't') await analyzeAndTrade(msg.S, msg.p, msg.s || 0);
    }
  });

  ws.on('pong', () => {});
  ws.on('error', (err) => console.error('❌ WebSocket error:', err.message));
  ws.on('close', (code) => {
    console.log(`Disconnected (${code}), reconnecting in 5 seconds...`);
    if (pingInterval) clearInterval(pingInterval);
    isSubscribed = false;
    setTimeout(startBot, 5000);
  });
}

startBot();
