export default async function handler(req, res) {
  const API_KEY = process.env.ALPACA_API_KEY;
  const SECRET_KEY = process.env.ALPACA_SECRET_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  const BASE_URL = 'https://paper-api.alpaca.markets';

  const TAKE_PROFIT_PCT = 0.03;
  const STOP_LOSS_PCT = 0.02;

  try {
    const positionsRes = await fetch(`${BASE_URL}/v2/positions`, {
      headers: {
        'APCA-API-KEY-ID': API_KEY,
        'APCA-API-SECRET-KEY': SECRET_KEY,
      }
    });
    const positions = await positionsRes.json();

    if (!positions || positions.length === 0) {
      return res.status(200).json({ message: 'No open positions to manage' });
    }

    const actions = [];

    for (const position of positions) {
      const symbol = position.symbol;
      const avgCost = parseFloat(position.avg_entry_price);
      const currentPrice = parseFloat(position.current_price);
      const pnlPct = (currentPrice - avgCost) / avgCost;
      const qty = position.qty;

      let action = 'HOLD';
      let reason = '';

      if (pnlPct >= TAKE_PROFIT_PCT) {
        action = 'SELL';
        reason = `Take profit triggered: up ${(pnlPct * 100).toFixed(2)}%`;
      } else if (pnlPct <= -STOP_LOSS_PCT) {
        action = 'SELL';
        reason = `Stop loss triggered: down ${(pnlPct * 100).toFixed(2)}%`;
      } else {
        reason = `Holding: ${(pnlPct * 100).toFixed(2)}% P&L`;
      }

      if (action === 'SELL') {
        const sellRes = await fetch(`${BASE_URL}/v2/orders`, {
          method: 'POST',
          headers: {
            'APCA-API-KEY-ID': API_KEY,
            'APCA-API-SECRET-KEY': SECRET_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            symbol,
            qty,
            side: 'sell',
            type: 'market',
            time_in_force: 'day',
          })
        });
        const sellOrder = await sellRes.json();

        // Log outcome to Supabase
        const profitLoss = (currentPrice - avgCost) * parseFloat(qty);
        const outcome = pnlPct >= 0 ? 'WIN' : 'LOSS';

        // Find the original buy trade and update it
        const searchRes = await fetch(
          `${SUPABASE_URL}/rest/v1/trades?symbol=eq.${symbol}&action=eq.BUY&outcome=is.null&order=created_at.desc&limit=1`,
          {
            headers: {
              'apikey': SUPABASE_SECRET_KEY,
              'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
            }
          }
        );
        const trades = await searchRes.json();

        if (trades && trades.length > 0) {
          await fetch(
            `${SUPABASE_URL}/rest/v1/trades?id=eq.${trades[0].id}`,
            {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_SECRET_KEY,
                'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
                'Prefer': 'return=minimal'
              },
              body: JSON.stringify({
                outcome,
                profit_loss: profitLoss.toFixed(2),
              })
            }
          );
        }

        // Also log the sell trade
        await fetch(`${SUPABASE_URL}/rest/v1/trades`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_SECRET_KEY,
            'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            symbol,
            action: 'SELL',
            price: currentPrice,
            shares: parseInt(qty),
            outcome,
            profit_loss: profitLoss.toFixed(2),
          })
        });

        actions.push({ symbol, action, reason, pnlPct: (pnlPct * 100).toFixed(2) + '%', profitLoss: profitLoss.toFixed(2), outcome });
      } else {
        actions.push({ symbol, action, reason, pnlPct: (pnlPct * 100).toFixed(2) + '%' });
      }
    }

    res.status(200).json({ message: 'Position check complete', actions });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
