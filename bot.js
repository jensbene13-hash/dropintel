const WebSocket = require('ws');
const fetch = require('node-fetch');

const API_KEY = process.env.ALPACA_API_KEY;
const SECRET_KEY = process.env.ALPACA_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const BASE_URL = 'https://paper-api.alpaca.markets';
const DATA_URL = 'https://data.alpaca.markets';

// ── WATCHLIST ─────────────────────────────────────────────────────
const WATCHLIST = [
  'AAPL', 'NVDA', 'MSFT', 'META', 'GOOGL', 'TSLA', 'AMZN', 'AMD',
  'JPM', 'GS', 'V', 'MA',
  'SPY', 'QQQ', 'IWM'
];

// ── CONSTANTS ─────────────────────────────────────────────────────
const OPENING_RANGE_MINUTES = 15;       // First 15 min establishes range
const MIN_BREAKOUT_VOLUME_MULT = 1.5;   // Volume must be 1.5x average
const STOP_LOSS_MULT = 1.0;            // Stop = 1x opening range size below breakout
const TAKE_PROFIT_MULT = 2.0;          // Target = 2x opening range size
const MAX_POSITIONS = 3;               // Max 3 simultaneous positions
const MAX_DAILY_TRADES = 8;            // Max 8 trades per day
const MAX_DAILY_LOSS_PCT = 0.015;      // Halt if down 1.5%
const POSITION_SIZE_USD = 200;         // $200 per trade
const COOLDOWN_MS = 5 * 60 * 1000;    // 5 min cooldown per symbol
const AVOID_LOSS_THRESHOLD = 4;        // Avoid after 4 losses
const AVOID_RESET_HOURS = 24;

// UTC times
const MARKET_OPEN_UTC = 14 * 60 + 30;  // 9:30am EST
const OPENING_RANGE_END_UTC = MARKET_OPEN_UTC + OPENING_RANGE_MINUTES;
const MARKET_CLOSE_UTC = 21 * 60;      // 4:00pm EST

// ── STATE ─────────────────────────────────────────────────────────
let openingRanges = {};      // { symbol: { high, low, volume, established } }
let vwapData = {};           // { symbol: { sumPV, sumV, vwap } }
let tickVolumes = {};        // { symbol: [vol1, vol2, ...] }
let avgVolumes = {};         // { symbol: avgDailyVolume }
let positions = {};
let shortPositions = {};
let cooldowns = {};
let tradingLocks = {};
let todayTradeCount = 0;
let dailyTradingHalted = false;
let startingPortfolioValue = null;
let avoidSymbols = {};       // { symbol: timestamp }
let pingInterval = null;
let isSubscribed = false;
let marketOpenToday = false;

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

function isOpeningRangeComplete() {
  return getUTCMinutes() >= OPENING_RANGE_END_UTC;
}

function isSymbolLocked(s) { return tradingLocks[s] === true; }
function lockSymbol(s) { tradingLocks[s] = true; }
function unlockSymbol(s) { tradingLocks[s] = false; }

function isAvoided(symbol) {
  if (!avoidSymbols[symbol]) return false;
  const elapsed = Date.now() - avoidSymbols[symbol];
  if (elapsed > AVOID_RESET_HOURS * 60 * 60 * 1000) {
    delete avoidSymbols[symbol];
    console.log(`🔄 ${symbol} removed from avoid list`);
    return false;
  }
  return true;
}

function isOnCooldown(symbol) {
  if (!cooldowns[symbol]) return false;
  return Date.now() - cooldowns[symbol] < COOLDOWN_MS;
}

// ── VWAP CALCULATION ──────────────────────────────────────────────
function updateVWAP(symbol, price, volume) {
  if (!vwapData[symbol]) vwapData[symbol] = { sumPV: 0, sumV: 0, vwap: price };
  vwapData[symbol].sumPV += price * volume;
  vwapData[symbol].sumV += volume;
  if (vwapData[symbol].sumV > 0) {
    vwapData[symbol].vwap = vwapData[symbol].sumPV / vwapData[symbol].sumV;
  }
  return vwapData[symbol].vwap;
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
      console.log(`📏 ${symbol} opening range: $${r.low.toFixed(2)} - $${r.high.toFixed(2)} | Size: $${(r.high - r.low).toFixed(2)}`);
    }
  }
}

