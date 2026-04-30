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

let botParams = {
  maxRSI: 70,
  minRSI: 30,
  avoidSymbols: [],
  preferredSymbols: [],
  bestHours: [],
  bestSectors: [],
};

const SECTOR_MAP = {
  'AAPL': 'tech', 'NVDA': 'tech', 'MSFT': 'tech', 'META': 'tech', 'GOOGL': 'tech',
  'TSLA': 'tech', 'AMZN': 'tech', 'AMD': 'tech', 'CRM': 'tech', 'INTC': 'tech',
  'JPM': 'finance', 'BAC': 'finance', 'GS': 'finance', 'V': 'finance', 'MA': 'finance',
  'WFC': 'finance', 'XLF': 'finance',
  'JNJ': 'healthcare', 'PFE': 'healthcare', 'UNH': 'healthcare', 'LLY': 'healthcare',
  'XOM': 'energy', 'CVX': 'energy', 'COP': 'energy', 'EOG': 'energy',
  'SPY': 'etf', 'QQQ': 'etf', 'DIA': 'etf', 'IWM': 'etf', 'VTI': 'etf',
};

let positions = {};
let dailyIndicators = {};
let minuteIndicators = {};
let volumeData = {};
let cooldowns = {};
let pingInterval = null;
let isTrading = false;
let isSubscribed = false;

async function loadLearnings() {
  try {
    console.log('🧠 Loading learnings from Supabase...');
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/learnings?order=created_at.desc&limit=1`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const data = await res.json();
    if (data && data.length > 0) {
      const learning = data[0];
      botParams.maxRSI = parseFloat(learning.recommended_max_rsi) || 70;
      if (learning.best_symbol) botParams.preferredSymbols = [learning.best_symbol];
      if (learning.best_hours) botParams.bestHours = JSON.parse(learning.best_hours || '[]');
      if (learning.best_sectors) botParams.bestSectors = JSON.parse(learning.best_sectors || '[]');
      console.log(`📊 Learnings loaded! Win rate: ${learning.win_rate}% | maxRSI: ${botParams.maxRSI} | Best symbol: ${learning.best_symbol} | Best hours: ${botParams.bestHours.join(',')} | Best sectors: ${botParams.bestSectors.join(',')}`);
    } else {
      console.log('📊 No learnings yet — using default parameters');
    }

    const tradesRes = await fetch(
      `${SUPABASE_URL}/rest/v1/trades?outcome=eq.LOSS&order=created_at.desc&limit=30`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const lossTrades = await tradesRes.json();
    if (Array.isArray(lossTrades) && lossTrades.length > 0) {
      const lossCounts = {};
      lossTrades.forEach(t => { lossCounts[t.symbol] = (lossCounts[t.symbol] || 0) + 1; });
      botParams.avoidSymbols = Object.entries(lossCounts)
        .filter(([_, count]) => count >= 3)
        .map(([symbol]) => symbol);
      if (botParams.avoidSymbols.length > 0) {
        console.log(`⚠️ Avoiding symbols with 3+ losses: ${botParams.avoidSymbols.join(', ')}`);
      }
    }
  } catch (e) {
    console.error('Failed to load learnings:', e.message);
  }
}

async function runLearningAnalysis() {
  try {
    console.log('🔬 Running multi-dimensional learning analysis...');
    const tradesRes = await fetch(
      `${SUPABASE_URL}/rest/v1/trades?outcome=not.is.null&action=eq.BUY&select=*`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const trades = await tradesRes.json();
    if (!trades || trades.length < 3) {
      console.log('📊 Not enough trades yet');
      return;
    }

    const wins = trades.filter(t => t.outcome === 'WIN');
    const losses = trades.filter(t => t.outcome === 'LOSS');
    const winRate = (wins.length / trades.length * 100).toFixed(2);

    const winRSI = wins.map(t => parseFloat(t.rsi)).filter(Boolean);
    const avgWinRSI = winRSI.length > 0 ? winRSI.reduce((a, b) => a + b, 0) / winRSI.length : 65;
    const recommendedMaxRSI = Math.min(avgWinRSI + 5, 70);

    const symbolStats = {};
    trades.forEach(t => {
      if (!symbolStats[t.symbol]) symbolStats[t.symbol] = { wins: 0, losses: 0 };
      if (t.outcome === 'WIN') symbolStats[t.symbol].wins++;
      else symbolStats[t.symbol].losses++;
    });
    const bestSymbol = Object.entries(symbolStats)
      .filter(([_, s]) => s.wins + s.losses >= 2)
      .sort((a, b) => (b[1].wins / (b[1].wins + b[1].losses)) - (a[1].wins / (a[1].wins + a[1].losses)))[0]?.[0];

    const hourStats = {};
    trades.forEach(t => {
      const hour = new Date(t.created_at).getUTCHours();
      if (!hourStats[hour]) hourStats[hour] = { wins: 0, losses: 0 };
      if (t.outcome === 'WIN') hourStats[hour].wins++;
      else hourStats[hour].losses++;
    });
    const bestHours = Object.entries(hourStats)
      .filter(([_, s]) => s.wins + s.losses >= 2)
      .sort((a, b) => (b[1].wins / (b[1].wins + b[1].losses)) - (a[1].wins / (a[1].wins + a[1].losses)))
      .slice(0, 3)
      .map(([hour]) => parseInt(hour));

    const sectorStats = {};
    trades.forEach(t => {
      const sector = SECTOR_MAP[t.symbol] || 'unknown';
      if (!sectorStats[sector]) sectorStats[sector] = { wins: 0, losses: 0 };
      if (t.outcome === 'WIN') sectorStats[sector].wins++;
      else sectorStats[sector].losses++;
    });
    const bestSectors = Object.entries(sectorStats)
      .filter(([_, s]) => s.wins + s.losses >= 2)
      .sort((a, b) => (b[1].wins / (b[1].wins + b[1].losses)) - (a[1].wins / (a[1].wins + a[1].losses)))
      .slice(0, 2)
      .map(([sector]) => sector);

    const winScores = wins.map(t => parseFloat(t.score || 0)).filter(Boolean);
    const avgWinScore = winScores.length > 0 ? winScores.reduce((a, b) => a + b, 0) / winScores.length : 0;

    await fetch(`${SUPABASE_URL}/rest/v1/learnings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        win_rate: parseFloat(winRate),
        avg_win_rsi: avgWinRSI.toFixed(2),
        avg_loss_rsi: losses.length > 0 ? (losses.map(t => parseFloat(t.rsi)).filter(Boolean).reduce((a, b) => a + b, 0) / losses.length).toFixed(2) : null,
        recommended_max_rsi: recommendedMaxRSI.toFixed(2),
        best_symbol: bestSymbol || null,
        best_hours: JSON.stringify(bestHours),
        best_sectors: JSON.stringify(bestSectors),
        total_trades: trades.length,
      })
    });

    botParams.maxRSI = recommendedMaxRSI;
    if (bestSymbol) botParams.preferredSymbols = [bestSymbol];
    if (bestHours.length > 0) botParams.bestHours = bestHours;
    if (bestSectors.length > 0) botParams.bestSectors = bestSectors;

    console.log(`✅ Learning complete! Win rate: ${winRate}% | Trades: ${trades.length} | maxRSI: ${recommendedMaxRSI.toFixed(2)} | Best symbol: ${bestSymbol} | Best hours: ${bestHours.join(',')} | Best sectors: ${bestSectors.join(',')}`);
  } catch (e) {
    console.error('Learning analysis failed:', e.message);
  }
}

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
  return getMarketSession() === 'market' ? VOLUME_MULTIPLIER : EXTENDED_VOLUME_MULTIPLIER;
}

