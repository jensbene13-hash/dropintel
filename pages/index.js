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
  const [tab, setTab] = useState('overview');
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState([{ role: 'assistant', content: "Hi! I'm your trading AI. Ask me anything about the bot!" }]);
  const [chatLoading, setChatLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const chatEndRef = useRef(null);

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  async function load() {
    try {
      const [acc, pos] = await Promise.all([
        fetch('https://paper-api.alpaca.markets/v2/account', { headers: { 'APCA-API-KEY-ID': ALPACA_KEY, 'APCA-API-SECRET-KEY': ALPACA_SECRET } }).then(r => r.json()),
        fetch('https://paper-api.alpaca.markets/v2/positions', { headers: { 'APCA-API-KEY-ID': ALPACA_KEY, 'APCA-API-SECRET-KEY': ALPACA_SECRET } }).then(r => r.json()),
      ]);
      setPortfolio(acc);
      if (Array.isArray(pos)) setPositions(pos);

      const tr = await fetch(`${SUPABASE_URL}/rest/v1/trades?select=*&order=created_at.desc&limit=300`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }).then(r => r.json());
      if (Array.isArray(tr)) setTrades(tr);

      const ln = await fetch(`${SUPABASE_URL}/rest/v1/learnings?select=*&order=created_at.desc&limit=1`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }).then(r => r.json());
      if (Array.isArray(ln) && ln.length > 0) setLearnings(ln[0]);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function sendChat() {
    if (!chatInput.trim() || chatLoading) return;
    const msg = chatInput.trim();
    setChatInput('');
    setChatMessages(p => [...p, { role: 'user', content: msg }]);
    setChatLoading(true);
    try {
      const done = trades.filter(t => t.outcome);
      const wins = done.filter(t => t.outcome === 'WIN');
      const pl = done.reduce((s, t) => s + (parseFloat(t.profit_loss) || 0), 0);
      const ctx = `You are the AI assistant for dropintel, an autonomous day trading bot.
Portfolio: $${parseFloat(portfolio?.portfolio_value || 0).toFixed(2)}
Daily change: $${(parseFloat(portfolio?.equity || 0) - parseFloat(portfolio?.last_equity || 0)).toFixed(2)}
Open positions: ${positions.length}
Completed trades: ${done.length} | Wins: ${wins.length} | Losses: ${done.length - wins.length}
Win rate: ${done.length > 0 ? ((wins.length / done.length) * 100).toFixed(1) : 0}%
Net P&L: $${pl.toFixed(2)}
Best symbol: ${learnings?.best_symbol || 'unknown'}
Recent trades: ${JSON.stringify(trades.slice(0, 8).map(t => ({ s: t.symbol, a: t.action, o: t.outcome, pl: t.profit_loss })))}
Answer simply and clearly like explaining to a friend. Be honest.`;
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: ctx, messages: chatMessages.slice(1).concat([{ role: 'user', content: msg }]) }) });
      const d = await res.json();
      setChatMessages(p => [...p, { role: 'assistant', content: d.reply }]);
    } catch { setChatMessages(p => [...p, { role: 'assistant', content: 'Something went wrong, try again!' }]); }
    setChatLoading(false);
  }

  const done = trades.filter(t => t.outcome);
  const wins = done.filter(t => t.outcome === 'WIN');
  const losses = done.filter(t => t.outcome === 'LOSS');
  const winRate = done.length > 0 ? ((wins.length / done.length) * 100).toFixed(1) : 0;
  const netPL = done.reduce((s, t) => s + (parseFloat(t.profit_loss) || 0), 0);
  const portfolioVal = parseFloat(portfolio?.portfolio_value || 100000);
  const totalGain = portfolioVal - 100000;
  const dailyChange = parseFloat(portfolio?.equity || 0) - parseFloat(portfolio?.last_equity || 0);

  const byDay = trades.reduce((acc, t) => {
    const d = t.created_at?.split('T')[0]; if (!d) return acc;
    if (!acc[d]) acc[d] = { wins: 0, losses: 0, pl: 0, trades: [] };
    if (t.outcome === 'WIN') acc[d].wins++;
    if (t.outcome === 'LOSS') acc[d].losses++;
    acc[d].pl += parseFloat(t.profit_loss || 0);
    acc[d].trades.push(t);
    return acc;
  }, {});
  const days = Object.keys(byDay).sort((a, b) => b.localeCompare(a));

  const maxPos = parseFloat(winRate) >= 65 ? 8 : parseFloat(winRate) >= 50 ? 5 : parseFloat(winRate) >= 35 ? 3 : 2;

  const s = {
    page: { minHeight: '100vh', background: '#080b14', color: '#e2e8f0', fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 14 },
    header: { background: '#0d1117', borderBottom: '1px solid #1e2d3d', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
    logo: { display: 'flex', alignItems: 'center', gap: 10 },
    logoIcon: { width: 38, height: 38, background: 'linear-gradient(135deg, #00d4ff 0%, #0066ff 100%)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 },
    logoText: { fontSize: 22, fontWeight: 700, background: 'linear-gradient(90deg, #00d4ff, #fff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' },
    live: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#64748b' },
    dot: { width: 8, height: 8, background: '#10b981', borderRadius: '50%', animation: 'pulse 2s infinite' },
    tabs: { display: 'flex', gap: 4, padding: '14px 24px 0', borderBottom: '1px solid #1e2d3d', background: '#0d1117' },
    tab: (active) => ({ padding: '8px 18px', borderRadius: '8px 8px 0 0', fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none', background: active ? '#080b14' : 'transparent', color: active ? '#00d4ff' : '#64748b', borderBottom: active ? '2px solid #00d4ff' : '2px solid transparent' }),
    content: { padding: '20px 24px' },
    grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
    grid4: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 },
    grid3: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 },
    card: { background: '#0d1117', border: '1px solid #1e2d3d', borderRadius: 14, padding: '18px 20px' },
    metric: { background: '#0d1117', border: '1px solid #1e2d3d', borderRadius: 12, padding: '14px 16px' },
    label: { fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 },
    bigNum: { fontSize: 26, fontWeight: 700, marginBottom: 4 },
    sub: { fontSize: 12 },
    cardTitle: { fontSize: 15, fontWeight: 600, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 },
    row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px', background: '#080b14', borderRadius: 8, marginBottom: 6 },
    green: { color: '#10b981' },
    red: { color: '#ef4444' },
    badge: (green) => ({ background: green ? '#064e3b' : '#450a0a', color: green ? '#10b981' : '#ef4444', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }),
    posCard: (profit) => ({ background: profit ? '#051a11' : '#1a0505', border: `1px solid ${profit ? '#065f46' : '#7f1d1d'}`, borderRadius: 14, padding: '16px 18px', marginBottom: 10 }),
    watchItem: (active, avoid) => ({ background: active ? '#0c1a2e' : '#0d1117', border: `1px solid ${active ? '#1e40af' : avoid ? '#7f1d1d' : '#1e2d3d'}`, borderRadius: 10, padding: '12px 14px' }),
    chatBubble: (user) => ({ padding: '10px 14px', borderRadius: user ? '16px 16px 4px 16px' : '16px 16px 16px 4px', background: user ? '#1a3a6e' : '#1a1f2e', maxWidth: '82%', fontSize: 14, lineHeight: 1.6 }),
    input: { flex: 1, background: '#0d1117', border: '1px solid #1e2d3d', color: '#e2e8f0', padding: '10px 14px', borderRadius: 10, fontSize: 14, outline: 'none' },
    sendBtn: (ok) => ({ background: ok ? '#0066ff' : '#1e2d3d', border: 'none', color: '#fff', padding: '10px 20px', borderRadius: 10, cursor: ok ? 'pointer' : 'default', fontWeight: 600, fontSize: 14 }),
    quickBtn: { background: '#0d1117', border: '1px solid #1e2d3d', color: '#94a3b8', padding: '5px 12px', borderRadius: 16, fontSize: 12, cursor: 'pointer' },
  };

  if (loading) return (
    <div style={{ ...s.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 44, height: 44, border: '3px solid #00d4ff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
        <p style={{ color: '#64748b' }}>Loading dropintel...</p>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  );

  return (
    <div style={s.page}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}} *{box-sizing:border-box;margin:0;padding:0} ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-thumb{background:#1e2d3d;border-radius:2px} input:focus{outline:none}`}</style>

      {/* Header */}
      <div style={s.header}>
        <div style={s.logo}>
          <div style={s.logoIcon}>💧</div>
          <div>
            <div style={s.logoText}>dropintel</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>autonomous trading bot</div>
          </div>
        </div>
        <div style={s.live}>
          <div style={s.dot} />
          bot is live
        </div>
      </div>

      {/* Tabs */}
      <div style={s.tabs}>
        {['overview','positions','trades','history','watchlist','ai chat'].map(t => (
          <button key={t} style={s.tab(tab === t)} onClick={() => setTab(t)}>
            {t === 'ai chat' ? '🤖 AI Chat' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div style={s.content}>

        {/* OVERVIEW */}
        {tab === 'overview' && <>
          <div style={s.grid4}>
            <div style={s.metric}>
              <div style={s.label}>Portfolio Value</div>
              <div style={s.bigNum}>${portfolioVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div style={{ ...s.sub, color: totalGain >= 0 ? '#10b981' : '#ef4444' }}>{totalGain >= 0 ? '▲' : '▼'} ${Math.abs(totalGain).toFixed(2)} all time</div>
            </div>
            <div style={s.metric}>
              <div style={s.label}>Today's Change</div>
              <div style={{ ...s.bigNum, color: dailyChange >= 0 ? '#10b981' : '#ef4444' }}>{dailyChange >= 0 ? '+' : ''}${dailyChange.toFixed(2)}</div>
              <div style={{ ...s.sub, color: dailyChange >= 0 ? '#10b981' : '#ef4444' }}>{dailyChange >= 0 ? '▲ profit' : '▼ loss'} today</div>
            </div>
            <div style={s.metric}>
              <div style={s.label}>Win Rate</div>
              <div style={{ ...s.bigNum, color: parseFloat(winRate) >= 50 ? '#10b981' : parseFloat(winRate) >= 35 ? '#f59e0b' : '#ef4444' }}>{winRate}%</div>
              <div style={{ ...s.sub, color: '#64748b' }}>{wins.length}W / {losses.length}L of {done.length} trades</div>
            </div>
            <div style={s.metric}>
              <div style={s.label}>Open Positions</div>
              <div style={s.bigNum}>{positions.length}</div>
              <div style={{ ...s.sub, color: '#64748b' }}>Max {maxPos} slots {parseFloat(winRate) >= 65 ? '🔥' : parseFloat(winRate) >= 50 ? '✅' : parseFloat(winRate) >= 35 ? '⚠️' : '🔴'}</div>
            </div>
          </div>

          <div style={s.grid2}>
            {/* Today */}
            <div style={s.card}>
              <div style={s.cardTitle}><span>📊</span> Today's Results</div>
              {days.length > 0 && byDay[days[0]] ? (() => {
                const td = byDay[days[0]];
                const wr = (td.wins + td.losses) > 0 ? ((td.wins / (td.wins + td.losses)) * 100).toFixed(0) : 0;
                return <>
                  <div style={s.grid3}>
                    <div style={{ textAlign: 'center', background: '#064e3b', borderRadius: 10, padding: 14 }}>
                      <div style={{ fontSize: 28, fontWeight: 700, color: '#10b981' }}>{td.wins}</div>
                      <div style={{ fontSize: 11, color: '#6ee7b7' }}>WINS 🟢</div>
                    </div>
                    <div style={{ textAlign: 'center', background: '#450a0a', borderRadius: 10, padding: 14 }}>
                      <div style={{ fontSize: 28, fontWeight: 700, color: '#ef4444' }}>{td.losses}</div>
                      <div style={{ fontSize: 11, color: '#fca5a5' }}>LOSSES 🔴</div>
                    </div>
                    <div style={{ textAlign: 'center', background: td.pl >= 0 ? '#064e3b' : '#450a0a', borderRadius: 10, padding: 14 }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: td.pl >= 0 ? '#10b981' : '#ef4444' }}>{td.pl >= 0 ? '+' : ''}${td.pl.toFixed(2)}</div>
                      <div style={{ fontSize: 11, color: td.pl >= 0 ? '#6ee7b7' : '#fca5a5' }}>P&L 💰</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 12, background: '#080b14', borderRadius: 10, padding: '10px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>Win rate today</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: parseFloat(wr) >= 50 ? '#10b981' : '#ef4444' }}>{wr}%</span>
                    </div>
                    <div style={{ background: '#1e2d3d', borderRadius: 4, height: 6 }}>
                      <div style={{ height: '100%', width: `${wr}%`, background: parseFloat(wr) >= 50 ? '#10b981' : '#ef4444', borderRadius: 4 }} />
                    </div>
                  </div>
                </>;
              })() : <div style={{ textAlign: 'center', padding: '30px 0', color: '#64748b' }}>😴 No trades yet today</div>}
            </div>

            {/* P&L */}
            <div style={s.card}>
              <div style={s.cardTitle}><span>💰</span> Money Made / Lost</div>
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ background: '#064e3b', borderRadius: 12, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#6ee7b7', marginBottom: 4 }}>FROM WINS 🟢</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#10b981' }}>+${wins.reduce((s, t) => s + (parseFloat(t.profit_loss) || 0), 0).toFixed(2)}</div>
                  </div>
                  <span style={{ fontSize: 28 }}>📈</span>
                </div>
                <div style={{ background: '#450a0a', borderRadius: 12, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#fca5a5', marginBottom: 4 }}>FROM LOSSES 🔴</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#ef4444' }}>${losses.reduce((s, t) => s + (parseFloat(t.profit_loss) || 0), 0).toFixed(2)}</div>
                  </div>
                  <span style={{ fontSize: 28 }}>📉</span>
                </div>
                <div style={{ background: netPL >= 0 ? '#064e3b' : '#450a0a', borderRadius: 12, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 11, color: netPL >= 0 ? '#6ee7b7' : '#fca5a5', marginBottom: 4 }}>NET TOTAL 💵</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: netPL >= 0 ? '#10b981' : '#ef4444' }}>{netPL >= 0 ? '+' : ''}${netPL.toFixed(2)}</div>
                  </div>
                  <span style={{ fontSize: 28 }}>{netPL >= 0 ? '🎉' : '😬'}</span>
                </div>
              </div>
            </div>

            {/* Learning */}
            <div style={s.card}>
              <div style={s.cardTitle}><span>🧠</span> What the Bot Learned</div>
              {learnings ? [
                ['Win Rate', `${parseFloat(learnings.win_rate || 0).toFixed(1)}%`, parseFloat(learnings.win_rate) >= 50 ? '#10b981' : '#ef4444'],
                ['Best Stock', learnings.best_symbol || 'Still learning...', '#00d4ff'],
                ['Best Sectors', learnings.best_sectors ? JSON.parse(learnings.best_sectors).join(', ') : 'Learning...', '#a78bfa'],
                ['Trades Analyzed', String(learnings.total_trades || 0), '#e2e8f0'],
                ['Ideal RSI', `35 – ${learnings.recommended_max_rsi || 65}`, '#e2e8f0'],
              ].map(([label, val, color]) => (
                <div key={label} style={s.row}>
                  <span style={{ color: '#94a3b8', fontSize: 13 }}>{label}</span>
                  <span style={{ fontWeight: 600, color, fontSize: 13 }}>{val}</span>
                </div>
              )) : <div style={{ textAlign: 'center', padding: '30px 0', color: '#64748b' }}>📚 Still collecting data...</div>}
            </div>

            {/* Bot Status */}
            <div style={s.card}>
              <div style={s.cardTitle}><span>🤖</span> Bot Status</div>
              {[
                ['Mode', parseFloat(winRate) >= 65 ? '🔥 Full Power (8 positions)' : parseFloat(winRate) >= 50 ? '✅ Standard (5 positions)' : parseFloat(winRate) >= 35 ? '⚠️ Cautious (3 positions)' : '🔴 Learning (2 positions)'],
                ['Win Rate', `${winRate}% — ${parseFloat(winRate) >= 50 ? 'Profitable!' : 'Still learning'}`],
                ['Net P&L', `${netPL >= 0 ? '+' : ''}$${netPL.toFixed(2)} from ${done.length} trades`],
                ['Open Now', `${positions.length} positions open`],
                ['Watching', `${WATCHLIST.length} stocks`],
              ].map(([label, val]) => (
                <div key={label} style={s.row}>
                  <span style={{ color: '#94a3b8', fontSize: 13 }}>{label}</span>
                  <span style={{ fontWeight: 500, fontSize: 13 }}>{val}</span>
                </div>
              ))}
            </div>
          </div>
        </>}

        {/* POSITIONS */}
        {tab === 'positions' && <>
          <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>📋</span>
            <span style={{ fontSize: 17, fontWeight: 600 }}>Active Positions</span>
            <span style={{ background: '#1e3a5f', color: '#60a5fa', padding: '2px 10px', borderRadius: 12, fontSize: 12 }}>{positions.length} open</span>
          </div>
          {positions.length === 0 ? (
            <div style={{ ...s.card, textAlign: 'center', padding: '60px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>🔍</div>
              <div style={{ color: '#94a3b8' }}>No open positions — bot is scanning for opportunities</div>
            </div>
          ) : positions.map(p => {
            const pl = parseFloat(p.unrealized_pl || 0);
            const pct = parseFloat(p.unrealized_plpc || 0) * 100;
            const profit = pl >= 0;
            return (
              <div key={p.symbol} style={s.posCard(profit)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 44, height: 44, background: profit ? '#064e3b' : '#450a0a', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, color: profit ? '#10b981' : '#ef4444' }}>{p.symbol.slice(0,4)}</div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>{p.symbol}</div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>{p.qty} shares @ ${parseFloat(p.avg_entry_price).toFixed(2)}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: profit ? '#10b981' : '#ef4444' }}>{profit ? '+' : ''}${pl.toFixed(2)}</div>
                    <div style={{ fontSize: 12, color: profit ? '#10b981' : '#ef4444' }}>{profit ? '▲' : '▼'} {Math.abs(pct).toFixed(2)}%</div>
                  </div>
                </div>
                <div style={s.grid3}>
                  {[['Current Price', `$${parseFloat(p.current_price || 0).toFixed(2)}`], ['Market Value', `$${parseFloat(p.market_value || 0).toFixed(2)}`], ['Side', p.side?.toUpperCase()]].map(([l, v]) => (
                    <div key={l} style={{ background: '#080b14', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 2 }}>{l}</div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </>}

        {/* TRADES */}
        {tab === 'trades' && <>
          <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>🔄</span>
            <span style={{ fontSize: 17, fontWeight: 600 }}>All Trades</span>
            <span style={{ background: '#1e1a3f', color: '#a78bfa', padding: '2px 10px', borderRadius: 12, fontSize: 12 }}>{trades.length} total</span>
          </div>
          <div style={s.card}>
            {trades.slice(0, 60).map((t, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: '1px solid #1e2d3d' }}>
                <div style={{ width: 40, height: 40, background: t.action === 'BUY' ? '#1e3a5f' : t.outcome === 'WIN' ? '#064e3b' : '#450a0a', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: t.action === 'BUY' ? '#60a5fa' : t.outcome === 'WIN' ? '#10b981' : '#ef4444', flexShrink: 0 }}>
                  {t.action === 'BUY' ? 'BUY' : t.action === 'SHORT' ? 'SHT' : 'SELL'}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{t.symbol}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{t.shares} shares @ ${parseFloat(t.price || 0).toFixed(2)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  {t.outcome ? <>
                    <span style={s.badge(t.outcome === 'WIN')}>{t.outcome === 'WIN' ? '✓ WIN' : '✗ LOSS'}</span>
                    {t.profit_loss && <div style={{ fontSize: 12, color: parseFloat(t.profit_loss) >= 0 ? '#10b981' : '#ef4444', marginTop: 3 }}>{parseFloat(t.profit_loss) >= 0 ? '+' : ''}${parseFloat(t.profit_loss).toFixed(2)}</div>}
                  </> : <span style={{ fontSize: 11, color: '#64748b' }}>holding...</span>}
                </div>
                <div style={{ fontSize: 11, color: '#475569', textAlign: 'right', minWidth: 55 }}>
                  {t.created_at?.split('T')[1]?.slice(0,5)}<br />{t.created_at?.split('T')[0]}
                </div>
              </div>
            ))}
            {trades.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>No trades yet!</div>}
          </div>
        </>}

        {/* HISTORY */}
        {tab === 'history' && <>
          <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>📅</span>
            <span style={{ fontSize: 17, fontWeight: 600 }}>Daily History</span>
          </div>
          {days.length === 0 ? (
            <div style={{ ...s.card, textAlign: 'center', padding: '60px 0', color: '#64748b' }}>No history yet!</div>
          ) : days.map(day => {
            const d = byDay[day];
            const total = d.wins + d.losses;
            const wr = total > 0 ? ((d.wins / total) * 100).toFixed(0) : 0;
            return (
              <div key={day} style={{ ...s.card, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{total} completed trades</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: d.pl >= 0 ? '#10b981' : '#ef4444' }}>{d.pl >= 0 ? '+' : ''}${d.pl.toFixed(2)}</div>
                    <div style={{ fontSize: 12, color: d.pl >= 0 ? '#10b981' : '#ef4444' }}>{d.pl >= 0 ? '✅ Profit day' : '❌ Loss day'}</div>
                  </div>
                </div>
                <div style={{ ...s.grid3, marginBottom: 10 }}>
                  <div style={{ textAlign: 'center', background: '#064e3b', borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#10b981' }}>{d.wins}</div>
                    <div style={{ fontSize: 10, color: '#6ee7b7' }}>WINS 🟢</div>
                  </div>
                  <div style={{ textAlign: 'center', background: '#450a0a', borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444' }}>{d.losses}</div>
                    <div style={{ fontSize: 10, color: '#fca5a5' }}>LOSSES 🔴</div>
                  </div>
                  <div style={{ textAlign: 'center', background: '#080b14', borderRadius: 10, padding: 12 }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: parseFloat(wr) >= 50 ? '#10b981' : '#ef4444' }}>{wr}%</div>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>WIN RATE</div>
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
        </>}

        {/* WATCHLIST */}
        {tab === 'watchlist' && <>
          <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>👁️</span>
            <span style={{ fontSize: 17, fontWeight: 600 }}>Stocks Being Watched</span>
            <span style={{ background: '#1e1a3f', color: '#a78bfa', padding: '2px 10px', borderRadius: 12, fontSize: 12 }}>{WATCHLIST.length} stocks</span>
          </div>
          <div style={s.grid3}>
            {WATCHLIST.map(sym => {
              const st = trades.filter(t => t.symbol === sym && t.outcome);
              const sw = st.filter(t => t.outcome === 'WIN').length;
              const sl = st.filter(t => t.outcome === 'LOSS').length;
              const hasPos = positions.find(p => p.symbol === sym);
              const avoided = st.filter(t => t.outcome === 'LOSS').length >= 5;
              const pl = st.reduce((s, t) => s + (parseFloat(t.profit_loss) || 0), 0);
              return (
                <div key={sym} style={s.watchItem(hasPos, avoided)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{sym}</span>
                    {hasPos && <span style={{ background: '#1e3a5f', color: '#93c5fd', fontSize: 10, padding: '1px 6px', borderRadius: 4 }}>ACTIVE</span>}
                    {avoided && !hasPos && <span style={{ background: '#450a0a', color: '#fca5a5', fontSize: 10, padding: '1px 6px', borderRadius: 4 }}>AVOID</span>}
                  </div>
                  {st.length > 0 ? <>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: '#10b981' }}>✓{sw}W</span>
                      <span style={{ fontSize: 11, color: '#ef4444' }}>✗{sl}L</span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: pl >= 0 ? '#10b981' : '#ef4444' }}>{pl >= 0 ? '+' : ''}${pl.toFixed(2)}</div>
                  </> : <div style={{ fontSize: 11, color: '#475569' }}>No trades yet</div>}
                </div>
              );
            })}
          </div>
        </>}

        {/* AI CHAT */}
        {tab === 'ai chat' && <>
          <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>🤖</span>
            <span style={{ fontSize: 17, fontWeight: 600 }}>Ask Your Trading AI</span>
          </div>
          <div style={{ ...s.card, display: 'flex', flexDirection: 'column', height: 520 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              {['How did we do today?', 'Why are we losing?', 'Which stock is best?', 'Should I add real money?'].map(p => (
                <button key={p} style={s.quickBtn} onClick={() => setChatInput(p)}>{p}</button>
              ))}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12 }}>
              {chatMessages.map((m, i) => (
                <div key={i} style={{ marginBottom: 10, display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 8 }}>
                  {m.role === 'assistant' && <div style={{ width: 28, height: 28, background: '#1e3a5f', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>🤖</div>}
                  <div style={s.chatBubble(m.role === 'user')}>{m.content}</div>
                </div>
              ))}
              {chatLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 28, height: 28, background: '#1e3a5f', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🤖</div>
                  <div style={{ background: '#1a1f2e', padding: '10px 14px', borderRadius: '16px 16px 16px 4px' }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[0,1,2].map(i => <div key={i} style={{ width: 6, height: 6, background: '#60a5fa', borderRadius: '50%', animation: `pulse 1s ${i*0.2}s infinite` }} />)}
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChat()} placeholder="Ask anything about your bot..." style={s.input} />
              <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()} style={s.sendBtn(!chatLoading && chatInput.trim())}>Send</button>
            </div>
          </div>
        </>}

      </div>
    </div>
  );
}
