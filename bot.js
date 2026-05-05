const WebSocket = require('ws');
const fetch = require('node-fetch');

const API_KEY = process.env.ALPACA_API_KEY;
const SECRET_KEY = process.env.ALPACA_SECRET_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const BASE_URL = 'https://paper-api.alpaca.markets';
const DATA_URL = 'https://data.alpaca.markets';

const WATCHLIST = [
  'AAPL', 'NVDA', 'MSFT', 'META', 'GOOGL', 'TSLA', 'AMZN', 'AMD', 'CRM', 'INTC',
  'JPM', 'BAC', 'GS', 'V', 'MA', 'WFC',
  'JNJ', 'PFE', 'UNH', 'LLY',
  'XOM', 'CVX', 'COP', 'EOG',
  'SPY', 'QQQ', 'DIA', 'IWM', 'VTI', 'XLF'
];

const STOCK_NAMES = {
  'AAPL': 'Apple', 'NVDA': 'Nvidia', 'MSFT': 'Microsoft', 'META': 'Meta',
  'GOOGL': 'Google', 'TSLA': 'Tesla', 'AMZN': 'Amazon', 'AMD': 'AMD',
  'CRM': 'Salesforce', 'INTC': 'Intel', 'JPM': 'JPMorgan', 'BAC': 'Bank of America',
  'GS': 'Goldman Sachs', 'V': 'Visa', 'MA': 'Mastercard', 'WFC': 'Wells Fargo',
  'JNJ': 'Johnson Johnson', 'PFE': 'Pfizer', 'UNH': 'UnitedHealth', 'LLY': 'Eli Lilly',
  'XOM': 'ExxonMobil', 'CVX': 'Chevron', 'COP': 'ConocoPhillips', 'EOG': 'EOG Resources',
  'SPY': 'S&P 500', 'QQQ': 'Nasdaq', 'DIA': 'Dow Jones', 'IWM': 'Russell',
  'VTI': 'Vanguard', 'XLF': 'Financial Select'
};

const NEGATIVE_KEYWORDS = [
  'lawsuit', 'fraud', 'investigation', 'SEC', 'fine', 'penalty', 'hack', 'breach',
  'recall', 'bankruptcy', 'layoff', 'miss', 'disappoints', 'warns', 'downgrade',
  'crash', 'plunge', 'tumble', 'fall', 'drop', 'decline', 'loss', 'cut'
];

const POSITIVE_KEYWORDS = [
  'beat', 'exceeds', 'record', 'surge', 'rally', 'upgrade', 'buy', 'outperform',
  'growth', 'profit', 'revenue', 'strong', 'bullish', 'partnership', 'contract',
  'innovation', 'launch', 'expansion', 'dividend', 'buyback'
];

// ── TIGHTENED CONSTANTS ──────────────────────────────────────────
const STOP_LOSS_PCT = 0.01;          // 1% stop loss — wider to avoid noise
const TAKE_PROFIT_PCT = 0.015;       // 1.5% take profit target
const COOLDOWN_MS = 5 * 60 * 1000;  // 5 min cooldown between trades
const MAX_PRICE_HISTORY = 100;
const MIN_TRAILING_STOP = 0.007;
const MAX_TRAILING_STOP = 0.02;
const REGIME_STABILITY_THRESHOLD = 40; // More ticks required to confirm regime
const MIN_PROFIT_TO_TRAIL = 0.005;   // 0.5% profit before trailing activates
const AVOID_RESET_HOURS = 24;
const AVOID_LOSS_THRESHOLD = 3;
const MAX_DAILY_LOSS_PCT = 0.015;    // Halt if down 1.5% in a day
const MARKET_OPEN_BUFFER_MINUTES = 15;
const CONSECUTIVE_LOSS_SKIP = 2;
const MIN_UP_FROM_OPEN_PCT = 0.005;  // Must be 0.5% above open to buy
const MIN_VOLUME_MULTIPLIER = 1.2;   // Volume must be 20% above average
const MAX_DAILY_TRADES = 6;          // Max 6 trades per day — quality over quantity
const MIN_WIN_RATE_TO_TRADE = 0;     // Will increase as we get more data

// High probability trading windows (UTC)
// 9:45-11am EST = 13:45-15:00 UTC
// 3:00-4:00pm EST = 19:00-20:00 UTC
const POWER_HOURS = [
  { start: 13 * 60 + 45, end: 15 * 60 },      // 9:45-11am EST
  { start: 19 * 60, end: 20 * 60 },             // 3-4pm EST
];

let botParams = {
  maxRSI: 62,
  minRSI: 38,
  winRate: 0,
  totalTrades: 0,
  avoidSymbols: [],
  avoidTimestamps: {},
  preferredSymbols: [],
  bestHours: [],
  bestSectors: [],
};

let newsData = {};
let currentRegime = 'neutral';
let volatilityData = {};
let regimeCandidateCount = 0;
let regimeCandidate = 'neutral';
let tradingLocks = {};
let todayOpenPrices = {};
let startingPortfolioValue = null;
let dailyTradingHalted = false;
let todaySymbolLosses = {};
let todayTradeCount = 0;

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
let shortPositions = {};
let dailyIndicators = {};
let realtimePrices = {};
let realtimeVolumes = {};
let realtimeIndicators = {};
let volumeData = {};
let cooldowns = {};
let pingInterval = null;
let isSubscribed = false;