// ── VOLUME CHECK ──────────────────────────────────────────────────
function updateTickVolume(symbol, volume) {
  if (!tickVolumes[symbol]) tickVolumes[symbol] = [];
  tickVolumes[symbol].push(volume);
  if (tickVolumes[symbol].length > 20) tickVolumes[symbol].shift();
}

function hasBreakoutVolume(symbol, currentVolume) {
  const avg = avgVolumes[symbol];
  if (!avg) return true; // Allow if no baseline
  return currentVolume >= avg * MIN_BREAKOUT_VOLUME_MULT;
}

// ── LOAD AVERAGE VOLUMES ──────────────────────────────────────────
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
        // Convert daily volume to per-minute average
        avgVolumes[symbol] = (totalVol / bars.length) / 390;
      }
    } catch (e) { console.error(`Failed to load volume for ${symbol}:`, e.message); }
  }
  console.log(`✅ Loaded volumes for ${Object.keys(avgVolumes).length} stocks`);
}

// ── DAILY RESET ───────────────────────────────────────────────────
function resetDailyState() {
  console.log('🔔 Market opening — resetting daily state...');
  openingRanges = {};
  vwapData = {};
  tickVolumes = {};
  todayTradeCount = 0;
  dailyTradingHalted = false;
  startingPortfolioValue = null;
  marketOpenToday = true;
  // Refresh avoid list
  for (const symbol of Object.keys(avoidSymbols)) {
    if (Date.now() - avoidSymbols[symbol] > AVOID_RESET_HOURS * 60 * 60 * 1000) {
      delete avoidSymbols[symbol];
    }
  }
}

// ── PORTFOLIO CHECK ───────────────────────────────────────────────
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
      console.log(`🛑 DOWN ${(lossPct*100).toFixed(2)}% — halting new trades for today!`);
    }
  } catch (e) { console.error('Portfolio check failed:', e.message); }
}

// ── ORDER EXECUTION ───────────────────────────────────────────────
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
  } catch (e) {
    console.error(`Order failed ${symbol}:`, e.message);
  }
}

// ── SUPABASE LOGGING ──────────────────────────────────────────────
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

async function updateTradeOutcome(symbol, outcome, profitLoss) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/trades?symbol=eq.${symbol}&action=eq.BUY&outcome=is.null&order=created_at.desc&limit=1`,
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
      console.log(`📝 ${symbol} → ${outcome} | P&L: $${profitLoss}`);
    }
  } catch (e) { console.error('Update outcome failed:', e.message); }
}

async function updateShortOutcome(symbol, outcome, profitLoss) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/trades?symbol=eq.${symbol}&action=eq.SHORT&outcome=is.null&order=created_at.desc&limit=1`,
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
      console.log(`📝 ${symbol} SHORT → ${outcome} | P&L: $${profitLoss}`);
    }
  } catch (e) { console.error('Update short outcome failed:', e.message); }
}

// ── LOAD EXISTING POSITIONS ───────────────────────────────────────
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
          };
        } else {
          positions[p.symbol] = {
            entryPrice: parseFloat(p.avg_entry_price),
            shares: parseFloat(p.qty),
            stopLoss: parseFloat(p.avg_entry_price) * 0.99,
            takeProfit: parseFloat(p.avg_entry_price) * 1.02,
          };
        }
      }
      console.log(`✅ Loaded ${Object.keys(positions).length} long, ${Object.keys(shortPositions).length} short positions`);
    }
  } catch (e) { console.error('Load positions failed:', e.message); }
}

