// dropintel dashboard v3
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
  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', content: "Hi! I'm your trading AI. Ask me anything about the bot!" }
  ]);
  const [chatLoading, setChatLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const chatEndRef = useRef(null);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  async function load() {
    try {
      const [acc, pos] = await Promise.all([
        fetch('https://paper-api.alpaca.markets/v2/account', {
          headers: { 'APCA-API-KEY-ID': ALPACA_KEY, 'APCA-API-SECRET-KEY': ALPACA_SECRET }
        }).then(r => r.json()),
        fetch('https://paper-api.alpaca.markets/v2/positions', {
          headers: { 'APCA-API-KEY-ID': ALPACA_KEY, 'APCA-API-SECRET-KEY': ALPACA_SECRET }
        }).then(r => r.json()),
      ]);
      setPortfolio(acc);
      if (Array.isArray(pos)) setPositions(pos);
      const tr = await fetch(
        `${SUPABASE_URL}/rest/v1/trades?select=*&order=created_at.desc&limit=300`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      ).then(r => r.json());
      if (Array.isArray(tr)) setTrades(tr);
      const ln = await fetch(
        `${SUPABASE_URL}/rest/v1/learnings?select=*&order=created_at.desc&limit=1`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      ).then(r => r.json());
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
Portfolio value: $${parseFloat(portfolio?.portfolio_value || 0).toFixed(2)}
Daily change: $${(parseFloat(portfolio?.equity || 0) - parseFloat(portfolio?.last_equity || 0)).toFixed(2)}
Open positions: ${positions.length}
Completed trades: ${done.length} | Wins: ${wins.length} | Losses: ${done.length - wins.length}
Win rate: ${done.length > 0 ? ((wins.length / done.length) * 100).toFixed(1) : 0}%
Net P&L: $${pl.toFixed(2)}
Best symbol: ${learnings?.best_symbol || 'unknown'}
Best sectors: ${learnings?.best_sectors ? JSON.parse(learnings.best_sectors).join(', ') : 'unknown'}
Recent trades: ${JSON.stringify(trades.slice(0, 8).map(t => ({ symbol: t.symbol, action: t.action, outcome: t.outcome, pl: t.profit_loss })))}
Answer simply and clearly like explaining to a friend. Be honest and encouraging.`;
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: ctx, messages: chatMessages.slice(1).concat([{ role: 'user', content: msg }]) })
      });
      const d = await res.json();
      setChatMessages(p => [...p, { role: 'assistant', content: d.reply }]);
    } catch {
      setChatMessages(p => [...p, { role: 'assistant', content: 'Something went wrong, try again!' }]);
    }
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
  const maxPos = parseFloat(winRate) >= 65 ? 8 : parseFloat(winRate) >= 50 ? 5 : parseFloat(winRate) >= 35 ? 3 : 2;

  const byDay = trades.reduce((acc, t) => {
    const d = t.created_at?.split('T')[0];
    if (!d) return acc;
    if (!acc[d]) acc[d] = { wins: 0, losses: 0, pl: 0, trades: [] };
    if (t.outcome === 'WIN') acc[d].wins++;
    if (t.outcome === 'LOSS') acc[d].losses++;
    acc[d].pl += parseFloat(t.profit_loss || 0);
    acc[d].trades.push(t);
    return acc;
  }, {});
  const days = Object.keys(byDay).sort((a, b) => b.localeCompare(a));

  const G = {
    green: '#10b981', red: '#ef4444', muted: '#64748b',
    card: { background: '#0d1117', border: '1px solid #1e2d3d', borderRadius: 14, padding: '18px 20px' },
    stat: { background: '#0d1117', border: '1px solid #1e2d3d', borderRadius: 12, padding: '14px 16px' },
    row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px', background: '#080b14', borderRadius: 8, marginBottom: 6 },
    g2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
    g3: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 },
    g4: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 },
  };

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#080b14', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 44, height: 44, border: '3px solid #00d4ff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
        <p style={{ color: '#64748b', fontFamily: 'system-ui', fontSize: 14 }}>Loading dropintel...</p>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#080b14', color: '#e2e8f0', fontFamily: 'system-ui,-apple-system,sans-serif', fontSize: 14 }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}} *{box-sizing:border-box;margin:0;padding:0} ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-thumb{background:#1e2d3d;border-radius:2px} input:focus,button:focus{outline:none}`}</style>

      {/* Header */}
      <div style={{ background: '#0d1117', borderBottom: '1px solid #1e2d3d', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 38, height: 38, background: 'linear-gradient(135deg,#00d4ff,#0066ff)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>💧</div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, background: 'linear-gradient(90deg,#00d4ff,#fff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>dropintel</div>
            <div style={{ fontSize: 11, color: '#475569' }}>autonomous trading bot</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#64748b' }}>
          <div style={{ width: 8, height: 8, background: '#10b981', borderRadius: '50%', animation: 'pulse 2s infinite' }} />
          bot is live
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, padding: '0 24px', background: '#0d1117', borderBottom: '1px solid #1e2d3d' }}>
        {['overview','positions','trades','history','watchlist','ai chat'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '12px 18px', fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none', background: 'transparent', color: tab === t ? '#00d4ff' : '#64748b', borderBottom: tab === t ? '2px solid #00d4ff' : '2px solid transparent', fontFamily: 'inherit' }}>
            {t === 'ai chat' ? '🤖 AI Chat' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div style={{ padding: '20px 24px 40px' }}>

        {/* OVERVIEW */}
        {tab === 'overview' && <>
          <div style={G.g4}>
            {[
              { label: 'Portfolio Value', val: `$${portfolioVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, sub: `${totalGain >= 0 ? '▲' : '▼'} $${Math.abs(totalGain).toFixed(2)} all time`, subC: totalGain >= 0 ? G.green : G.red },
              { label: "Today's Change", val: `${dailyChange >= 0 ? '+' : ''}$${dailyChange.toFixed(2)}`, valC: dailyChange >= 0 ? G.green : G.red, sub: dailyChange >= 0 ? '▲ profit day' : '▼ loss day', subC: dailyChange >= 0 ? G.green : G.red },
              { label: 'Win Rate', val: `${winRate}%`, valC: parseFloat(winRate) >= 50 ? G.green : parseFloat(winRate) >= 35 ? '#f59e0b' : G.red, sub: `${wins.length}W / ${losses.length}L of ${done.length} trades`, subC: G.muted },
              { label: 'Open Positions', val: `${positions.length}`, sub: `Max ${maxPos} slots ${parseFloat(winRate) >= 65 ? '🔥' : parseFloat(winRate) >= 50 ? '✅' : parseFloat(winRate) >= 35 ? '⚠️' : '🔴'}`, subC: G.muted },
            ].map(s => (
              <div key={s.label} style={G.stat}>
                <div style={{ fontSize: 11, color: G.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 4, color: s.valC || '#e2e8f0' }}>{s.val}</div>
                <div style={{ fontSize: 12, color: s.subC }}>{s.sub}</div>
              </div>
            ))}
          </div>

          <div style={G.g2}>
            <div style={G.card}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}><span>📊</span> Today's Results</div>
              {days.length > 0 && byDay[days[0]] ? (() => {
                const td = byDay[days[0]];
                const wr = (td.wins + td.losses) > 0 ? ((td.wins / (td.wins + td.losses)) * 100).toFixed(0) : 0;
                return <>
                  <div style={G.g3}>
                    <div style={{ textAlign: 'center', background: '#064e3b', borderRadius: 10, padding: 14 }}>
                      <div style={{ fontSize: 28, fontWeight: 700, color: G.green }}>{td.wins}</div>
                      <div style={{ fontSize: 11, color: '#6ee7b7' }}>WINS 🟢</div>
                    </div>
                    <div style={{ textAlign: 'center', background: '#450a0a', borderRadius: 10, padding: 14 }}>
                      <div style={{ fontSize: 28, fontWeight: 700, color: G.red }}>{td.losses}</div>
                      <div style={{ fontSize: 11, color: '#fca5a5' }}>LOSSES 🔴</div>
                    </div>
                    <div style={{ textAlign: 'center', background: td.pl >= 0 ? '#064e3b' : '#450a0a', borderRadius: 10, padding: 14 }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: td.pl >= 0 ? G.green : G.red }}>{td.pl >= 0 ? '+' : ''}${td.pl.toFixed(2)}</div>
                      <div style={{ fontSize: 11, color: td.pl >= 0 ? '#6ee7b7' : '#fca5a5' }}>P&L 💰</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 12, background: '#080b14', borderRadius: 10, padding: '10px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>Win rate today</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: parseFloat(wr) >= 50 ? G.green : G.red }}>{wr}%</span>
                    </div>
                    <div style={{ background: '#1e2d3d', borderRadius: 4, height: 6 }}>
                      <div style={{ height: '100%', width: `${wr}%`, background: parseFloat(wr) >= 50 ? G.green : G.red, borderRadius: 4 }} />
                    </div>
                  </div>
                </>;
              })() : <div style={{ textAlign: 'center', padding: '30px 0', color: G.muted }}><div style={{ fontSize: 36, marginBottom: 8 }}>😴</div>No trades yet today</div>}
            </div>

            <div style={G.card}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}><span>💰</span> Money Made / Lost</div>
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ background: '#064e3b', borderRadius: 12, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div><div style={{ fontSize: 11, color: '#6ee7b7', marginBottom: 4 }}>FROM WINS 🟢</div><div style={{ fontSize: 20, fontWeight: 700, color: G.green }}>+${wins.reduce((s,t) => s+(parseFloat(t.profit_loss)||0),0).toFixed(2)}</div></div>
                  <span style={{ fontSize: 28 }}>📈</span>
                </div>
                <div style={{ background: '#450a0a', borderRadius: 12, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div><div style={{ fontSize: 11, color: '#fca5a5', marginBottom: 4 }}>FROM LOSSES 🔴</div><div style={{ fontSize: 20, fontWeight: 700, color: G.red }}>${losses.reduce((s,t) => s+(parseFloat(t.profit_loss)||0),0).toFixed(2)}</div></div>
                  <span style={{ fontSize: 28 }}>📉</span>
                </div>
                <div style={{ background: netPL >= 0 ? '#064e3b' : '#450a0a', borderRadius: 12, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div><div style={{ fontSize: 11, color: netPL >= 0 ? '#6ee7b7' : '#fca5a5', marginBottom: 4 }}>NET TOTAL 💵</div><div style={{ fontSize: 20, fontWeight: 700, color: netPL >= 0 ? G.green : G.red }}>{netPL >= 0 ? '+' : ''}${netPL.toFixed(2)}</div></div>
                  <span style={{ fontSize: 28 }}>{netPL >= 0 ? '🎉' : '😬'}</span>
                </div>
              </div>
            </div>

            <div style={G.card}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}><span>🧠</span> What the Bot Learned</div>
              {learnings ? [
                ['Win Rate', `${parseFloat(learnings.win_rate||0).toFixed(1)}%`, parseFloat(learnings.win_rate)>=50 ? G.green : G.red],
                ['Best Stock', learnings.best_symbol||'Still learning...', '#00d4ff'],
                ['Best Sectors', learnings.best_sectors ? JSON.parse(learnings.best_sectors).join(', ') : 'Learning...', '#a78bfa'],
                ['Trades Analyzed', String(learnings.total_trades||0), '#e2e8f0'],
                ['Ideal RSI', `35 – ${learnings.recommended_max_rsi||65}`, '#e2e8f0'],
              ].map(([label,val,color]) => (
                <div key={label} style={G.row}><span style={{ color:'#94a3b8',fontSize:13 }}>{label}</span><span style={{ fontWeight:600,color,fontSize:13 }}>{val}</span></div>
              )) : <div style={{ textAlign:'center',padding:'30px 0',color:G.muted }}><div style={{ fontSize:36,marginBottom:8 }}>📚</div>Still collecting data...</div>}
            </div>

            <div style={G.card}>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}><span>🤖</span> Bot Status</div>
              {[
                ['Mode', parseFloat(winRate)>=65?'🔥 Full Power (8 pos)':parseFloat(winRate)>=50?'✅ Standard (5 pos)':parseFloat(winRate)>=35?'⚠️ Cautious (3 pos)':'🔴 Learning (2 pos)'],
                ['Win Rate', `${winRate}% — ${parseFloat(winRate)>=50?'Profitable!':'Still learning'}`],
                ['Net P&L', `${netPL>=0?'+':''}$${netPL.toFixed(2)} from ${done.length} trades`],
                ['Open Now', `${positions.length} of ${maxPos} slots used`],
                ['Watching', `${WATCHLIST.length} stocks every second`],
              ].map(([label,val]) => (
                <div key={label} style={G.row}><span style={{ color:'#94a3b8',fontSize:13 }}>{label}</span><span style={{ fontWeight:500,fontSize:13 }}>{val}</span></div>
              ))}
            </div>
          </div>
        </>}

        {/* POSITIONS */}
        {tab === 'positions' && <>
          <div style={{ marginBottom:14,display:'flex',alignItems:'center',gap:10 }}>
            <span style={{ fontSize:18 }}>📋</span>
            <span style={{ fontSize:17,fontWeight:600 }}>Active Positions</span>
            <span style={{ background:'#1e3a5f',color:'#60a5fa',padding:'2px 10px',borderRadius:12,fontSize:12 }}>{positions.length} open</span>
          </div>
          {positions.length === 0 ? (
            <div style={{ ...G.card,textAlign:'center',padding:'60px 0' }}>
              <div style={{ fontSize:40,marginBottom:10 }}>🔍</div>
              <div style={{ color:'#94a3b8' }}>No open positions right now</div>
              <div style={{ fontSize:12,color:G.muted,marginTop:6 }}>The bot is scanning for the perfect trade...</div>
            </div>
          ) : positions.map(p => {
            const pl = parseFloat(p.unrealized_pl||0);
            const pct = parseFloat(p.unrealized_plpc||0)*100;
            const profit = pl >= 0;
            return (
              <div key={p.symbol} style={{ background:profit?'#051a11':'#1a0505',border:`1px solid ${profit?'#065f46':'#7f1d1d'}`,borderRadius:14,padding:'16px 18px',marginBottom:10 }}>
                <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12 }}>
                  <div style={{ display:'flex',alignItems:'center',gap:12 }}>
                    <div style={{ width:44,height:44,background:profit?'#064e3b':'#450a0a',borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:12,color:profit?G.green:G.red }}>{p.symbol.slice(0,4)}</div>
                    <div>
                      <div style={{ fontWeight:700,fontSize:16 }}>{p.symbol}</div>
                      <div style={{ fontSize:12,color:G.muted }}>{p.qty} shares @ ${parseFloat(p.avg_entry_price).toFixed(2)}</div>
                    </div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:20,fontWeight:700,color:profit?G.green:G.red }}>{profit?'+':''}${pl.toFixed(2)}</div>
                    <div style={{ fontSize:12,color:profit?G.green:G.red }}>{profit?'▲':'▼'} {Math.abs(pct).toFixed(2)}%</div>
                  </div>
                </div>
                <div style={G.g3}>
                  {[['Current Price',`$${parseFloat(p.current_price||0).toFixed(2)}`],['Market Value',`$${parseFloat(p.market_value||0).toFixed(2)}`],['Side',p.side?.toUpperCase()]].map(([l,v]) => (
                    <div key={l} style={{ background:'#080b14',borderRadius:8,padding:'8px 10px',textAlign:'center' }}>
                      <div style={{ fontSize:10,color:G.muted,marginBottom:2 }}>{l}</div>
                      <div style={{ fontSize:13,fontWeight:600 }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </>}

        {/* TRADES */}
        {tab === 'trades' && <>
          <div style={{ marginBottom:14,display:'flex',alignItems:'center',gap:10 }}>
            <span style={{ fontSize:18 }}>🔄</span>
            <span style={{ fontSize:17,fontWeight:600 }}>All Trades</span>
            <span style={{ background:'#1e1a3f',color:'#a78bfa',padding:'2px 10px',borderRadius:12,fontSize:12 }}>{trades.length} total</span>
          </div>
          <div style={G.card}>
            {trades.slice(0,60).map((t,i) => (
              <div key={i} style={{ display:'flex',alignItems:'center',gap:12,padding:'9px 0',borderBottom:'1px solid #1e2d3d' }}>
                <div style={{ width:40,height:40,background:t.action==='BUY'?'#1e3a5f':t.outcome==='WIN'?'#064e3b':'#450a0a',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,color:t.action==='BUY'?'#60a5fa':t.outcome==='WIN'?G.green:G.red,flexShrink:0 }}>
                  {t.action==='BUY'?'BUY':t.action==='SHORT'?'SHT':'SELL'}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:600,fontSize:14 }}>{t.symbol}</div>
                  <div style={{ fontSize:11,color:G.muted }}>{t.shares} shares @ ${parseFloat(t.price||0).toFixed(2)}</div>
                </div>
                <div style={{ textAlign:'right' }}>
                  {t.outcome ? <>
                    <span style={{ background:t.outcome==='WIN'?'#064e3b':'#450a0a',color:t.outcome==='WIN'?G.green:G.red,padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:600 }}>{t.outcome==='WIN'?'✓ WIN':'✗ LOSS'}</span>
                    {t.profit_loss && <div style={{ fontSize:12,color:parseFloat(t.profit_loss)>=0?G.green:G.red,marginTop:3 }}>{parseFloat(t.profit_loss)>=0?'+':''}${parseFloat(t.profit_loss).toFixed(2)}</div>}
                  </> : <span style={{ fontSize:11,color:G.muted }}>holding...</span>}
                </div>
                <div style={{ fontSize:11,color:'#475569',textAlign:'right',minWidth:55 }}>
                  {t.created_at?.split('T')[1]?.slice(0,5)}<br/>{t.created_at?.split('T')[0]}
                </div>
              </div>
            ))}
            {trades.length===0 && <div style={{ textAlign:'center',padding:40,color:G.muted }}>No trades yet!</div>}
          </div>
        </>}

        {/* HISTORY */}
        {tab === 'history' && <>
          <div style={{ marginBottom:14,display:'flex',alignItems:'center',gap:10 }}>
            <span style={{ fontSize:18 }}>📅</span>
            <span style={{ fontSize:17,fontWeight:600 }}>Daily History</span>
          </div>
          {days.length===0 ? (
            <div style={{ ...G.card,textAlign:'center',padding:'60px 0',color:G.muted }}>No history yet!</div>
          ) : days.map(day => {
            const d = byDay[day];
            const total = d.wins+d.losses;
            const wr = total>0 ? ((d.wins/total)*100).toFixed(0) : 0;
            return (
              <div key={day} style={{ ...G.card,marginBottom:12 }}>
                <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12 }}>
                  <div>
                    <div style={{ fontWeight:700,fontSize:15 }}>{new Date(day+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'})}</div>
                    <div style={{ fontSize:12,color:G.muted,marginTop:2 }}>{total} completed trades</div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:20,fontWeight:700,color:d.pl>=0?G.green:G.red }}>{d.pl>=0?'+':''}${d.pl.toFixed(2)}</div>
                    <div style={{ fontSize:12,color:d.pl>=0?G.green:G.red }}>{d.pl>=0?'✅ Profit day':'❌ Loss day'}</div>
                  </div>
                </div>
                <div style={{ ...G.g3,marginBottom:10 }}>
                  <div style={{ textAlign:'center',background:'#064e3b',borderRadius:10,padding:12 }}><div style={{ fontSize:24,fontWeight:700,color:G.green }}>{d.wins}</div><div style={{ fontSize:10,color:'#6ee7b7' }}>WINS 🟢</div></div>
                  <div style={{ textAlign:'center',background:'#450a0a',borderRadius:10,padding:12 }}><div style={{ fontSize:24,fontWeight:700,color:G.red }}>{d.losses}</div><div style={{ fontSize:10,color:'#fca5a5' }}>LOSSES 🔴</div></div>
                  <div style={{ textAlign:'center',background:'#080b14',borderRadius:10,padding:12 }}><div style={{ fontSize:24,fontWeight:700,color:parseFloat(wr)>=50?G.green:G.red }}>{wr}%</div><div style={{ fontSize:10,color:'#94a3b8' }}>WIN RATE</div></div>
                </div>
                <div style={{ display:'flex',flexWrap:'wrap',gap:6 }}>
                  {d.trades.filter(t=>t.outcome).map((t,i)=>(
                    <span key={i} style={{ padding:'3px 10px',borderRadius:6,fontSize:11,background:t.outcome==='WIN'?'#064e3b':'#450a0a',color:t.outcome==='WIN'?G.green:G.red,fontWeight:600 }}>
                      {t.symbol} {t.outcome==='WIN'?'+':''}{parseFloat(t.profit_loss||0).toFixed(2)}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </>}

        {/* WATCHLIST */}
        {tab === 'watchlist' && <>
          <div style={{ marginBottom:14,display:'flex',alignItems:'center',gap:10 }}>
            <span style={{ fontSize:18 }}>👁️</span>
            <span style={{ fontSize:17,fontWeight:600 }}>Stocks Being Watched</span>
            <span style={{ background:'#1e1a3f',color:'#a78bfa',padding:'2px 10px',borderRadius:12,fontSize:12 }}>{WATCHLIST.length} stocks</span>
          </div>
          <div style={G.g3}>
            {WATCHLIST.map(sym=>{
              const st=trades.filter(t=>t.symbol===sym&&t.outcome);
              const sw=st.filter(t=>t.outcome==='WIN').length;
              const sl=st.filter(t=>t.outcome==='LOSS').length;
              const hasPos=positions.find(p=>p.symbol===sym);
              const avoided=sl>=5;
              const pl=st.reduce((s,t)=>s+(parseFloat(t.profit_loss)||0),0);
              return (
                <div key={sym} style={{ background:hasPos?'#0c1a2e':'#0d1117',border:`1px solid ${hasPos?'#1e40af':avoided?'#7f1d1d':'#1e2d3d'}`,borderRadius:10,padding:'12px 14px' }}>
                  <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6 }}>
                    <span style={{ fontWeight:700,fontSize:14 }}>{sym}</span>
                    {hasPos && <span style={{ background:'#1e3a5f',color:'#93c5fd',fontSize:10,padding:'1px 6px',borderRadius:4 }}>ACTIVE</span>}
                    {avoided&&!hasPos && <span style={{ background:'#450a0a',color:'#fca5a5',fontSize:10,padding:'1px 6px',borderRadius:4 }}>AVOID</span>}
                  </div>
                  {st.length>0 ? <>
                    <div style={{ display:'flex',gap:8,marginBottom:4 }}>
                      <span style={{ fontSize:11,color:G.green }}>✓{sw}W</span>
                      <span style={{ fontSize:11,color:G.red }}>✗{sl}L</span>
                    </div>
                    <div style={{ fontSize:12,fontWeight:600,color:pl>=0?G.green:G.red }}>{pl>=0?'+':''}${pl.toFixed(2)}</div>
                  </> : <div style={{ fontSize:11,color:'#475569' }}>No trades yet</div>}
                </div>
              );
            })}
          </div>
        </>}

        {/* AI CHAT */}
        {tab === 'ai chat' && <>
          <div style={{ marginBottom:14,display:'flex',alignItems:'center',gap:10 }}>
            <span style={{ fontSize:18 }}>🤖</span>
            <span style={{ fontSize:17,fontWeight:600 }}>Ask Your Trading AI</span>
          </div>
          <div style={{ ...G.card,display:'flex',flexDirection:'column',height:520 }}>
            <div style={{ display:'flex',gap:8,marginBottom:14,flexWrap:'wrap' }}>
              {['How did we do today?','Why are we losing?','Which stock is best?','Should I add real money?'].map(p=>(
                <button key={p} onClick={()=>setChatInput(p)} style={{ background:'#080b14',border:'1px solid #1e2d3d',color:'#94a3b8',padding:'5px 12px',borderRadius:16,fontSize:12,cursor:'pointer',fontFamily:'inherit' }}>{p}</button>
              ))}
            </div>
            <div style={{ flex:1,overflowY:'auto',marginBottom:12 }}>
              {chatMessages.map((m,i)=>(
                <div key={i} style={{ marginBottom:10,display:'flex',justifyContent:m.role==='user'?'flex-end':'flex-start',alignItems:'flex-end',gap:8 }}>
                  {m.role==='assistant' && <div style={{ width:28,height:28,background:'#1e3a5f',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,flexShrink:0 }}>🤖</div>}
                  <div style={{ padding:'10px 14px',borderRadius:m.role==='user'?'16px 16px 4px 16px':'16px 16px 16px 4px',background:m.role==='user'?'#1a3a6e':'#1a1f2e',maxWidth:'82%',fontSize:14,lineHeight:1.6 }}>{m.content}</div>
                </div>
              ))}
              {chatLoading && (
                <div style={{ display:'flex',alignItems:'center',gap:8 }}>
                  <div style={{ width:28,height:28,background:'#1e3a5f',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center' }}>🤖</div>
                  <div style={{ background:'#1a1f2e',padding:'10px 14px',borderRadius:'16px 16px 16px 4px' }}>
                    <div style={{ display:'flex',gap:4 }}>
                      {[0,1,2].map(i=><div key={i} style={{ width:6,height:6,background:'#60a5fa',borderRadius:'50%',animation:`pulse 1s ${i*0.2}s infinite` }}/>)}
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef}/>
            </div>
            <div style={{ display:'flex',gap:10 }}>
              <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendChat()} placeholder="Ask anything about your bot..." style={{ flex:1,background:'#080b14',border:'1px solid #1e2d3d',color:'#e2e8f0',padding:'10px 14px',borderRadius:10,fontSize:14,fontFamily:'inherit' }}/>
              <button onClick={sendChat} disabled={chatLoading||!chatInput.trim()} style={{ background:!chatLoading&&chatInput.trim()?'#0066ff':'#1e2d3d',border:'none',color:'#fff',padding:'10px 20px',borderRadius:10,cursor:!chatLoading&&chatInput.trim()?'pointer':'default',fontWeight:600,fontSize:14,fontFamily:'inherit' }}>Send</button>
            </div>
          </div>
        </>}

      </div>
    </div>
  );
}