function isSymbolLocked(symbol) { return tradingLocks[symbol] === true; }
function lockSymbol(symbol) { tradingLocks[symbol] = true; }
function unlockSymbol(symbol) { tradingLocks[symbol] = false; }

// Only trade during high probability windows
function isInPowerHour() {
  const now = new Date();
  const utcTime = now.getUTCHours() * 60 + now.getUTCMinutes();
  return POWER_HOURS.some(h => utcTime >= h.start && utcTime < h.end);
}

function isMarketOpenBuffer() {
  const now = new Date();
  const utcTime = now.getUTCHours() * 60 + now.getUTCMinutes();
  const marketOpenTime = 14 * 60 + 30;
  return utcTime >= marketOpenTime && utcTime < marketOpenTime + MARKET_OPEN_BUFFER_MINUTES;
}

function recordSymbolLoss(symbol) {
  if (!todaySymbolLosses[symbol]) todaySymbolLosses[symbol] = 0;
  todaySymbolLosses[symbol]++;
  if (todaySymbolLosses[symbol] >= CONSECUTIVE_LOSS_SKIP) {
    console.log(`⛔ ${symbol} skipped for rest of day — ${todaySymbolLosses[symbol]} consecutive losses`);
  }
}

function recordSymbolWin(symbol) {
  todaySymbolLosses[symbol] = 0;
}

function isSkippedToday(symbol) {
  return (todaySymbolLosses[symbol] || 0) >= CONSECUTIVE_LOSS_SKIP;
}

function refreshAvoidList() {
  const now = Date.now();
  const resetMs = AVOID_RESET_HOURS * 60 * 60 * 1000;
  const expired = botParams.avoidSymbols.filter(symbol => {
    const addedAt = botParams.avoidTimestamps[symbol] || 0;
    return now - addedAt > resetMs;
  });
  if (expired.length > 0) {
    console.log(`🔄 Removing from avoid list (24hr reset): ${expired.join(', ')}`);
    botParams.avoidSymbols = botParams.avoidSymbols.filter(s => !expired.includes(s));
    expired.forEach(s => delete botParams.avoidTimestamps[s]);
  }
}

function calculateVolatility(symbol) {
  const prices = realtimePrices[symbol];
  if (!prices || prices.length < 20) return volatilityData[symbol] || 0.005;
  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(Math.abs(prices[i] - prices[i-1]) / prices[i-1]);
  }
  const avgChange = changes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  volatilityData[symbol] = avgChange;
  return avgChange;
}

function getDynamicTrailingStop(symbol) {
  const volatility = calculateVolatility(symbol);
  return Math.min(Math.max(volatility * 2, MIN_TRAILING_STOP), MAX_TRAILING_STOP);
}

function getLongMomentum(symbol) {
  const prices = realtimePrices[symbol];
  if (!prices || prices.length < 20) return 0;
  const recent = prices.slice(-20);
  return recent[recent.length - 1] - recent[0];
}

function getMomentum(symbol) {
  const prices = realtimePrices[symbol];
  if (!prices || prices.length < 5) return 0;
  const recent = prices.slice(-5);
  return recent[recent.length - 1] - recent[0];
}

// Volume check — is current volume above average?
function hasStrongVolume(symbol) {
  const volumes = realtimeVolumes[symbol];
  const avgVol = volumeData[symbol]?.avgVolume;
  if (!volumes || !avgVol || volumes.length < 5) return true; // Allow if no data
  const recentVol = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  return recentVol >= avgVol * MIN_VOLUME_MULTIPLIER;
}

function getMarketRegime() {
  const spy = realtimeIndicators['SPY'] || dailyIndicators['SPY'];
  const qqq = realtimeIndicators['QQQ'] || dailyIndicators['QQQ'];
  const dia = realtimeIndicators['DIA'] || dailyIndicators['DIA'];
  if (!spy) return 'neutral';
  const spyMomentum = getLongMomentum('SPY');
  const qqqMomentum = getLongMomentum('QQQ');
  const bullSignals = [
    spy.ma10 > spy.ma20,
    qqq ? qqq.ma10 > qqq.ma20 : false,
    dia ? dia.ma10 > dia.ma20 : false,
    spyMomentum > 0,
    qqqMomentum > 0,
    spy.rsi > 50 && spy.rsi < 75,
    spy.macd?.bullish,
  ].filter(Boolean).length;
  const bearSignals = [
    spy.ma10 < spy.ma20,
    qqq ? qqq.ma10 < qqq.ma20 : false,
    dia ? dia.ma10 < dia.ma20 : false,
    spyMomentum < 0,
    qqqMomentum < 0,
    spy.rsi < 45,
    spy.macd && !spy.macd.bullish,
  ].filter(Boolean).length;
  if (bullSignals >= 5) return 'bull';
  if (bearSignals >= 5) return 'bear';
  return 'neutral';
}