// ── MANAGE EXISTING POSITIONS ─────────────────────────────────────
async function managePosition(symbol, currentPrice) {
  // Manage LONG
  if (positions[symbol] && !isSymbolLocked(symbol)) {
    const pos = positions[symbol];
    const pnl = (currentPrice - pos.entryPrice) * pos.shares;
    const pnlPct = (currentPrice - pos.entryPrice) / pos.entryPrice;

    // Take profit
    if (currentPrice >= pos.takeProfit) {
      lockSymbol(symbol);
      console.log(`🟢 TAKE PROFIT: ${symbol} @ $${currentPrice.toFixed(2)} (+${(pnlPct*100).toFixed(2)}%) | P&L: +$${pnl.toFixed(2)}`);
      await placeOrder(symbol, pos.shares, 'sell');
      await updateTradeOutcome(symbol, 'WIN', pnl.toFixed(2));
      delete positions[symbol];
      cooldowns[symbol] = Date.now();
      unlockSymbol(symbol);
      return;
    }

    // Stop loss
    if (currentPrice <= pos.stopLoss) {
      lockSymbol(symbol);
      console.log(`🔴 STOP LOSS: ${symbol} @ $${currentPrice.toFixed(2)} (${(pnlPct*100).toFixed(2)}%) | P&L: $${pnl.toFixed(2)}`);
      await placeOrder(symbol, pos.shares, 'sell');
      await updateTradeOutcome(symbol, 'LOSS', pnl.toFixed(2));
      // Track losses for avoid list
      if (!avoidSymbols[symbol]) avoidSymbols[symbol] = { count: 0, timestamp: Date.now() };
      delete positions[symbol];
      cooldowns[symbol] = Date.now();
      unlockSymbol(symbol);
      return;
    }

    // Trailing stop — move stop up as price rises
    if (pnlPct > 0.008) {
      const newStop = currentPrice * 0.993;
      if (newStop > pos.stopLoss) {
        pos.stopLoss = newStop;
      }
    }
  }

  // Manage SHORT
  if (shortPositions[symbol] && !isSymbolLocked(symbol)) {
    const pos = shortPositions[symbol];
    const pnl = (pos.entryPrice - currentPrice) * pos.shares;
    const pnlPct = (pos.entryPrice - currentPrice) / pos.entryPrice;

    if (currentPrice <= pos.takeProfit) {
      lockSymbol(symbol);
      console.log(`🟢 SHORT PROFIT: ${symbol} @ $${currentPrice.toFixed(2)} (+${(pnlPct*100).toFixed(2)}%) | P&L: +$${pnl.toFixed(2)}`);
      await placeOrder(symbol, pos.shares, 'buy');
      await updateShortOutcome(symbol, 'WIN', pnl.toFixed(2));
      delete shortPositions[symbol];
      cooldowns[symbol] = Date.now();
      unlockSymbol(symbol);
      return;
    }

    if (currentPrice >= pos.stopLoss) {
      lockSymbol(symbol);
      console.log(`🔴 SHORT STOP: ${symbol} @ $${currentPrice.toFixed(2)} (${(pnlPct*100).toFixed(2)}%) | P&L: $${pnl.toFixed(2)}`);
      await placeOrder(symbol, pos.shares, 'buy');
      await updateShortOutcome(symbol, 'LOSS', pnl.toFixed(2));
      delete shortPositions[symbol];
      cooldowns[symbol] = Date.now();
      unlockSymbol(symbol);
      return;
    }

    // Trailing stop for shorts
    if (pnlPct > 0.008) {
      const newStop = currentPrice * 1.007;
      if (newStop < pos.stopLoss) {
        pos.stopLoss = newStop;
      }
    }
  }
}

