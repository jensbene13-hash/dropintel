// dropintel dashboard v7 - server side supabase
import { useState, useEffect, useRef } from 'react';

export default function Dashboard() {
  const [portfolio, setPortfolio] = useState(null);
  const [positions, setPositions] = useState([]);
  const [trades, setTrades] = useState([]);
  const [learnings, setLearnings] = useState(null);
  const [tab, setTab] = useState('overview');
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', content: "Hey! I'm your trading AI. Ask me anything about how the bot is doing!" }
  ]);
  const [chatLoading, setChatLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const chatEndRef = useRef(null);

  const WATCHLIST = [
    'AAPL','NVDA','MSFT','META','GOOGL','TSLA','AMZN','AMD','CRM','INTC',
    'JPM','BAC','GS','V','MA','WFC','JNJ','PFE','UNH','LLY',
    'XOM','CVX','COP','EOG','SPY','QQQ','DIA','IWM','VTI','XLF'
  ];

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
        fetch('/api/alpaca?endpoint=account').then(r => r.json()),
        fetch('/api/alpaca?endpoint=positions').then(r => r.json()),
      ]);
      setPortfolio(acc);
      if (Array.isArray(pos)) setPositions(pos);

      const tr = await fetch('/api/supabase?path=trades%3Fselect%3D*%26order%3Dcreated_at.desc%26limit%3D300').then(r => r.json());
      if (Array.isArray(tr)) setTrades(tr);

      const ln = await fetch('/api/supabase?path=learnings%3Fselect%3D*%26order%3Dcreated_at.desc%26limit%3D1').then(r => r.json());
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
      const todayStr = new Date().toISOString().split('T')[0];
      const todayTrades = done.filter(t => t.created_at?.startsWith(todayStr));
      const todayWins = todayTrades.filter(t => t.outcome === 'WIN').length;
      const todayLosses = todayTrades.filter(t => t.outcome === 'LOSS').length;
      const todayPL = todayTrades.reduce((s, t) => s + (parseFloat(t.profit_loss) || 0), 0);
      const ctx = `You are the AI assistant for dropintel, an autonomous day trading bot.
Portfolio value: $${parseFloat(portfolio?.portfolio_value || 0).toFixed(2)}
Daily change: $${(parseFloat(portfolio?.equity || 0) - parseFloat(portfolio?.last_equity || 0)).toFixed(2)}
Open positions: ${positions.length}
Today: ${todayTrades.length} trades | ${todayWins} wins | ${todayLosses} losses | $${todayPL.toFixed(2)} P&L
All time: ${done.length} trades | ${wins.length} wins | ${done.length - wins.length} losses
Win rate: ${done.length > 0 ? ((wins.length / done.length) * 100).toFixed(1) : 0}%
Net P&L: $${pl.toFixed(2)}
Best symbol: ${learnings?.best_symbol || 'still learning'}
Recent trades: ${JSON.stringify(trades.slice(0, 10).map(t => ({ symbol: t.symbol, action: t.action, outcome: t.outcome, pl: t.profit_loss })))}
Answer in a friendly, clear, conversational tone. Keep responses concise.`;
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: ctx,
          messages: chatMessages.slice(1).concat([{ role: 'user', content: msg }])
        })
      });
      const data = await response.json();
      setChatMessages(p => [...p, { role: 'assistant', content: data.reply }]);
    } catch {
      setChatMessages(p => [...p, { role: 'assistant', content: 'Something went wrong, please try again!' }]);
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

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#080b14', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 44, height: 44, border: '3px solid #00d4ff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
        <p style={{ color: '#64748b', fontFamily: 'system-ui', fontSize: 14 }}>Loading dropintel...</p>
      </div>
    </div>
  );

  const green = '#10b981', red = '#ef4444', muted = '#64748b';
  const card = { background: '#0d1117', border: '1px solid #1e2d3d', borderRadius: 14, padding: '16px' };

  return (
    <div style={{ minHeight: '100vh', background: '#080b14', color: '#e2e8f0', fontFamily: 'system-ui,-apple-system,sans-serif', fontSize: 14 }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-thumb{background:#1e2d3d;border-radius:2px}
        input:focus,button:focus{outline:none}
        .tabs{display:flex;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
        .tabs::-webkit-scrollbar{display:none}
        .stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}
        .three-col{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
        .watch-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
        @media(min-width:640px){
          .stat-grid{grid-template-columns:repeat(4,1fr)}
          .watch-grid{grid-template-columns:repeat(3,1fr)}
        }
      `}</style>

      <div style={{ background: '#0d1117', borderBottom: '1px solid #1e2d3d', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, background: 'linear-gradient(135deg,#00d4ff,#0066ff)', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>💧</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, background: 'linear-gradient(90deg,#00d4ff,#fff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>dropintel</div>
            <div style={{ fontSize: 10, color: '#475569' }}>autonomous trading bot</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b' }}>
          <div style={{ width: 7, height: 7, background: green, borderRadius: '50%', animation: 'pulse 2s infinite' }} />
          live
        </div>
      </div>

      <div className="tabs" style={{ background: '#0d1117', borderBottom: '1px solid #1e2d3d', padding: '0 16px' }}>
        {['overview','positions','trades','history','watchlist','ai chat'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '11px 16px', fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none', background: 'transparent', color: tab === t ? '#00d4ff' : '#64748b', borderBottom: tab === t ? '2px solid #00d4ff' : '2px solid transparent', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {t === 'ai chat' ? '🤖 AI' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div style={{ padding: '14px 16px 40px' }}>

        {tab === 'overview' && <>
          <div className="stat-grid">
            {[
              { label: 'Portfolio', val: `$${portfolioVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, sub: `${totalGain >= 0 ? '▲' : '▼'} $${Math.abs(totalGain).toFixed(2)}`, subC: totalGain >= 0 ? green : red },
              { label: 'Today', val: `${dailyChange >= 0 ? '+' : ''}$${dailyChange.toFixed(2)}`, valC: dailyChange >= 0 ? green : red, sub: dailyChange >= 0 ? '▲ profit' : '▼ loss', subC: dailyChange >= 0 ? green : red },
              { label: 'Win Rate', val: `${winRate}%`, valC: parseFloat(winRate) >= 50 ? green : parseFloat(winRate) >= 35 ? '#f59e0b' : red, sub: `${wins.length}W / ${losses.length}L`, subC: muted },
              { label: 'Positions', val: `${positions.length}`, sub: `Max ${maxPos} ${parseFloat(winRate) >= 65 ? '🔥' : parseFloat(winRate) >= 50 ? '✅' : parseFloat(winRate) >= 35 ? '⚠️' : '🔴'}`, subC: muted },
            ].map(s => (
              <div key={s.label} style={{ background: '#0d1117', border: '1px solid #1e2d3d', borderRadius: 12, padding: '12px 14px' }}>
                <div style={{ fontSize: 10, color: muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 2, color: s.valC || '#e2e8f0' }}>{s.val}</div>
                <div style={{ fontSize: 11, color: s.subC }}>{s.sub}</div>
              </div>
            ))}
          </div>

          <div style={{ ...card, marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>📊 Most Recent Trading Day</div>
            {days.length > 0 && byDay[days[0]] ? (() => {
              const td = byDay[days[0]];
              const wr = (td.wins + td.losses) > 0 ? ((td.wins / (td.wins + td.losses)) * 100).toFixed(0) : 0;
              const dateLabel = new Date(days[0] + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
              return (
                <>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>{dateLabel}</div>
                  <div className="three-col" style={{ marginBottom: 10 }}>
                    <div style={{ textAlign: 'center', background: '#064e3b', borderRadius: 10, padding: '12px 8px' }}>
                      <div style={{ fontSize: 26, fontWeight: 700, color: green }}>{td.wins}</div>
                      <div style={{ fontSize: 10, color: '#6ee7b7' }}>WINS 🟢</div>
                    </div>
                    <div style={{ textAlign: 'center', background: '#450a0a', borderRadius: 10, padding: '12px 8px' }}>
                      <div style={{ fontSize: 26, fontWeight: 700, color: red }}>{td.losses}</div>
                      <div style={{ fontSize: 10, color: '#fca5a5' }}>LOSSES 🔴</div>
                    </div>
                    <div style={{ textAlign: 'center', background: td.pl >= 0 ? '#064e3b' : '#450a0a', borderRadius: 10, padding: '12px 8px' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: td.pl >= 0 ? green : red }}>{td.pl >= 0 ? '+' : ''}${td.pl.toFixed(2)}</div>
                      <div style={{ fontSize: 10, color: td.pl >= 0 ? '#6ee7b7' : '#fca5a5' }}>P&L 💰</div>
                    </div>
                  </div>
                  <div style={{ background: '#080b14', borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>Win rate today</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: parseFloat(wr) >= 50 ? green : red }}>{wr}%</span>
                    </div>
                    <div style={{ background: '#1e2d3d', borderRadius: 4, height: 6 }}>
                      <div style={{ height: '100%', width: `${wr}%`, background: parseFloat(wr) >= 50 ? green : red, borderRadius: 4 }} />
                    </div>
                  </div>
                </>
              );
            })() : <div style={{ textAlign: 'center', padding: '20px 0', color: muted }}><div style={{ fontSize: 32, marginBottom: 6 }}>😴</div>No trades yet today</div>}
          </div>

          <div style={{ ...card, marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>💰 Money Made / Lost</div>
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ background: '#064e3b', borderRadius: 10, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div><div style={{ fontSize: 10, color: '#6ee7b7', marginBottom: 3 }}>FROM WINS 🟢</div><div style={{ fontSize: 18, fontWeight: 700, color: green }}>+${wins.reduce((s,t)=>s+(parseFloat(t.profit_loss)||0),0).toFixed(2)}</div></div>
                <span style={{ fontSize: 24 }}>📈</span>
              </div>
              <div style={{ background: '#450a0a', borderRadius: 10, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div><div style={{ fontSize: 10, color: '#fca5a5', marginBottom: 3 }}>FROM LOSSES 🔴</div><div style={{ fontSize: 18, fontWeight: 700, color: red }}>${losses.reduce((s,t)=>s+(parseFloat(t.profit_loss)||0),0).toFixed(2)}</div></div>
                <span style={{ fontSize: 24 }}>📉</span>
              </div>
              <div style={{ background: netPL >= 0 ? '#064e3b' : '#450a0a', borderRadius: 10, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div><div style={{ fontSize: 10, color: netPL >= 0 ? '#6ee7b7' : '#fca5a5', marginBottom: 3 }}>NET TOTAL 💵</div><div style={{ fontSize: 18, fontWeight: 700, color: netPL >= 0 ? green : red }}>{netPL >= 0 ? '+' : ''}${netPL.toFixed(2)}</div></div>
                <span style={{ fontSize: 24 }}>{netPL >= 0 ? '🎉' : '😬'}</span>
              </div>
            </div>
          </div>

          <div style={{ ...card, marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>🧠 What the Bot Learned</div>
            {learnings ? [
              ['Win Rate', `${parseFloat(learnings.win_rate||0).toFixed(1)}%`, parseFloat(learnings.win_rate)>=50 ? green : red],
              ['Best Stock', learnings.best_symbol||'Still learning...', '#00d4ff'],
              ['Best Sectors', learnings.best_sectors ? JSON.parse(learnings.best_sectors).join(', ') : 'Learning...', '#a78bfa'],
              ['Trades Analyzed', String(learnings.total_trades||0), '#e2e8f0'],
              ['Ideal RSI', `35 - ${learnings.recommended_max_rsi||65}`, '#e2e8f0'],
            ].map(([label,val,color]) => (
              <div key={label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 10px', background:'#080b14', borderRadius:8, marginBottom:5 }}>
                <span style={{ color:'#94a3b8', fontSize:13 }}>{label}</span>
                <span style={{ fontWeight:600, color, fontSize:13 }}>{val}</span>
              </div>
            )) : <div style={{ textAlign:'center', padding:'20px 0', color:muted }}><div style={{ fontSize:32, marginBottom:6 }}>📚</div>Still collecting data...</div>}
          </div>

          <div style={card}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>🤖 Bot Status</div>
            {[
              ['Mode', parseFloat(winRate)>=65?'🔥 Full Power (8)':parseFloat(winRate)>=50?'✅ Standard (5)':parseFloat(winRate)>=35?'⚠️ Cautious (3)':'🔴 Learning (2)'],
              ['Win Rate', `${winRate}% - ${parseFloat(winRate)>=50?'Profitable!':'Still learning'}`],
              ['Net P&L', `${netPL>=0?'+':''}$${netPL.toFixed(2)} from ${done.length} trades`],
              ['Open Now', `${positions.length} of ${maxPos} slots used`],
              ['Watching', `${WATCHLIST.length} stocks`],
            ].map(([label,val]) => (
              <div key={label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 10px', background:'#080b14', borderRadius:8, marginBottom:5 }}>
                <span style={{ color:'#94a3b8', fontSize:13 }}>{label}</span>
                <span style={{ fontWeight:500, fontSize:13, textAlign:'right', maxWidth:'65%' }}>{val}</span>
              </div>
            ))}
          </div>
        </>}

        {tab === 'positions' && <>
          <div style={{ marginBottom:12, display:'flex', alignItems:'center', gap:8 }}>
            <span>📋</span>
            <span style={{ fontSize:16, fontWeight:600 }}>Active Positions</span>
            <span style={{ background:'#1e3a5f', color:'#60a5fa', padding:'2px 8px', borderRadius:10, fontSize:11 }}>{positions.length} open</span>
          </div>
          {positions.length === 0 ? (
            <div style={{ ...card, textAlign:'center', padding:'50px 0' }}>
              <div style={{ fontSize:36, marginBottom:8 }}>🔍</div>
              <div style={{ color:'#94a3b8' }}>No open positions</div>
              <div style={{ fontSize:12, color:muted, marginTop:4 }}>Scanning for opportunities...</div>
            </div>
          ) : positions.map(p => {
            const pl = parseFloat(p.unrealized_pl||0);
            const pct = parseFloat(p.unrealized_plpc||0)*100;
            const profit = pl >= 0;
            return (
              <div key={p.symbol} style={{ background:profit?'#051a11':'#1a0505', border:`1px solid ${profit?'#065f46':'#7f1d1d'}`, borderRadius:14, padding:'14px 16px', marginBottom:10 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <div style={{ width:40, height:40, background:profit?'#064e3b':'#450a0a', borderRadius:10, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:11, color:profit?green:red }}>{p.symbol.slice(0,4)}</div>
                    <div>
                      <div style={{ fontWeight:700, fontSize:15 }}>{p.symbol}</div>
                      <div style={{ fontSize:11, color:muted }}>{p.qty} @ ${parseFloat(p.avg_entry_price).toFixed(2)}</div>
                    </div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:18, fontWeight:700, color:profit?green:red }}>{profit?'+':''}${pl.toFixed(2)}</div>
                    <div style={{ fontSize:11, color:profit?green:red }}>{profit?'▲':'▼'} {Math.abs(pct).toFixed(2)}%</div>
                  </div>
                </div>
                <div className="three-col">
                  {[['Price',`$${parseFloat(p.current_price||0).toFixed(2)}`],['Value',`$${parseFloat(p.market_value||0).toFixed(2)}`],['Side',p.side?.toUpperCase()]].map(([l,v]) => (
                    <div key={l} style={{ background:'#080b14', borderRadius:8, padding:'7px 8px', textAlign:'center' }}>
                      <div style={{ fontSize:9, color:muted, marginBottom:2 }}>{l}</div>
                      <div style={{ fontSize:12, fontWeight:600 }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </>}

        {tab === 'trades' && <>
          <div style={{ marginBottom:12, display:'flex', alignItems:'center', gap:8 }}>
            <span>🔄</span>
            <span style={{ fontSize:16, fontWeight:600 }}>All Trades</span>
            <span style={{ background:'#1e1a3f', color:'#a78bfa', padding:'2px 8px', borderRadius:10, fontSize:11 }}>{trades.length}</span>
          </div>
          <div style={card}>
            {trades.slice(0,60).map((t,i) => (
              <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:'1px solid #1e2d3d' }}>
                <div style={{ width:36, height:36, background:t.action==='BUY'?'#1e3a5f':t.outcome==='WIN'?'#064e3b':'#450a0a', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:700, color:t.action==='BUY'?'#60a5fa':t.outcome==='WIN'?green:red, flexShrink:0 }}>
                  {t.action==='BUY'?'BUY':t.action==='SHORT'?'SHT':'SELL'}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:600, fontSize:13 }}>{t.symbol}</div>
                  <div style={{ fontSize:10, color:muted }}>{t.shares} @ ${parseFloat(t.price||0).toFixed(2)}</div>
                </div>
                <div style={{ textAlign:'right', flexShrink:0 }}>
                  {t.outcome ? (
                    <>
                      <span style={{ background:t.outcome==='WIN'?'#064e3b':'#450a0a', color:t.outcome==='WIN'?green:red, padding:'2px 6px', borderRadius:4, fontSize:10, fontWeight:600 }}>{t.outcome==='WIN'?'WIN':'LOSS'}</span>
                      {t.profit_loss && <div style={{ fontSize:11, color:parseFloat(t.profit_loss)>=0?green:red, marginTop:2 }}>{parseFloat(t.profit_loss)>=0?'+':''}${parseFloat(t.profit_loss).toFixed(2)}</div>}
                    </>
                  ) : <span style={{ fontSize:10, color:muted }}>holding...</span>}
                </div>
                <div style={{ fontSize:10, color:'#475569', textAlign:'right', minWidth:44, flexShrink:0 }}>
                  {t.created_at?.split('T')[1]?.slice(0,5)}<br/>{t.created_at?.split('T')[0]?.slice(5)}
                </div>
              </div>
            ))}
            {trades.length===0 && <div style={{ textAlign:'center', padding:30, color:muted }}>No trades yet!</div>}
          </div>
        </>}

        {tab === 'history' && <>
          <div style={{ marginBottom:12, display:'flex', alignItems:'center', gap:8 }}>
            <span>📅</span>
            <span style={{ fontSize:16, fontWeight:600 }}>Daily History</span>
          </div>
          {days.length===0 ? (
            <div style={{ ...card, textAlign:'center', padding:'50px 0', color:muted }}>No history yet!</div>
          ) : days.map(day => {
            const d = byDay[day];
            const total = d.wins+d.losses;
            const wr = total>0 ? ((d.wins/total)*100).toFixed(0) : 0;
            return (
              <div key={day} style={{ ...card, marginBottom:10 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                  <div>
                    <div style={{ fontWeight:700, fontSize:14 }}>{new Date(day+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</div>
                    <div style={{ fontSize:11, color:muted, marginTop:1 }}>{total} trades</div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontSize:18, fontWeight:700, color:d.pl>=0?green:red }}>{d.pl>=0?'+':''}${d.pl.toFixed(2)}</div>
                    <div style={{ fontSize:11, color:d.pl>=0?green:red }}>{d.pl>=0?'✅ Profit day':'❌ Loss day'}</div>
                  </div>
                </div>
                <div className="three-col" style={{ marginBottom:8 }}>
                  <div style={{ textAlign:'center', background:'#064e3b', borderRadius:8, padding:10 }}><div style={{ fontSize:20, fontWeight:700, color:green }}>{d.wins}</div><div style={{ fontSize:9, color:'#6ee7b7' }}>WINS 🟢</div></div>
                  <div style={{ textAlign:'center', background:'#450a0a', borderRadius:8, padding:10 }}><div style={{ fontSize:20, fontWeight:700, color:red }}>{d.losses}</div><div style={{ fontSize:9, color:'#fca5a5' }}>LOSSES 🔴</div></div>
                  <div style={{ textAlign:'center', background:'#080b14', borderRadius:8, padding:10 }}><div style={{ fontSize:20, fontWeight:700, color:parseFloat(wr)>=50?green:red }}>{wr}%</div><div style={{ fontSize:9, color:'#94a3b8' }}>WIN RATE</div></div>
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                  {d.trades.filter(t=>t.outcome).map((t,i)=>(
                    <span key={i} style={{ padding:'2px 8px', borderRadius:5, fontSize:10, background:t.outcome==='WIN'?'#064e3b':'#450a0a', color:t.outcome==='WIN'?green:red, fontWeight:600 }}>
                      {t.symbol} {t.outcome==='WIN'?'+':''}{parseFloat(t.profit_loss||0).toFixed(2)}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </>}

        {tab === 'watchlist' && <>
          <div style={{ marginBottom:12, display:'flex', alignItems:'center', gap:8 }}>
            <span>👁️</span>
            <span style={{ fontSize:16, fontWeight:600 }}>Watchlist</span>
            <span style={{ background:'#1e1a3f', color:'#a78bfa', padding:'2px 8px', borderRadius:10, fontSize:11 }}>{WATCHLIST.length}</span>
          </div>
          <div className="watch-grid">
            {WATCHLIST.map(sym=>{
              const st=trades.filter(t=>t.symbol===sym&&t.outcome);
              const sw=st.filter(t=>t.outcome==='WIN').length;
              const sl=st.filter(t=>t.outcome==='LOSS').length;
              const hasPos=positions.find(p=>p.symbol===sym);
              const avoided=sl>=5;
              const pl=st.reduce((s,t)=>s+(parseFloat(t.profit_loss)||0),0);
              return (
                <div key={sym} style={{ background:hasPos?'#0c1a2e':'#0d1117', border:`1px solid ${hasPos?'#1e40af':avoided?'#7f1d1d':'#1e2d3d'}`, borderRadius:10, padding:'10px 12px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
                    <span style={{ fontWeight:700, fontSize:13 }}>{sym}</span>
                    {hasPos && <span style={{ background:'#1e3a5f', color:'#93c5fd', fontSize:9, padding:'1px 5px', borderRadius:3 }}>ACTIVE</span>}
                    {avoided&&!hasPos && <span style={{ background:'#450a0a', color:'#fca5a5', fontSize:9, padding:'1px 5px', borderRadius:3 }}>AVOID</span>}
                  </div>
                  {st.length>0 ? (
                    <>
                      <div style={{ display:'flex', gap:6, marginBottom:3 }}>
                        <span style={{ fontSize:10, color:green }}>{sw}W</span>
                        <span style={{ fontSize:10, color:red }}>{sl}L</span>
                      </div>
                      <div style={{ fontSize:11, fontWeight:600, color:pl>=0?green:red }}>{pl>=0?'+':''}${pl.toFixed(2)}</div>
                    </>
                  ) : <div style={{ fontSize:10, color:'#475569' }}>No trades</div>}
                </div>
              );
            })}
          </div>
        </>}

        {tab === 'ai chat' && <>
          <div style={{ marginBottom:12, display:'flex', alignItems:'center', gap:8 }}>
            <span>🤖</span>
            <span style={{ fontSize:16, fontWeight:600 }}>Ask Your Trading AI</span>
          </div>
          <div style={{ ...card, display:'flex', flexDirection:'column', height:'calc(100vh - 200px)', minHeight:400 }}>
            <div style={{ display:'flex', gap:6, marginBottom:12, flexWrap:'wrap' }}>
              {[
                'How did we do today?',
                'Did we learn from our moves today?',
                'What are we prepared for tomorrow?',
                'What was the overall profit or loss today?'
              ].map(p=>(
                <button key={p} onClick={()=>setChatInput(p)} style={{ background:'#080b14', border:'1px solid #1e2d3d', color:'#94a3b8', padding:'5px 10px', borderRadius:14, fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>{p}</button>
              ))}
            </div>
            <div style={{ flex:1, overflowY:'auto', marginBottom:10 }}>
              {chatMessages.map((m,i)=>(
                <div key={i} style={{ marginBottom:8, display:'flex', justifyContent:m.role==='user'?'flex-end':'flex-start', alignItems:'flex-end', gap:6 }}>
                  {m.role==='assistant' && <div style={{ width:26, height:26, background:'#1e3a5f', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, flexShrink:0 }}>🤖</div>}
                  <div style={{ padding:'9px 12px', borderRadius:m.role==='user'?'14px 14px 4px 14px':'14px 14px 14px 4px', background:m.role==='user'?'#1a3a6e':'#1a1f2e', maxWidth:'80%', fontSize:13, lineHeight:1.6 }}>{m.content}</div>
                </div>
              ))}
              {chatLoading && (
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <div style={{ width:26, height:26, background:'#1e3a5f', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center' }}>🤖</div>
                  <div style={{ background:'#1a1f2e', padding:'9px 12px', borderRadius:'14px 14px 14px 4px' }}>
                    <div style={{ display:'flex', gap:3 }}>
                      {[0,1,2].map(i=><div key={i} style={{ width:5, height:5, background:'#60a5fa', borderRadius:'50%', animation:`pulse 1s ${i*0.2}s infinite` }}/>)}
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef}/>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendChat()} placeholder="Ask about your bot..." style={{ flex:1, background:'#080b14', border:'1px solid #1e2d3d', color:'#e2e8f0', padding:'9px 12px', borderRadius:10, fontSize:13, fontFamily:'inherit' }}/>
              <button onClick={sendChat} disabled={chatLoading||!chatInput.trim()} style={{ background:!chatLoading&&chatInput.trim()?'#0066ff':'#1e2d3d', border:'none', color:'#fff', padding:'9px 16px', borderRadius:10, cursor:!chatLoading&&chatInput.trim()?'pointer':'default', fontWeight:600, fontSize:13, fontFamily:'inherit' }}>Send</button>
            </div>
          </div>
        </>}

      </div>
    </div>
  );
}