function updateRegime() {
  const detectedRegime = getMarketRegime();
  if (detectedRegime === currentRegime) {
    regimeCandidateCount = 0;
    regimeCandidate = currentRegime;
    return currentRegime;
  }
  if (detectedRegime === regimeCandidate) {
    regimeCandidateCount++;
  } else {
    regimeCandidate = detectedRegime;
    regimeCandidateCount = 1;
  }
  if (regimeCandidateCount >= REGIME_STABILITY_THRESHOLD) {
    if (regimeCandidate !== currentRegime) {
      console.log(`🌍 Market regime confirmed: ${currentRegime} → ${regimeCandidate}`);
      currentRegime = regimeCandidate;
      regimeCandidateCount = 0;
    }
  }
  return currentRegime;
}

async function fetchNewsForSymbol(symbol) {
  try {
    const name = STOCK_NAMES[symbol] || symbol;
    const query = encodeURIComponent(`${name} stock`);
    const from = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const url = `https://newsapi.org/v2/everything?q=${query}&from=${from}&sortBy=publishedAt&pageSize=5&apiKey=${NEWS_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.articles || data.articles.length === 0) return { sentiment: 'neutral', score: 0 };
    let positiveCount = 0;
    let negativeCount = 0;
    data.articles.forEach(article => {
      const text = `${article.title} ${article.description || ''}`.toLowerCase();
      POSITIVE_KEYWORDS.forEach(kw => { if (text.includes(kw)) positiveCount++; });
      NEGATIVE_KEYWORDS.forEach(kw => { if (text.includes(kw)) negativeCount++; });
    });
    const score = positiveCount - negativeCount;
    let sentiment = 'neutral';
    if (score > 2) sentiment = 'positive';
    else if (score < -1) sentiment = 'negative';
    return { sentiment, score };
  } catch (e) {
    return { sentiment: 'neutral', score: 0 };
  }
}

async function refreshNewsData() {
  console.log('📰 Refreshing news sentiment...');
  let positive = 0, negative = 0, neutral = 0;
  for (const symbol of WATCHLIST) {
    const news = await fetchNewsForSymbol(symbol);
    newsData[symbol] = news;
    if (news.sentiment === 'positive') positive++;
    else if (news.sentiment === 'negative') negative++;
    else neutral++;
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`📰 News: ${positive} positive, ${negative} negative, ${neutral} neutral`);
}

function getNewsSentiment(symbol) {
  return newsData[symbol] || { sentiment: 'neutral', score: 0 };
}

function getPositionSize(indicators, isPreferred, newsSentiment) {
  // Conservative sizing — max $200 until win rate proven
  const winRate = botParams.winRate || 0;
  if (winRate >= 55) return isPreferred ? 300 : 200;
  if (winRate >= 45) return 150;
  return 100;
}

// Comprehensive signal scoring — ALL indicators must agree
function getSignalScore(indicators, daily) {
  let score = 0;
  // Realtime MA cross
  if (indicators.ma10 > indicators.ma20) score++;
  // Daily MA cross
  if (daily && daily.ma10 > daily.ma20) score++;
  // RSI in ideal range
  if (indicators.rsi >= botParams.minRSI && indicators.rsi <= botParams.maxRSI) score++;
  // Realtime MACD bullish
  if (indicators.macd?.bullish && indicators.macd?.histogram > 0.05) score++;
  // Daily MACD bullish
  if (daily?.macd?.bullish && daily?.macd?.histogram > 0.05) score++;
  return score;
}

function getBearishScore(indicators, daily) {
  let score = 0;
  if (indicators.ma10 < indicators.ma20) score++;
  if (daily && daily.ma10 < daily.ma20) score++;
  if (indicators.rsi > 62 || indicators.rsi < 35) score++;
  if (indicators.macd && !indicators.macd.bullish && indicators.macd.histogram < -0.05) score++;
  if (daily?.macd && !daily.macd.bullish && daily.macd.histogram < -0.05) score++;
  return score;
}

function getFullSignalScore(symbol) {
  const indicators = realtimeIndicators[symbol] || dailyIndicators[symbol];
  const daily = dailyIndicators[symbol];
  const news = getNewsSentiment(symbol);
  if (!indicators) return 0;
  let score = 0;
  if (indicators.ma10 > indicators.ma20) score += 2;
  if (daily && daily.ma10 > daily.ma20) score += 2;
  if (indicators.rsi >= botParams.minRSI && indicators.rsi <= botParams.maxRSI) score += 2;
  if (indicators.macd?.bullish && indicators.macd?.histogram > 0.05) score += 3;
  if (daily?.macd?.bullish && daily?.macd?.histogram > 0.05) score += 3;
  const maSep = indicators.ma10 > 0 ? (indicators.ma10 - indicators.ma20) / indicators.ma20 * 100 : 0;
  if (maSep > 0.5) score += 3;
  else if (maSep > 0.2) score += 1;
  const momentum = getMomentum(symbol);
  if (momentum > 0) score += 2;
  if (news.sentiment === 'positive') score += 3;
  if (botParams.preferredSymbols.includes(symbol)) score += 2;
  if (hasStrongVolume(symbol)) score += 2;
  const openPrice = todayOpenPrices[symbol];
  const currentPrice = realtimePrices[symbol]?.slice(-1)[0] || 0;
  if (openPrice && currentPrice > openPrice * (1 + MIN_UP_FROM_OPEN_PCT)) score += 3;
  return score;
}

function updateRealtimeData(symbol, price, size) {
  if (!realtimePrices[symbol]) realtimePrices[symbol] = [];
  if (!realtimeVolumes[symbol]) realtimeVolumes[symbol] = [];
  realtimePrices[symbol].push(price);
  realtimeVolumes[symbol].push(size || 0);
  if (realtimePrices[symbol].length > MAX_PRICE_HISTORY) realtimePrices[symbol].shift();
  if (realtimeVolumes[symbol].length > MAX_PRICE_HISTORY) realtimeVolumes[symbol].shift();
  if (realtimePrices[symbol].length >= 26) {
    realtimeIndicators[symbol] = calculateIndicators(realtimePrices[symbol]);
  }
}

async function closePosition(symbol, reason) {
  try {
    if (positions[symbol]) {
      console.log(`🚪 Auto-closing LONG ${symbol} — reason: ${reason}`);
      await placeOrder(symbol, positions[symbol].shares, 'sell');
      await updateTradeOutcome(symbol, 'LOSS', '0');
      delete positions[symbol];
      cooldowns[symbol] = Date.now();
    }
    if (shortPositions[symbol]) {
      console.log(`🚪 Auto-closing SHORT ${symbol} — reason: ${reason}`);
      await placeOrder(symbol, shortPositions[symbol].shares, 'buy');
      await updateTradeOutcome(symbol, 'LOSS', '0');
      delete shortPositions[symbol];
      cooldowns[symbol] = Date.now();
    }
  } catch (e) {
    console.error(`Failed to close ${symbol}:`, e.message);
  }
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
      console.log(`📝 Updated trade outcome: ${symbol} → ${outcome} | P&L: $${profitLoss}`);
    }
  } catch (e) {
    console.error('Failed to update trade outcome:', e.message);
  }
}

async function loadLearnings() {
  try {
    refreshAvoidList();
    console.log('🧠 Loading learnings from Supabase...');
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/learnings?order=created_at.desc&limit=1`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const data = await res.json();
    if (data && data.length > 0) {
      const learning = data[0];
      botParams.maxRSI = Math.min(parseFloat(learning.recommended_max_rsi) || 62, 62);
      botParams.minRSI = 38;
      botParams.winRate = parseFloat(learning.win_rate) || 0;
      botParams.totalTrades = parseInt(learning.total_trades) || 0;
      if (learning.best_symbol) botParams.preferredSymbols = [learning.best_symbol];
      if (learning.best_hours) botParams.bestHours = JSON.parse(learning.best_hours || '[]');
      if (learning.best_sectors) botParams.bestSectors = JSON.parse(learning.best_sectors || '[]');
      console.log(`📊 Learnings loaded! Win rate: ${botParams.winRate}% | Trades: ${botParams.totalTrades} | maxRSI: ${botParams.maxRSI} | Best: ${learning.best_symbol}`);
    } else {
      console.log('📊 No learnings yet — using conservative defaults');
    }
    const tradesRes = await fetch(
      `${SUPABASE_URL}/rest/v1/trades?outcome=eq.LOSS&order=created_at.desc&limit=50`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const lossTrades = await tradesRes.json();
    if (Array.isArray(lossTrades) && lossTrades.length > 0) {
      const lossCounts = {};
      lossTrades.forEach(t => { lossCounts[t.symbol] = (lossCounts[t.symbol] || 0) + 1; });
      const newAvoidSymbols = Object.entries(lossCounts)
        .filter(([_, count]) => count >= AVOID_LOSS_THRESHOLD)
        .map(([symbol]) => symbol);
      for (const symbol of newAvoidSymbols) {
        if (!botParams.avoidSymbols.includes(symbol)) {
          botParams.avoidTimestamps[symbol] = Date.now();
          await closePosition(symbol, `${AVOID_LOSS_THRESHOLD}+ losses`);
        }
      }
      botParams.avoidSymbols = newAvoidSymbols;
      if (botParams.avoidSymbols.length > 0) {
        console.log(`⚠️ Avoiding: ${botParams.avoidSymbols.join(', ')}`);
      }
    }
  } catch (e) {
    console.error('Failed to load learnings:', e.message);
  }
}

async function runLearningAnalysis() {
  try {
    const tradesRes = await fetch(
      `${SUPABASE_URL}/rest/v1/trades?outcome=not.is.null&action=eq.BUY&select=*`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const trades = await tradesRes.json();
    if (!trades || trades.length < 5) {
      console.log(`📊 Not enough trades for learning yet (${trades?.length || 0} completed)`);
      return;
    }
    const wins = trades.filter(t => t.outcome === 'WIN');
    const losses = trades.filter(t => t.outcome === 'LOSS');
    const winRate = (wins.length / trades.length * 100).toFixed(2);
    botParams.winRate = parseFloat(winRate);
    botParams.totalTrades = trades.length;

    const winRSI = wins.map(t => parseFloat(t.rsi)).filter(Boolean);
    const avgWinRSI = winRSI.length > 0 ? winRSI.reduce((a, b) => a + b, 0) / winRSI.length : 52;
    const recommendedMaxRSI = Math.min(avgWinRSI + 5, 62);

    const symbolStats = {};
    trades.forEach(t => {
      if (!symbolStats[t.symbol]) symbolStats[t.symbol] = { wins: 0, losses: 0 };
      if (t.outcome === 'WIN') symbolStats[t.symbol].wins++;
      else symbolStats[t.symbol].losses++;
    });

    const bestSymbol = Object.entries(symbolStats)
      .filter(([_, s]) => s.wins + s.losses >= 3)
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

    const learningData = {
      win_rate: parseFloat(winRate),
      avg_win_rsi: avgWinRSI.toFixed(2),
      avg_loss_rsi: losses.length > 0 ? (losses.map(t => parseFloat(t.rsi)).filter(Boolean).reduce((a, b) => a + b, 0) / losses.length).toFixed(2) : null,
      recommended_max_rsi: recommendedMaxRSI.toFixed(2),
      best_symbol: bestSymbol || null,
      best_hours: JSON.stringify(bestHours),
      best_sectors: JSON.stringify(bestSectors),
      total_trades: trades.length,
    };

    const existingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/learnings?limit=1`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const existing = await existingRes.json();

    if (existing && existing.length > 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/learnings?id=eq.${existing[0].id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(learningData)
      });
    } else {
      await fetch(`${SUPABASE_URL}/rest/v1/learnings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(learningData)
      });
    }

    botParams.maxRSI = recommendedMaxRSI;
    if (bestSymbol) botParams.preferredSymbols = [bestSymbol];
    if (bestHours.length > 0) botParams.bestHours = bestHours;
    if (bestSectors.length > 0) botParams.bestSectors = bestSectors;
    console.log(`✅ Learning: Win rate ${winRate}% | Trades: ${trades.length} | maxRSI: ${recommendedMaxRSI.toFixed(2)} | Best: ${bestSymbol}`);
  } catch (e) {
    console.error('Learning failed:', e.message);
  }
}