// ── MAIN TRADING LOGIC ────────────────────────────────────────────
async function analyzeAndTrade(symbol, price, volume) {
  if (!isMarketOpen()) return;
  if (isAvoided(symbol)) return;
  if (isSymbolLocked(symbol)) return;
  if (dailyTradingHalted) return;

  // Update VWAP every tick
  const vwap = updateVWAP(symbol, price, volume);
  updateTickVolume(symbol, volume);

  // During opening range window — just build the range, don't trade
  if (isOpeningRangeWindow()) {
    updateOpeningRange(symbol, price, volume);
    return;
  }

  // Manage existing positions first
  await managePosition(symbol, price);

  // Don't enter new positions if at max
  const totalPositions = Object.keys(positions).length + Object.keys(shortPositions).length;
  if (totalPositions >= MAX_POSITIONS) return;
  if (todayTradeCount >= MAX_DAILY_TRADES) return;
  if (isOnCooldown(symbol)) return;
  if (positions[symbol] || shortPositions[symbol]) return;

  const range = openingRanges[symbol];
  if (!range || !range.established) return;

  const rangeSize = range.high - range.low;
  if (rangeSize <= 0) return;

  const stopDistance = rangeSize * STOP_LOSS_MULT;
  const targetDistance = rangeSize * TAKE_PROFIT_MULT;

  // ── LONG BREAKOUT ──────────────────────────────────────────────
  // Price breaks above opening range high
  // AND price is above VWAP (institutional buying)
  // AND volume is strong
  if (
    price > range.high &&
    price > vwap &&
    hasBreakoutVolume(symbol, volume)
  ) {
    const shares = Math.max(1, Math.floor(POSITION_SIZE_USD / price));
    const stopLoss = range.high - stopDistance;
    const takeProfit = price + targetDistance;
    const riskReward = targetDistance / stopDistance;

    // Only take if risk/reward is at least 1.5:1
    if (riskReward < 1.5) return;

    lockSymbol(symbol);
    todayTradeCount++;

    console.log(`📈 LONG BREAKOUT: ${symbol} @ $${price.toFixed(2)} | Range: $${range.low.toFixed(2)}-$${range.high.toFixed(2)} | VWAP: $${vwap.toFixed(2)} | Stop: $${stopLoss.toFixed(2)} | Target: $${takeProfit.toFixed(2)} | R:R ${riskReward.toFixed(1)}:1 | Trade ${todayTradeCount}/${MAX_DAILY_TRADES}`);

    await placeOrder(symbol, shares, 'buy');
    positions[symbol] = { entryPrice: price, shares, stopLoss, takeProfit };
    await logTrade({
      symbol, action: 'BUY', price, shares,
      rsi: 0, ma10: vwap, ma20: range.high, score: riskReward
    });
    unlockSymbol(symbol);
    return;
  }

  // ── SHORT BREAKOUT ─────────────────────────────────────────────
  // Price breaks below opening range low
  // AND price is below VWAP (institutional selling)
  // AND volume is strong
  if (
    price < range.low &&
    price < vwap &&
    hasBreakoutVolume(symbol, volume)
  ) {
    const shares = Math.max(1, Math.floor(POSITION_SIZE_USD / price));
    const stopLoss = range.low + stopDistance;
    const takeProfit = price - targetDistance;
    const riskReward = targetDistance / stopDistance;

    if (riskReward < 1.5) return;

    lockSymbol(symbol);
    todayTradeCount++;

    console.log(`📉 SHORT BREAKOUT: ${symbol} @ $${price.toFixed(2)} | Range: $${range.low.toFixed(2)}-$${range.high.toFixed(2)} | VWAP: $${vwap.toFixed(2)} | Stop: $${stopLoss.toFixed(2)} | Target: $${takeProfit.toFixed(2)} | R:R ${riskReward.toFixed(1)}:1 | Trade ${todayTradeCount}/${MAX_DAILY_TRADES}`);

    await placeOrder(symbol, shares, 'sell');
    shortPositions[symbol] = { entryPrice: price, shares, stopLoss, takeProfit };
    await logTrade({
      symbol, action: 'SHORT', price, shares,
      rsi: 0, ma10: vwap, ma20: range.low, score: riskReward
    });
    unlockSymbol(symbol);
    return;
  }

  // ── VWAP BOUNCE (secondary strategy) ──────────────────────────
  // After 10am — if price pulls back to VWAP and bounces in bull trend
  const utcTime = getUTCMinutes();
  const tenAmUTC = 14 * 60 + 30; // Use post opening range time

  if (utcTime > OPENING_RANGE_END_UTC + 15) {
    const distFromVWAP = (price - vwap) / vwap;

    // VWAP bounce long — price came down to VWAP from above and bouncing
    if (
      distFromVWAP > -0.001 && distFromVWAP < 0.002 &&
      price > range.low &&
      hasBreakoutVolume(symbol, volume)
    ) {
      const shares = Math.max(1, Math.floor(POSITION_SIZE_USD / price));
      const stopLoss = vwap * 0.993;
      const takeProfit = vwap * 1.015;
      const riskReward = (takeProfit - price) / (price - stopLoss);

      if (riskReward < 1.5) return;

      lockSymbol(symbol);
      todayTradeCount++;

      console.log(`💎 VWAP BOUNCE: ${symbol} @ $${price.toFixed(2)} | VWAP: $${vwap.toFixed(2)} | Stop: $${stopLoss.toFixed(2)} | Target: $${takeProfit.toFixed(2)} | R:R ${riskReward.toFixed(1)}:1 | Trade ${todayTradeCount}/${MAX_DAILY_TRADES}`);

      await placeOrder(symbol, shares, 'buy');
      positions[symbol] = { entryPrice: price, shares, stopLoss, takeProfit };
      await logTrade({
        symbol, action: 'BUY', price, shares,
        rsi: 0, ma10: vwap, ma20: range.high, score: riskReward
      });
      unlockSymbol(symbol);
    }
  }
}

