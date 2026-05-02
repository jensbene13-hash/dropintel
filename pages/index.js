import { useState, useEffect, useRef } from 'react';

const ALPACA_KEY = process.env.NEXT_PUBLIC_ALPACA_KEY;
const ALPACA_SECRET = process.env.NEXT_PUBLIC_ALPACA_SECRET;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY;

const WATCHLIST = [
  'AAPL','NVDA','MSFT','META','GOOGL','TSLA','AMZN','AMD','CRM','INTC',
  'JPM','BAC','GS','V','MA','WFC','JNJ','PFE','UNH','LLY',
  'XOM','CVX','COP','EOG','SPY','QQQ','DIA','IWM','VTI','XLF'
];

export default function Dashboard() {
  const [portfolio, setPortfolio] = useState(null);
  const [positions, setPositions] = useState([]);
  const [trades, setTrades] = useState([]);
  const [learnings, setLearnings] = useState(null);
  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', content: "Hey! I'm your trading assistant. Ask me anything about how the bot is performing!" }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const chatEndRef = useRef(null);

  useEffect(() => {
    fetchAllData();
    const interval = setInterval(fetchAllData, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  async function fetchAllData() {
    try {
      await Promise.all([fetchPortfolio(), fetchTrades(), fetchLearnings()]);
      setLoading(false);
    } catch (e) {
      setLoading(false);
    }
  }

  async function fetchPortfolio() {
    try {
      const [accountRes, posRes] = await Promise.all([
        fetch('https://paper-api.alpaca.markets/v2/account', {
          headers: { 'APCA-API-KEY-ID': ALPACA_KEY, 'APCA-API-SECRET-KEY': ALPACA_SECRET }
        }),
        fetch('https://paper-api.alpaca.markets/v2/positions', {
          headers: { 'APCA-API-KEY-ID': ALPACA_KEY, 'APCA-API-SECRET-KEY': ALPACA_SECRET }
        })
      ]);
      const account = await accountRes.json();
      const pos = await posRes.json();
      setPortfolio(account);
      if (Array.isArray(pos)) setPositions(pos);
    } catch (e) { console.error(e); }
  }

  async function fetchTrades() {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/trades?select=*&order=created_at.desc&limit=200`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      const data = await res.json();
      if (Array.isArray(data)) setTrades(data);
    } catch (e) { console.error(e); }
  }

  async function fetchLearnings() {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/learnings?select=*&order=created_at.desc&limit=1`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) setLearnings(data[0]);
    } catch (e) { console.error(e); }
  }

  async function sendChatMessage() {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = chatInput.trim();
    setChatInput('');
    setChatMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setChatLoading(true);

    try {
      const completedTrades = trades.filter(t => t.outcome);
      const wins = completedTrades.filter(t => t.outcome === 'WIN');
      const losses = completedTrades.filter(t => t.outcome === 'LOSS');
      const totalPL = completedTrades.reduce((sum, t) => sum + (parseFloat(t.profit_loss) || 0), 0);

      const context = `You are the AI assistant for dropintel, an autonomous trading bot dashboard.
Current portfolio value: $${parseFloat(portfolio?.portfolio_value || 0).toFixed(2)}
Daily change: ${(parseFloat(portfolio?.equity || 0) - parseFloat(portfolio?.last_equity || 0)).toFixed(2)}
Active positions: ${positions.length}
Total completed trades: ${completedTrades.length}
Wins: ${wins.length} | Losses: ${losses.length}
Win rate: ${completedTrades.length > 0 ? ((wins.length / completedTrades.length) * 100).toFixed(1) : 0}%
Total P&L: $${totalPL.toFixed(2)}
Best performing symbol: ${learnings?.best_symbol || 'Not enough data yet'}
Best sectors: ${learnings?.best_sectors ? JSON.parse(learnings.best_sectors).join(', ') : 'Still learning'}
Recent trades: ${JSON.stringify(trades.slice(0, 10).map(t => ({ symbol: t.symbol, action: t.action, outcome: t.outcome, pl: t.profit_loss })))}
Answer in simple friendly language. Be honest and encouraging. Keep it concise.`;

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context,
          messages: chatMessages
            .filter((m, i) => i > 0)
            .map(m => ({ role: m.role, content: m.content }))
            .concat([{ role: 'user', content: userMsg }])
        })
      });
      const data = await response.json();
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (e) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: "Oops! Something went wrong. Try again!" }]);
    }
    setChatLoading(false);
  }

  const completedTrades = trades.filter(t => t.outcome);
  const wins = completedTrades.filter(t => t.outcome === 'WIN');
  const losses = completedTrades.filter(t => t.outcome === 'LOSS');
  const winRate = completedTrades.length > 0 ? ((wins.length / completedTrades.length) * 100).toFixed(1) : 0;
  const totalPL = completedTrades.reduce((sum, t) => sum + (parseFloat(t.profit_loss) || 0), 0);
  const portfolioValue = parseFloat(portfolio?.portfolio_value || 100000);
  const totalGain = portfolioValue - 100000;
  const totalGainPct = ((totalGain / 100000) * 100).toFixed(2);
  const dailyChange = parseFloat(portfolio?.equity || 0) - parseFloat(portfolio?.last_equity || 0);
  const dailyChangePct = portfolio?.last_equity ? ((dailyChange / parseFloat(portfolio.last_equity)) * 100).toFixed(2) : 0;

  const tradesByDay = trades.reduce((acc, t) => {
    const day = t.created_at?.split('T')[0];
    if (!day) return acc;
    if (!acc[day]) acc[day] = { wins: 0, losses: 0, pl: 0, trades: [] };
    if (t.outcome === 'WIN') acc[day].wins++;
    if (t.outcome === 'LOSS') acc[day].losses++;
    acc[day].pl += parseFloat(t.profit_loss || 0);
    acc[day].trades.push(t);
    return acc;
  }, {});

  const sortedDays = Object.keys(tradesByDay).sort((a, b) => b.localeCompare(a));

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 48, height: 48, border: '3px solid #00d4ff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 16px' }} />
        <p style={{ color: '#888', fontFamily: 'monospace' }}>Loading dropintel...</p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: '#fff', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #111; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        .tab { cursor: pointer; padding: 8px 20px; border-radius: 20px; font-size: 14px; font-weight: 500; transition: all 0.2s; border: none; background: transparent; color: #666; font-family: inherit; }
        .tab.active { background: #1a1a2e; color: #00d4ff; }
        .tab:hover:not(.active) { color: #aaa; }
        .card { background: #111827; border: 1px solid #1f2937; border-radius: 16px; padding: 20px; }
        .metric { background: #0d1117; border: 1px solid #1f2937; border-radius: 12px; padding: 16px; }
        .win-badge { background: #064e3b; color: #10b981; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
        .loss-badge { background: #450a0a; color: #ef4444; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
        .chat-bubble { padding: 12px 16px; border-radius: 16px; font-size: 14px; line-height: 1.6; max-width: 85%; }
        .chat-user { background: #1a3a6e; margin-left: auto; border-radius: 16px 16px 4px 16px; }
        .chat-bot { background: #1a1a2e; border-radius: 16px 16px 16px 4px; }
        .pulse { animation: pulse 2s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .trade-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #1a1a2e; font-size: 13px; }
        .trade-row:last-child { border-bottom: none; }
        input:focus { outline: none; }
        button { font-family: inherit; }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: '1px solid #1f2937', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#0d1117' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, background: 'linear-gradient(135deg, #00d4ff, #0066ff)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>💧</div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", background: 'linear-gradient(90deg, #00d4ff, #ffffff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>dropintel</h1>
            <p style={{ fontSize: 11, color: '#4b5563' }}>autonomous trading bot</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, background: '#10b981', borderRadius: '50%' }} className="pulse" />
          <span style={{ fontSize: 13, color: '#6b7280' }}>live trading</span>
        </div>
      </div>

      {/* Top Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, padding: '20px 24px 0' }}>
        {[
          { label: 'Portfolio Value', value: `$${portfolioValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, sub: `${totalGain >= 0 ? '▲' : '▼'} $${Math.abs(totalGain).toFixed(2)} (${totalGainPct}%) all time`, subColor: totalGain >= 0 ? '#10b981' : '#ef4444' },
          { label: "Today's Change", value: `${dailyChange >= 0 ? '+' : ''}$${dailyChange.toFixed(2)}`, valueColor: dailyChange >= 0 ? '#10b981' : '#ef4444', sub: `${dailyChange >= 0 ? '▲' : '▼'} ${Math.abs(dailyChangePct)}% today`, subColor: dailyChange >= 0 ? '#10b981' : '#ef4444' },
          { label: 'Win Rate', value: `${winRate}%`, valueColor: parseFloat(winRate) >= 50 ? '#10b981' : parseFloat(winRate) >= 35 ? '#f59e0b' : '#ef4444', sub: `${wins.length}W / ${losses.length}L of ${completedTrades.length} trades`, subColor: '#6b7280' },
          { label: 'Active Positions', value: `${positions.length}`, sub: parseFloat(winRate) >= 65 ? '🔥 Max 8 slots' : parseFloat(winRate) >= 50 ? '✅ Max 5 slots' : parseFloat(winRate) >= 35 ? '⚠️ Max 3 slots' : '🔴 Max 2 slots', subColor: '#6b7280' },
        ].map(stat => (
          <div key={stat.label} className="metric">
            <p style={{ fontSize: 11, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{stat.label}</p>
            <p style={{ fontSize: 24, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", color: stat.valueColor || '#fff' }}>{stat.value}</p>
            <p style={{ fontSize: 12, color: stat.subColor, marginTop: 4 }}>{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, padding: '16px 24px 0', flexWrap: 'wrap' }}>
        {['overview', 'positions', 'trades', 'history', 'watchlist', 'ai chat'].map(tab => (
          <button key={tab} className={`tab ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>
            {tab === 'ai chat' ? '🤖 AI Chat' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div style={{ padding: '16px 24px 32px' }}>

        {/* OVERVIEW */}
        {activeTab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <span style={{ fontSize: 20 }}>🧠</span>
                <h2 style={{ fontSize: 16, fontWeight: 600 }}>What the Bot Learned</h2>
              </div>
              {learnings ? (
                <div style={{ display: 'grid', gap: 10 }}>
                  {[
                    { label: 'Win Rate', value: `${parseFloat(learnings.win_rate || 0).toFixed(1)}%`, color: parseFloat(learnings.win_rate) >= 50 ? '#10b981' : '#ef4444' },
                    { label: 'Best Stock', value: learnings.best_symbol || 'Still learning...', color: '#00d4ff' },
                    { label: 'Best Sectors', value: learnings.best_sectors ? JSON.parse(learnings.best_sectors).join(', ') : 'Learning...', color: '#a78bfa' },
                    { label: 'Trades Analyzed', value: String(learnings.total_trades || 0), color: '#fff' },
                    { label: 'Ideal RSI Range', value: `35 – ${learnings.recommended_max_rsi || 65}`, color: '#fff' },
                  ].map(item => (
                    <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0d1117', padding: '10px 14px', borderRadius: 10 }}>
                      <span style={{ fontSize: 13, color: '#9ca3af' }}>{item.label}</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: item.color }}>{item.value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '30px 0', color: '#6b7280' }}>
                  <p style={{ fontSize: 32, marginBottom: 8 }}>📚</p>
                  <p style={{ fontSize: 14 }}>Still collecting data!</p>
                  <p style={{ fontSize: 12, marginTop: 4 }}>Needs a few completed trades to start learning.</p>
                </div>
              )}
            </div>

            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <span style={{ fontSize: 20 }}>📊</span>
                <h2 style={{ fontSize: 16, fontWeight: 600 }}>Today's Summary</h2>
              </div>
              {sortedDays.length > 0 && tradesByDay[sortedDays[0]] ? (() => {
                const today = tradesByDay[sortedDays[0]];
                const wr = (today.wins + today.losses) > 0 ? ((today.wins / (today.wins + today.losses)) * 100).toFixed(0) : 0;
                return (
                  <div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
                      <div style={{ textAlign: 'center', background: '#064e3b', borderRadius: 12, padding: '16px 8px' }}>
                        <p style={{ fontSize: 28, fontWeight: 700, color: '#10b981' }}>{today.wins}</p>
                        <p style={{ fontSize: 11, color: '#6ee7b7' }}>WINS 🟢</p>
                      </div>
                      <div style={{ textAlign: 'center', background: '#450a0a', borderRadius: 12, padding: '16px 8px' }}>
                        <p style={{ fontSize: 28, fontWeight: 700, color: '#ef4444' }}>{today.losses}</p>
                        <p style={{ fontSize: 11, color: '#fca5a5' }}>LOSSES 🔴</p>
                      </div>
                      <div style={{ textAlign: 'center', background: today.pl >= 0 ? '#064e3b' : '#450a0a', borderRadius: 12, padding: '16px 8px' }}>
                        <p style={{ fontSize: 20, fontWeight: 700, color: today.pl >= 0 ? '#10b981' : '#ef4444' }}>{today.pl >= 0 ? '+' : ''}${today.pl.toFixed(2)}</p>
                        <p style={{ fontSize: 11, color: today.pl >= 0 ? '#6ee7b7' : '#fca5a5' }}>P&L 💰</p>
                      </div>
                    </div>
                    <div style={{ background: '#0d1117', borderRadius: 12, padding: '14px 16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontSize: 13, color: '#9ca3af' }}>Win rate today</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: parseFloat(wr) >= 50 ? '#10b981' : '#ef4444' }}>{wr}%</span>
                      </div>
                      <div style={{ background: '#1f2937', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${wr}%`, background: parseFloat(wr) >= 50 ? '#10b981' : '#ef4444', borderRadius: 4 }} />
                      </div>
                    </div>
                  </div>
                );
              })() : (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#6b7280' }}>
                  <p style={{ fontSize: 32, marginBottom: 8 }}>😴</p>
                  <p style={{ fontSize: 14 }}>No trades yet today!</p>
                </div>
              )}
            </div>

            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <span style={{ fontSize: 20 }}>🎯</span>
                <h2 style={{ fontSize: 16, fontWeight: 600 }}>Overall Win Rate</h2>
              </div>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <p style={{ fontSize: 56, fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", color: parseFloat(winRate) >= 50 ? '#10b981' : '#ef4444' }}>{winRate}%</p>
                <p style={{ fontSize: 14, color: '#6b7280' }}>win rate</p>
              </div>
              <div style={{ display: 'flex', height: 24, borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
                <div style={{ width: `${winRate}%`, background: '#10b981' }} />
                <div style={{ flex: 1, background: '#ef4444' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#9ca3af', marginBottom: 16 }}>
                <span>🟢 {wins.length} wins</span>
                <span>🔴 {losses.length} losses</span>
              </div>
              <div style={{ padding: '12px 16px', background: '#0d1117', borderRadius: 10, textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: '#9ca3af' }}>
                  {parseFloat(winRate) >= 65 ? '🔥 Amazing! Running at full 8 positions!' :
                   parseFloat(winRate) >= 50 ? '✅ Good job! Unlocked 5 positions!' :
                   parseFloat(winRate) >= 35 ? '⚠️ Getting there! Running at 3 positions.' :
                   '🔴 Learning phase — running carefully at 2 positions.'}
                </p>
              </div>
            </div>

            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <span style={{ fontSize: 20 }}>💰</span>
                <h2 style={{ fontSize: 16, fontWeight: 600 }}>Money Made / Lost</h2>
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ background: '#064e3b', borderRadius: 12, padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ fontSize: 11, color: '#6ee7b7', marginBottom: 4 }}>TOTAL FROM WINS 🟢</p>
                    <p style={{ fontSize: 22, fontWeight: 700, color: '#10b981' }}>+${wins.reduce((s, t) => s + (parseFloat(t.profit_loss) || 0), 0).toFixed(2)}</p>
                  </div>
                  <span style={{ fontSize: 32 }}>📈</span>
                </div>
                <div style={{ background: '#450a0a', borderRadius: 12, padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ fontSize: 11, color: '#fca5a5', marginBottom: 4 }}>TOTAL FROM LOSSES 🔴</p>
                    <p style={{ fontSize: 22, fontWeight: 700, color: '#ef4444' }}>${losses.reduce((s, t) => s + (parseFloat(t.profit_loss) || 0), 0).toFixed(2)}</p>
                  </div>
                  <span style={{ fontSize: 32 }}>📉</span>
                </div>
                <div style={{ background: totalPL >= 0 ? '#064e3b' : '#450a0a', borderRadius: 12, padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ fontSize: 11, color: totalPL >= 0 ? '#6ee7b7' : '#fca5a5', marginBottom: 4 }}>NET P&L 💵</p>
                    <p style={{ fontSize: 22, fontWeight: 700, color: totalPL >= 0 ? '#10b981' : '#ef4444' }}>{totalPL >= 0 ? '+' : ''}${totalPL.toFixed(2)}</p>
                  </div>
                  <span style={{ fontSize: 32 }}>{totalPL >= 0 ? '🎉' : '😬'}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* POSITIONS */}
        {activeTab === 'positions' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 20 }}>📋</span>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>Active Positions</h2>
              <span style={{ background: '#1a3a6e', color: '#60a5fa', padding: '2px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>{positions.length} open</span>
            </div>
            {positions.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '60px 0' }}>
                <p style={{ fontSize: 48, marginBottom: 12 }}>🤖</p>
                <p style={{ fontSize: 16, color: '#9ca3af' }}>No open positions right now</p>
                <p style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>The bot is scanning for the perfect opportunity...</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {positions.map(pos => {
                  const pl = parseFloat(pos.unrealized_pl || 0);
                  const plPct = parseFloat(pos.unrealized_plpc || 0) * 100;
                  const isProfit = pl >= 0;
                  return (
                    <div key={pos.symbol} style={{ background: '#111827', border: `1px solid ${isProfit ? '#065f46' : '#7f1d1d'}`, borderRadius: 16, padding: '16px 20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 44, height: 44, background: isProfit ? '#064e3b' : '#450a0a', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, color: isProfit ? '#10b981' : '#ef4444' }}>
                            {pos.symbol.slice(0, 4)}
                          </div>
                          <div>
                            <p style={{ fontWeight: 700, fontSize: 16 }}>{pos.symbol}</p>
                            <p style={{ fontSize: 12, color: '#6b7280' }}>{pos.qty} shares @ ${parseFloat(pos.avg_entry_price).toFixed(2)}</p>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <p style={{ fontSize: 20, fontWeight: 700, color: isProfit ? '#10b981' : '#ef4444' }}>{isProfit ? '+' : ''}${pl.toFixed(2)}</p>
                          <p style={{ fontSize: 12, color: isProfit ? '#10b981' : '#ef4444' }}>{isProfit ? '▲' : '▼'} {Math.abs(plPct).toFixed(2)}%</p>
                        </div>
                      </div>
                      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                        {[
                          { label: 'CURRENT', value: `$${parseFloat(pos.current_price || 0).toFixed(2)}` },
                          { label: 'MARKET VALUE', value: `$${parseFloat(pos.market_value || 0).toFixed(2)}` },
                          { label: 'SIDE', value: pos.side?.toUpperCase(), color: pos.side === 'long' ? '#10b981' : '#ef4444' },
                        ].map(item => (
                          <div key={item.label} style={{ background: '#0d1117', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                            <p style={{ fontSize: 10, color: '#6b7280', marginBottom: 2 }}>{item.label}</p>
                            <p style={{ fontSize: 13, fontWeight: 600, color: item.color || '#fff' }}>{item.value}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TRADES */}
        {activeTab === 'trades' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 20 }}>🔄</span>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>Recent Trades</h2>
              <span style={{ background: '#1a1a2e', color: '#a78bfa', padding: '2px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>{trades.length} total</span>
            </div>
            <div className="card">
              {trades.slice(0, 50).map((trade, i) => (
                <div key={i} className="trade-row">
                  <div style={{ width: 40, height: 40, background: trade.action === 'BUY' ? '#1a3a6e' : trade.outcome === 'WIN' ? '#064e3b' : '#450a0a', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: trade.action === 'BUY' ? '#60a5fa' : trade.outcome === 'WIN' ? '#10b981' : '#ef4444', flexShrink: 0 }}>
                    {trade.action === 'BUY' ? 'BUY' : trade.action === 'SHORT' ? 'SHORT' : 'SELL'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 600, fontSize: 14 }}>{trade.symbol}</p>
                    <p style={{ fontSize: 11, color: '#6b7280' }}>{trade.shares} shares @ ${parseFloat(trade.price || 0).toFixed(2)}</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {trade.outcome ? (
                      <>
                        <span className={trade.outcome === 'WIN' ? 'win-badge' : 'loss-badge'}>{trade.outcome === 'WIN' ? '✓ WIN' : '✗ LOSS'}</span>
                        {trade.profit_loss && <p style={{ fontSize: 12, color: parseFloat(trade.profit_loss) >= 0 ? '#10b981' : '#ef4444', marginTop: 4 }}>{parseFloat(trade.profit_loss) >= 0 ? '+' : ''}${parseFloat(trade.profit_loss).toFixed(2)}</p>}
                      </>
                    ) : <span style={{ fontSize: 11, color: '#6b7280' }}>holding...</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#4b5563', textAlign: 'right', minWidth: 60 }}>
                    {trade.created_at?.split('T')[1]?.slice(0, 5)}
                    <br />
                    {trade.created_at?.split('T')[0]}
                  </div>
                </div>
              ))}
              {trades.length === 0 && <div style={{ textAlign: 'center', padding: '40px 0', color: '#6b7280' }}>No trades yet!</div>}
            </div>
          </div>
        )}

        {/* HISTORY */}
        {activeTab === 'history' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 20 }}>📅</span>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>Daily History</h2>
            </div>
            {sortedDays.length === 0 ? (
              <div className="card" style={{ textAlign: 'center', padding: '60px 0' }}>
                <p style={{ fontSize: 14, color: '#6b7280' }}>No history yet — check back after market hours!</p>
              </div>
            ) : sortedDays.map(day => {
              const d = tradesByDay[day];
              const total = d.wins + d.losses;
              const wr = total > 0 ? ((d.wins / total) * 100).toFixed(0) : 0;
              return (
                <div key={day} className="card" style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <div>
                      <p style={{ fontWeight: 700, fontSize: 16 }}>{new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</p>
                      <p style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{total} completed trades</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: 22, fontWeight: 700, color: d.pl >= 0 ? '#10b981' : '#ef4444' }}>{d.pl >= 0 ? '+' : ''}${d.pl.toFixed(2)}</p>
                      <p style={{ fontSize: 12, color: d.pl >= 0 ? '#10b981' : '#ef4444' }}>{d.pl >= 0 ? '✅ Profit day' : '❌ Loss day'}</p>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
                    <div style={{ background: '#064e3b', borderRadius: 10, padding: '10px', textAlign: 'center' }}>
                      <p style={{ fontSize: 22, fontWeight: 700, color: '#10b981' }}>{d.wins}</p>
                      <p style={{ fontSize: 10, color: '#6ee7b7' }}>WINS 🟢</p>
                    </div>
                    <div style={{ background: '#450a0a', borderRadius: 10, padding: '10px', textAlign: 'center' }}>
                      <p style={{ fontSize: 22, fontWeight: 700, color: '#ef4444' }}>{d.losses}</p>
                      <p style={{ fontSize: 10, color: '#fca5a5' }}>LOSSES 🔴</p>
                    </div>
                    <div style={{ background: '#0d1117', borderRadius: 10, padding: '10px', textAlign: 'center' }}>
                      <p style={{ fontSize: 22, fontWeight: 700, color: parseFloat(wr) >= 50 ? '#10b981' : '#ef4444' }}>{wr}%</p>
                      <p style={{ fontSize: 10, color: '#9ca3af' }}>WIN RATE</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {d.trades.filter(t => t.outcome).map((t, i) => (
                      <span key={i} style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, background: t.outcome === 'WIN' ? '#064e3b' : '#450a0a', color: t.outcome === 'WIN' ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                        {t.symbol} {t.outcome === 'WIN' ? '+' : ''}{parseFloat(t.profit_loss || 0).toFixed(2)}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* WATCHLIST */}
        {activeTab === 'watchlist' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 20 }}>👁️</span>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>Stocks Being Watched</h2>
              <span style={{ background: '#1a1a2e', color: '#a78bfa', padding: '2px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>{WATCHLIST.length} stocks</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {WATCHLIST.map(symbol => {
                const symbolTrades = trades.filter(t => t.symbol === symbol && t.outcome);
                const sw = symbolTrades.filter(t => t.outcome === 'WIN').length;
                const sl = symbolTrades.filter(t => t.outcome === 'LOSS').length;
                const hasPosition = positions.find(p => p.symbol === symbol);
                const isAvoided = trades.filter(t => t.symbol === symbol && t.outcome === 'LOSS').length >= 5;
                const pl = symbolTrades.reduce((s, t) => s + (parseFloat(t.profit_loss) || 0), 0);
                return (
                  <div key={symbol} style={{ background: hasPosition ? '#0c1a2e' : '#111827', border: `1px solid ${hasPosition ? '#1e40af' : isAvoided ? '#7f1d1d' : '#1f2937'}`, borderRadius: 12, padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{symbol}</span>
                      {hasPosition && <span style={{ background: '#1e40af', color: '#93c5fd', fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>ACTIVE</span>}
                      {isAvoided && !hasPosition && <span style={{ background: '#7f1d1d', color: '#fca5a5', fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>AVOID</span>}
                    </div>
                    {symbolTrades.length > 0 ? (
                      <div>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 11, color: '#10b981' }}>✓ {sw}W</span>
                          <span style={{ fontSize: 11, color: '#ef4444' }}>✗ {sl}L</span>
                        </div>
                        <p style={{ fontSize: 12, color: pl >= 0 ? '#10b981' : '#ef4444', fontWeight: 600 }}>{pl >= 0 ? '+' : ''}${pl.toFixed(2)}</p>
                      </div>
                    ) : <p style={{ fontSize: 11, color: '#4b5563' }}>No trades yet</p>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* AI CHAT */}
        {activeTab === 'ai chat' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 20 }}>🤖</span>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>Ask Your Trading AI</h2>
            </div>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', height: 520 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                {['How did the bot do today?', 'Why are we losing?', 'Which stocks are best?', 'Should I add real money?'].map(p => (
                  <button key={p} onClick={() => setChatInput(p)} style={{ background: '#1a1a2e', border: '1px solid #2d3748', color: '#9ca3af', padding: '6px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer' }}>{p}</button>
                ))}
              </div>
              <div style={{ flex: 1, overflowY: 'auto', marginBottom: 16 }}>
                {chatMessages.map((msg, i) => (
                  <div key={i} style={{ marginBottom: 12, display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', alignItems: 'flex-start', gap: 8 }}>
                    {msg.role === 'assistant' && <div style={{ width: 28, height: 28, background: '#1a3a6e', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0, marginTop: 2 }}>🤖</div>}
                    <div className={`chat-bubble ${msg.role === 'user' ? 'chat-user' : 'chat-bot'}`}>{msg.content}</div>
                  </div>
                ))}
                {chatLoading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 28, height: 28, background: '#1a3a6e', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🤖</div>
                    <div style={{ background: '#1a1a2e', padding: '12px 16px', borderRadius: '16px 16px 16px 4px' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {[0,1,2].map(i => <div key={i} style={{ width: 6, height: 6, background: '#60a5fa', borderRadius: '50%', animation: `pulse 1s infinite`, animationDelay: `${i*0.2}s` }} />)}
                      </div>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChatMessage()} placeholder="Ask anything about your bot..." style={{ flex: 1, background: '#0d1117', border: '1px solid #1f2937', color: '#fff', padding: '10px 16px', borderRadius: 12, fontSize: 14 }} />
                <button onClick={sendChatMessage} disabled={chatLoading || !chatInput.trim()} style={{ background: chatLoading || !chatInput.trim() ? '#1f2937' : '#0066ff', border: 'none', color: '#fff', padding: '10px 20px', borderRadius: 12, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>Send</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