function getMaxPositionsByWinRate() {
  const winRate = botParams.winRate || 0;
  if (winRate >= 60) return 5;
  if (winRate >= 50) return 3;
  if (winRate >= 40) return 2;
  return 1; // Ultra conservative until proven
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
  if (session === 'market') return getMaxPositionsByWinRate();
  return 0; // No extended hours trading until we prove profitability
}

async function loadTodayOpenPrices() {
  try {
    console.log('📈 Loading today\'s opening prices...');
    const today = new Date().toISOString().split('T')[0];
    for (const symbol of WATCHLIST) {
      const res = await fetch(
        `${DATA_URL}/v2/stocks/${symbol}/bars?timeframe=1Day&start=${today}&limit=1`,
        { headers: { 'APCA-API-KEY-ID': API_KEY, 'APCA-API-SECRET-KEY': SECRET_KEY } }
      );
      const data = await res.json();
      if (data.bars && data.bars.length > 0) {
        todayOpenPrices[symbol] = data.bars[0].o;
      }
    }
    console.log(`✅ Loaded open prices for ${Object.keys(todayOpenPrices).length} stocks`);
  } catch (e) {
    console.error('Failed to load open prices:', e.message);
  }
}

function isUpFromOpen(symbol, currentPrice) {
  const openPrice = todayOpenPrices[symbol];
  if (!openPrice) return true;
  return currentPrice > openPrice * (1 + MIN_UP_FROM_OPEN_PCT);
}