// ── SCHEDULE ──────────────────────────────────────────────────────
function scheduleJobs() {
  // Check daily loss limit every 5 min
  setInterval(checkDailyLossLimit, 5 * 60 * 1000);

  // Reload volumes every day
  setInterval(loadAverageVolumes, 24 * 60 * 60 * 1000);

  // Every minute — check for market open/close events
  setInterval(() => {
    const t = getUTCMinutes();
    const day = new Date().getUTCDay();
    if (day === 0 || day === 6) return;

    // Market just opened
    if (t === MARKET_OPEN_UTC && !marketOpenToday) {
      resetDailyState();
      checkDailyLossLimit();
    }

    // Opening range just completed
    if (t === OPENING_RANGE_END_UTC) {
      console.log('⏰ Opening range complete — marking ranges and starting breakout watch...');
      markOpeningRangeComplete();
    }

    // Market just closed
    if (t === MARKET_CLOSE_UTC) {
      marketOpenToday = false;
      console.log('🔔 Market closed!');
      // Close any remaining positions
      for (const symbol of Object.keys(positions)) {
        console.log(`🔔 Closing end-of-day position: ${symbol}`);
        const pos = positions[symbol];
        placeOrder(symbol, pos.shares, 'sell').then(() => {
          delete positions[symbol];
        });
      }
      for (const symbol of Object.keys(shortPositions)) {
        console.log(`🔔 Closing end-of-day short: ${symbol}`);
        const pos = shortPositions[symbol];
        placeOrder(symbol, pos.shares, 'buy').then(() => {
          delete shortPositions[symbol];
        });
      }
    }
  }, 60 * 1000);
}

// ── WEBSOCKET ─────────────────────────────────────────────────────
function startBot() {
  console.log('🤖 dropintel v2 — VWAP + Opening Range Breakout Strategy');
  console.log(`📏 Opening range: first ${OPENING_RANGE_MINUTES} minutes`);
  console.log(`🎯 Take profit: ${TAKE_PROFIT_MULT}x range | Stop: ${STOP_LOSS_MULT}x range`);
  console.log(`📊 Volume filter: ${MIN_BREAKOUT_VOLUME_MULT}x average required`);

  isSubscribed = false;

  const ws = new WebSocket('wss://stream.data.alpaca.markets/v2/iex');

  loadAverageVolumes();
  loadExistingPositions();
  scheduleJobs();

  ws.on('open', () => {
    console.log('✅ Connected to Alpaca WebSocket!');
    ws.send(JSON.stringify({ action: 'auth', key: API_KEY, secret: SECRET_KEY }));

    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        if (!isSubscribed) {
          ws.send(JSON.stringify({ action: 'subscribe', trades: WATCHLIST }));
        }
      }
    }, 30000);
  });

  ws.on('message', async (data) => {
    const messages = JSON.parse(data);
    for (const msg of messages) {
      if (msg.T === 'success' && msg.msg === 'authenticated') {
        console.log('✅ Authenticated! Subscribing...');
        ws.send(JSON.stringify({ action: 'subscribe', trades: WATCHLIST }));
      }
      if (msg.T === 'subscription') {
        isSubscribed = true;
        console.log(`✅ Subscribed to ${WATCHLIST.length} symbols! Watching for opening range breakouts...`);
      }
      if (msg.T === 'error') {
        console.error('❌ Alpaca error:', JSON.stringify(msg));
      }
      if (msg.T === 't') {
        await analyzeAndTrade(msg.S, msg.p, msg.s || 0);
      }
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
