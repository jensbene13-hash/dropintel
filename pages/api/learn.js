export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

  try {
    // Get all completed trades with outcomes
    const tradesRes = await fetch(
      `${SUPABASE_URL}/rest/v1/trades?outcome=not.is.null&action=eq.BUY&select=*`,
      {
        headers: {
          'apikey': SUPABASE_SECRET_KEY,
          'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
        }
      }
    );
    const trades = await tradesRes.json();

    if (!trades || trades.length < 5) {
      return res.status(200).json({ 
        message: 'Not enough trade history to learn from yet',
        tradesRecorded: trades ? trades.length : 0
      });
    }

    const wins = trades.filter(t => t.outcome === 'WIN');
    const losses = trades.filter(t => t.outcome === 'LOSS');
    const winRate = (wins.length / trades.length * 100).toFixed(2);

    // Find best RSI range for wins
    const winRSI = wins.map(t => parseFloat(t.rsi));
    const avgWinRSI = winRSI.reduce((a, b) => a + b, 0) / winRSI.length;

    const lossRSI = losses.length > 0 ? losses.map(t => parseFloat(t.rsi)) : [0];
    const avgLossRSI = lossRSI.reduce((a, b) => a + b, 0) / lossRSI.length;

    // Find best performing symbols
    const symbolStats = {};
    trades.forEach(t => {
      if (!symbolStats[t.symbol]) {
        symbolStats[t.symbol] = { wins: 0, losses: 0, totalPL: 0 };
      }
      if (t.outcome === 'WIN') symbolStats[t.symbol].wins++;
      else symbolStats[t.symbol].losses++;
      symbolStats[t.symbol].totalPL += parseFloat(t.profit_loss || 0);
    });

    const bestSymbols = Object.entries(symbolStats)
      .map(([symbol, stats]) => ({
        symbol,
        winRate: (stats.wins / (stats.wins + stats.losses) * 100).toFixed(2),
        totalPL: stats.totalPL.toFixed(2),
        trades: stats.wins + stats.losses
      }))
      .sort((a, b) => b.winRate - a.winRate);

    // Calculate recommended RSI threshold
    const recommendedMaxRSI = avgWinRSI > 0 ? Math.min(avgWinRSI + 5, 70) : 65;

    // Save learnings to Supabase
    await fetch(`${SUPABASE_URL}/rest/v1/learnings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SECRET_KEY,
        'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        win_rate: parseFloat(winRate),
        avg_win_rsi: avgWinRSI.toFixed(2),
        avg_loss_rsi: avgLossRSI.toFixed(2),
        recommended_max_rsi: recommendedMaxRSI.toFixed(2),
        best_symbol: bestSymbols[0]?.symbol,
        total_trades: trades.length,
      })
    });

    res.status(200).json({
      message: 'Learning complete!',
      winRate: winRate + '%',
      totalTrades: trades.length,
      avgWinRSI: avgWinRSI.toFixed(2),
      avgLossRSI: avgLossRSI.toFixed(2),
      recommendedMaxRSI: recommendedMaxRSI.toFixed(2),
      bestSymbols,
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