async function checkDailyLossLimit() {
  try {
    const res = await fetch(`${BASE_URL}/v2/account`, {
      headers: { 'APCA-API-KEY-ID': API_KEY, 'APCA-API-SECRET-KEY': SECRET_KEY }
    });
    const account = await res.json();
    const currentValue = parseFloat(account.portfolio_value);
    if (!startingPortfolioValue) {
      startingPortfolioValue = currentValue;
      console.log(`💰 Starting portfolio value: $${startingPortfolioValue.toFixed(2)}`);
      return;
    }
    const dailyLossPct = (startingPortfolioValue - currentValue) / startingPortfolioValue;
    if (dailyLossPct >= MAX_DAILY_LOSS_PCT && !dailyTradingHalted) {
      dailyTradingHalted = true;
      console.log(`🛑 DAILY LOSS LIMIT HIT: Down ${(dailyLossPct*100).toFixed(2)}% — halting new trades!`);
    } else if (dailyLossPct < MAX_DAILY_LOSS_PCT && dailyTradingHalted) {
      dailyTradingHalted = false;
    }
  } catch (e) {
    console.error('Failed to check daily loss:', e.message);
  }
}

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
        const trailingStop = getDynamicTrailingStop(p.symbol);
        if (p.side === 'short') {
          shortPositions[p.symbol] = {
            entryPrice: parseFloat(p.avg_entry_price),
            shares: Math.abs(parseFloat(p.qty)),
            lowestPrice: parseFloat(p.current_price || p.avg_entry_price),
            trailingStop: parseFloat(p.avg_entry_price) * (1 + trailingStop),
            trailingStopPct: trailingStop,
          };
          console.log(`📋 Loaded SHORT: ${p.symbol} | ${p.qty} shares @ $${p.avg_entry_price}`);
        } else {
          positions[p.symbol] = {
            entryPrice: parseFloat(p.avg_entry_price),
            shares: parseFloat(p.qty),
            highestPrice: parseFloat(p.current_price || p.avg_entry_price),
            trailingStop: parseFloat(p.avg_entry_price) * (1 - trailingStop),
            trailingStopPct: trailingStop,
          };
          console.log(`📋 Loaded LONG: ${p.symbol} | ${p.qty} shares @ $${p.avg_entry_price}`);
        }
      }
    }
    console.log(`✅ Loaded ${Object.keys(positions).length} long, ${Object.keys(shortPositions).length} short positions`);
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
      type: 'market',
      time_in_force: 'day',
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
    const dailyChanges = closes.slice(-20).map((c, i, arr) => i === 0 ? 0 : Math.abs(c - arr[i-1]) / arr[i-1]);
    volatilityData[symbol] = dailyChanges.reduce((a, b) => a + b, 0) / dailyChanges.length;
    if (!realtimePrices[symbol] || realtimePrices[symbol].length < 26) {
      realtimePrices[symbol] = closes.slice(-MAX_PRICE_HISTORY);
      realtimeIndicators[symbol] = indicators;
      console.log(`🌱 Seeded real-time data for ${symbol}`);
    }
    return indicators;
  } catch (e) { return null; }
}