async function loadExistingPositions() {
  try {
    const res = await fetch(`${BASE_URL}/v2/positions`, {
      headers: { 'APCA-API-KEY-ID': API_KEY, 'APCA-API-SECRET-KEY': SECRET_KEY }
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
  const res = await fetch(`${BASE_URL}/v2/orders`, {
    method: 'POST',
    headers: {
      'APCA-API-KEY-ID': API_KEY,
      'APCA-API-SECRET-KEY': SECRET_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      symbol, qty, side,
      type: extendedHours ? 'limit' : 'market',
      time_in_force: 'day',
      extended_hours: extendedHours,
    })
  });
  return res.json();
}

function calculateEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateMACD(closes) {
  if (closes.length < 26) return null;
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  if (!ema12 || !ema26) return null;
  const macdLine = ema12 - ema26;
  const macdValues = [];
  for (let i = 26; i <= closes.length; i++) {
    const e12 = calculateEMA(closes.slice(0, i), 12);
    const e26 = calculateEMA(closes.slice(0, i), 26);
    if (e12 && e26) macdValues.push(e12 - e26);
  }
  const signalLine = calculateEMA(macdValues, 9);
  const histogram = macdLine - (signalLine || 0);
  return { macd: macdLine, signal: signalLine, histogram, bullish: macdLine > (signalLine || 0) && histogram > 0 };
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
      { headers: { 'APCA-API-KEY-ID': API_KEY, 'APCA-API-SECRET-KEY': SECRET_KEY } }
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
  } catch (e) { return null; }
}

async function loadMinuteIndicators(symbol) {
  try {
    const res = await fetch(
      `${DATA_URL}/v2/stocks/${symbol}/bars?timeframe=1Min&limit=60`,
      { headers: { 'APCA-API-KEY-ID': API_KEY, 'APCA-API-SECRET-KEY': SECRET_KEY } }
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
  } catch (e) { return null; }
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

  setInterval(async () => {
    await runLearningAnalysis();
    await loadLearnings();
  }, 60 * 60 * 1000);

  setInterval(() => {
    const now = new Date();
    if (now.getUTCHours() === 21 && now.getUTCMinutes() === 0) {
      console.log('🔔 Market closed — running final learning analysis...');
      runLearningAnalysis();
    }
  }, 60 * 1000);
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

function isGoodHour() {
  if (botParams.bestHours.length === 0) return true;
  const utcHour = new Date().getUTCHours();
  return botParams.bestHours.includes(utcHour);
}

function isGoodSector(symbol) {
  if (botParams.bestSectors.length === 0) return true;
  const sector = SECTOR_MAP[symbol] || 'unknown';
  return botParams.bestSectors.includes(sector);
}

async function analyzeAndTrade(symbol, currentPrice) {
  if (isTrading) return;
  if (botParams.avoidSymbols.includes(symbol)) return;

  const session = getMarketSession();
  const daily = dailyIndicators[symbol];
  const minute = minuteIndicators[symbol];
  if (!daily) return;

  const dailyBullish = daily.ma10 > daily.ma20;
  const dailyRSIOk = daily.rsi < botParams.maxRSI && daily.rsi > botParams.minRSI;
  const dailyMACDBullish = daily.macd ? daily.macd.bullish : true;
  const minuteBullish = minute ? minute.ma10 > minute.ma20 : true;
  const minuteRSIOk = minute ? minute.rsi < botParams.maxRSI : true;
  const minuteMACDBullish = minute?.macd ? minute.macd.bullish : true;

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
      setTimeout(runLearningAnalysis, 2000);
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
      setTimeout(runLearningAnalysis, 2000);
    }
    return;
  }

  const maxPositions = getMaxPositions();
  if (maxPositions === 0) return;
  if (isOnCooldown(symbol)) return;
  if (Object.keys(positions).length >= maxPositions) return;

  const volumeOk = hasVolumeConfirmation(symbol);
  const rsiLimit = session === 'market' ? botParams.maxRSI : Math.min(botParams.maxRSI, 65);
  const strictDailyRSIOk = daily.rsi < rsiLimit && daily.rsi > botParams.minRSI;
  const isPreferred = botParams.preferredSymbols.includes(symbol);
  const goodHour = isGoodHour();
  const goodSector = isGoodSector(symbol);

  if (dailyBullish && strictDailyRSIOk && dailyMACDBullish && minuteBullish && minuteRSIOk && minuteMACDBullish && volumeOk) {
    if (botParams.bestHours.length > 0 && !goodHour) return;
    if (botParams.bestSectors.length > 0 && !goodSector && !isPreferred) return;

    const shares = Math.floor(MAX_TRADE / currentPrice);
    if (shares < 1) return;

    isTrading = true;
    console.log(`📈 BUY: ${symbol} at $${currentPrice} | RSI: ${daily.rsi.toFixed(2)} | MACD: ${daily.macd?.histogram.toFixed(4)} | ${isPreferred ? '⭐ PREFERRED' : ''} | ${goodSector ? '🏭 GOOD SECTOR' : ''} | Positions: ${Object.keys(positions).length + 1}/${maxPositions}`);
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
  console.log('🤖 Trading bot starting — Multi-dimensional self-learning 24/7 system...');
  isSubscribed = false;

  const session = getMarketSession();
  console.log(`📅 Current session: ${session}`);

  const ws = new WebSocket('wss://stream.data.alpaca.markets/v2/iex');

  loadLearnings().then(() => {
    loadAllDailyIndicators().then(() => refreshMinuteIndicators());
  });
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
          ws.send(JSON.stringify({ action: 'subscribe', trades: WATCHLIST }));
        }
      }
    }, 30000);
  });

  ws.on('message', async (data) => {
    const messages = JSON.parse(data);
    for (const msg of messages) {
      if (msg.T === 'success' && msg.msg === 'authenticated') {
        console.log('✅ Authenticated! Subscribing to live trades...');
        ws.send(JSON.stringify({ action: 'subscribe', trades: WATCHLIST }));
      }
      if (msg.T === 'subscription') {
        isSubscribed = true;
        console.log('✅ Subscribed! Multi-dimensional self-learning bot is now live!');
      }
      if (msg.T === 'error') {
        console.error('❌ Alpaca error:', JSON.stringify(msg));
      }
      if (msg.T === 't') {
        await analyzeAndTrade(msg.S, msg.p);
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