async function loadAllDailyIndicators() {
  console.log('📊 Loading and seeding indicators for all stocks...');
  for (const symbol of WATCHLIST) {
    const data = await loadDailyIndicators(symbol);
    if (data) dailyIndicators[symbol] = data;
  }
  console.log(`✅ Indicators loaded for ${Object.keys(dailyIndicators).length} stocks!`);
  currentRegime = getMarketRegime();
  console.log(`🌍 Market regime: ${currentRegime}`);
}

function scheduleRefresh() {
  setInterval(async () => {
    await loadAllDailyIndicators();
    await loadExistingPositions();
    await loadTodayOpenPrices();
  }, 30 * 60 * 1000);

  setInterval(async () => {
    await runLearningAnalysis();
    await loadLearnings();
  }, 60 * 60 * 1000);

  setInterval(async () => {
    await refreshNewsData();
  }, 30 * 60 * 1000);

  setInterval(async () => {
    await checkDailyLossLimit();
  }, 5 * 60 * 1000);

  setInterval(() => {
    refreshAvoidList();
  }, 60 * 60 * 1000);

  setInterval(() => {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcMinute = now.getUTCMinutes();
    if (utcHour === 14 && utcMinute === 30) {
      dailyTradingHalted = false;
      startingPortfolioValue = null;
      todayOpenPrices = {};
      todaySymbolLosses = {};
      todayTradeCount = 0;
      console.log('🔔 Market open — all daily counters reset!');
      loadTodayOpenPrices();
      checkDailyLossLimit();
    }
    if (utcHour === 21 && utcMinute === 0) {
      console.log('🔔 Market closed — running final learning analysis...');
      runLearningAnalysis();
    }
  }, 60 * 1000);
}

function isOnCooldown(symbol) {
  if (!cooldowns[symbol]) return false;
  return Date.now() - cooldowns[symbol] < COOLDOWN_MS;
}

async function manageShortPosition(symbol, currentPrice, session) {
  const position = shortPositions[symbol];
  if (!position || isSymbolLocked(symbol)) return;
  const pnlPct = (position.entryPrice - currentPrice) / position.entryPrice;

  if (currentPrice < position.lowestPrice) {
    position.lowestPrice = currentPrice;
    position.trailingStop = currentPrice * (1 + getDynamicTrailingStop(symbol));
  }

  // Take profit at target
  if (pnlPct >= TAKE_PROFIT_PCT) {
    lockSymbol(symbol);
    console.log(`🟢 SHORT TAKE PROFIT: ${symbol} at $${currentPrice} (+${(pnlPct*100).toFixed(2)}%)`);
    await placeOrder(symbol, position.shares, 'buy');
    await updateTradeOutcome(symbol, 'WIN', ((position.entryPrice - currentPrice) * position.shares).toFixed(2));
    recordSymbolWin(symbol);
    delete shortPositions[symbol];
    cooldowns[symbol] = Date.now();
    unlockSymbol(symbol);
    setTimeout(runLearningAnalysis, 2000);
    return;
  }

  if (currentPrice >= position.trailingStop && pnlPct >= MIN_PROFIT_TO_TRAIL) {
    lockSymbol(symbol);
    console.log(`🟢 SHORT COVER: ${symbol} at $${currentPrice} (+${(pnlPct*100).toFixed(2)}%)`);
    await placeOrder(symbol, position.shares, 'buy');
    await updateTradeOutcome(symbol, 'WIN', ((position.entryPrice - currentPrice) * position.shares).toFixed(2));
    recordSymbolWin(symbol);
    delete shortPositions[symbol];
    cooldowns[symbol] = Date.now();
    unlockSymbol(symbol);
    setTimeout(runLearningAnalysis, 2000);
    return;
  }

  if (pnlPct <= -STOP_LOSS_PCT) {
    lockSymbol(symbol);
    console.log(`🔴 SHORT STOP LOSS: ${symbol} at $${currentPrice} (${(pnlPct*100).toFixed(2)}%)`);
    await placeOrder(symbol, position.shares, 'buy');
    await updateTradeOutcome(symbol, 'LOSS', ((position.entryPrice - currentPrice) * position.shares).toFixed(2));
    recordSymbolLoss(symbol);
    delete shortPositions[symbol];
    cooldowns[symbol] = Date.now();
    unlockSymbol(symbol);
    setTimeout(runLearningAnalysis, 2000);
  }
}

async function analyzeAndTrade(symbol, currentPrice, tradeSize) {
  if (isSymbolLocked(symbol)) return;
  if (botParams.avoidSymbols.includes(symbol)) return;
  if (isSkippedToday(symbol)) return;

  updateRealtimeData(symbol, currentPrice, tradeSize);
  if (symbol === 'SPY' || symbol === 'QQQ' || symbol === 'DIA') updateRegime();

  const session = getMarketSession();
  const realtime = realtimeIndicators[symbol];
  const daily = dailyIndicators[symbol];
  const indicators = realtime || daily;
  if (!indicators) return;

  const news = getNewsSentiment(symbol);
  if (news.sentiment === 'negative') return;

  if (shortPositions[symbol]) {
    await manageShortPosition(symbol, currentPrice, session);
    return;
  }

  if (positions[symbol]) {
    const position = positions[symbol];
    const pnlPct = (currentPrice - position.entryPrice) / position.entryPrice;
    position.trailingStopPct = getDynamicTrailingStop(symbol);

    if (currentPrice > position.highestPrice) {
      position.highestPrice = currentPrice;
      if (pnlPct >= MIN_PROFIT_TO_TRAIL) {
        position.trailingStop = currentPrice * (1 - position.trailingStopPct);
        console.log(`📊 ${symbol} new high $${currentPrice} | Stop: $${position.trailingStop.toFixed(2)} | P&L: +${(pnlPct*100).toFixed(2)}%`);
      }
    }

    // Take profit at target
    if (pnlPct >= TAKE_PROFIT_PCT) {
      lockSymbol(symbol);
      console.log(`🟢 TAKE PROFIT: Selling ${symbol} at $${currentPrice} (+${(pnlPct*100).toFixed(2)}%)`);
      await placeOrder(symbol, position.shares, 'sell');
      await updateTradeOutcome(symbol, 'WIN', ((currentPrice - position.entryPrice) * position.shares).toFixed(2));
      recordSymbolWin(symbol);
      delete positions[symbol];
      cooldowns[symbol] = Date.now();
      unlockSymbol(symbol);
      setTimeout(runLearningAnalysis, 2000);
      return;
    }

    if (currentPrice <= position.trailingStop && pnlPct >= MIN_PROFIT_TO_TRAIL) {
      lockSymbol(symbol);
      console.log(`🟢 TRAILING STOP: Selling ${symbol} at $${currentPrice} (+${(pnlPct*100).toFixed(2)}%)`);
      await placeOrder(symbol, position.shares, 'sell');
      await updateTradeOutcome(symbol, 'WIN', ((currentPrice - position.entryPrice) * position.shares).toFixed(2));
      recordSymbolWin(symbol);
      delete positions[symbol];
      cooldowns[symbol] = Date.now();
      unlockSymbol(symbol);
      setTimeout(runLearningAnalysis, 2000);
      return;
    }

    if (pnlPct <= -STOP_LOSS_PCT) {
      lockSymbol(symbol);
      console.log(`🔴 STOP LOSS: Selling ${symbol} at $${currentPrice} (${(pnlPct*100).toFixed(2)}%)`);
      await placeOrder(symbol, position.shares, 'sell');
      await updateTradeOutcome(symbol, 'LOSS', ((currentPrice - position.entryPrice) * position.shares).toFixed(2));
      recordSymbolLoss(symbol);
      delete positions[symbol];
      cooldowns[symbol] = Date.now();
      unlockSymbol(symbol);
      setTimeout(runLearningAnalysis, 2000);
    }
    return;
  }

  const maxPositions = getMaxPositions();
  if (maxPositions === 0) return;
  if (isOnCooldown(symbol)) return;
  if (dailyTradingHalted) return;
  if (isMarketOpenBuffer()) return;
  if (todayTradeCount >= MAX_DAILY_TRADES) return;

  // ONLY trade during power hours
  if (!isInPowerHour()) return;

  const totalPositions = Object.keys(positions).length + Object.keys(shortPositions).length;

  // ONLY trade in confirmed bull or bear — NEVER neutral
  if (currentRegime === 'neutral') return;
  if (totalPositions >= maxPositions) return;

  const momentum = getMomentum(symbol);
  const signalScore = getSignalScore(indicators, daily);
  const bearishScore = getBearishScore(indicators, daily);

  // LONG — requires ALL 5 signals + volume + 0.5% above open + bull regime
  if (currentRegime === 'bull' && signalScore >= 5 && momentum > 0) {
    if (!isUpFromOpen(symbol, currentPrice)) return;
    if (!hasStrongVolume(symbol)) return;

    const qualifyingSymbols = WATCHLIST.filter(s => {
      if (botParams.avoidSymbols.includes(s)) return false;
      if (isSkippedToday(s)) return false;
      if (positions[s] || shortPositions[s]) return false;
      if (isOnCooldown(s)) return false;
      if (!isUpFromOpen(s, realtimePrices[s]?.slice(-1)[0] || 0)) return false;
      if (!hasStrongVolume(s)) return false;
      const ind = realtimeIndicators[s] || dailyIndicators[s];
      if (!ind) return false;
      return getSignalScore(ind, dailyIndicators[s]) >= 5 && getMomentum(s) > 0;
    });

    const ranked = qualifyingSymbols
      .map(s => ({ symbol: s, score: getFullSignalScore(s) }))
      .sort((a, b) => b.score - a.score);

    const topSymbols = ranked.slice(0, maxPositions - totalPositions).map(r => r.symbol);
    if (!topSymbols.includes(symbol)) return;

    const isPreferred = botParams.preferredSymbols.includes(symbol);
    const maxTrade = getPositionSize(indicators, isPreferred, news.sentiment);
    const shares = Math.floor(maxTrade / currentPrice);
    if (shares < 1) return;

    const trailingStopPct = getDynamicTrailingStop(symbol);
    const openPrice = todayOpenPrices[symbol];
    const upFromOpenPct = openPrice ? ((currentPrice - openPrice) / openPrice * 100).toFixed(2) : 'N/A';

    lockSymbol(symbol);
    todayTradeCount++;
    console.log(`📈 LONG: ${symbol} @ $${currentPrice} | RSI: ${indicators.rsi.toFixed(1)} | Signal: 5/5 ✅ | Vol: ✅ | +${upFromOpenPct}% open | 🐂 | Stop: ${(STOP_LOSS_PCT*100).toFixed(1)}% | Target: ${(TAKE_PROFIT_PCT*100).toFixed(1)}% | Trade #${todayTradeCount}/${MAX_DAILY_TRADES}`);
    await placeOrder(symbol, shares, 'buy');
    positions[symbol] = {
      entryPrice: currentPrice,
      shares,
      highestPrice: currentPrice,
      trailingStop: currentPrice * (1 - trailingStopPct),
      trailingStopPct,
    };
    await logTrade({
      symbol, action: 'BUY', price: currentPrice, shares,
      rsi: parseFloat(indicators.rsi.toFixed(2)),
      ma10: parseFloat(indicators.ma10.toFixed(2)),
      ma20: parseFloat(indicators.ma20.toFixed(2)),
      score: indicators.macd ? parseFloat(indicators.macd.histogram.toFixed(4)) : 0,
    });
    unlockSymbol(symbol);
    return;
  }

  // SHORT — requires ALL 5 signals + volume + bear regime
  if (currentRegime === 'bear' && bearishScore >= 5 && momentum < 0) {
    if (isUpFromOpen(symbol, currentPrice)) return;
    if (!hasStrongVolume(symbol)) return;

    const isPreferred = botParams.preferredSymbols.includes(symbol);
    const maxTrade = getPositionSize(indicators, isPreferred, news.sentiment);
    const shares = Math.floor(maxTrade / currentPrice);
    if (shares < 1) return;

    const trailingStopPct = getDynamicTrailingStop(symbol);

    lockSymbol(symbol);
    todayTradeCount++;
    console.log(`📉 SHORT: ${symbol} @ $${currentPrice} | RSI: ${indicators.rsi.toFixed(1)} | Bearish: 5/5 ✅ | Vol: ✅ | 🐻 | Stop: ${(STOP_LOSS_PCT*100).toFixed(1)}% | Target: ${(TAKE_PROFIT_PCT*100).toFixed(1)}% | Trade #${todayTradeCount}/${MAX_DAILY_TRADES}`);
    await placeOrder(symbol, shares, 'sell');
    shortPositions[symbol] = {
      entryPrice: currentPrice,
      shares,
      lowestPrice: currentPrice,
      trailingStop: currentPrice * (1 + trailingStopPct),
      trailingStopPct,
    };
    await logTrade({
      symbol, action: 'SHORT', price: currentPrice, shares,
      rsi: parseFloat(indicators.rsi.toFixed(2)),
      ma10: parseFloat(indicators.ma10.toFixed(2)),
      ma20: parseFloat(indicators.ma20.toFixed(2)),
      score: indicators.macd ? parseFloat(indicators.macd.histogram.toFixed(4)) : 0,
    });
    unlockSymbol(symbol);
  }
}

function startBot() {
  console.log('🤖 dropintel — Quality > Quantity | 5/5 Signals | Power Hours | Take Profit...');
  isSubscribed = false;

  const session = getMarketSession();
  console.log(`📅 Current session: ${session}`);

  const ws = new WebSocket('wss://stream.data.alpaca.markets/v2/iex');

  loadLearnings()
    .then(() => loadAllDailyIndicators())
    .then(() => loadTodayOpenPrices())
    .then(() => refreshNewsData());
  loadExistingPositions();
  checkDailyLossLimit();
  scheduleRefresh();

  ws.on('open', () => {
    console.log('✅ Connected to Alpaca IEX WebSocket!');
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
        console.log('✅ Authenticated! Subscribing...');
        ws.send(JSON.stringify({ action: 'subscribe', trades: WATCHLIST }));
      }
      if (msg.T === 'subscription') {
        isSubscribed = true;
        console.log(`✅ Subscribed! Quality bot live — 5/5 signals | Power hours only | Max ${MAX_DAILY_TRADES} trades/day | Take profit at ${TAKE_PROFIT_PCT*100}%`);
      }
      if (msg.T === 'error') console.error('❌ Alpaca error:', JSON.stringify(msg));
      if (msg.T === 't') await analyzeAndTrade(msg.S, msg.p, msg.s);
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
