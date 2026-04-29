export default async function handler(req, res) {
  const API_KEY = process.env.ALPACA_API_KEY;
  const SECRET_KEY = process.env.ALPACA_SECRET_KEY;
  const BASE_URL = 'https://paper-api.alpaca.markets';
  const DATA_URL = 'https://data.alpaca.markets';

  const TAKE_PROFIT_PCT = 0.03;  // Sell if up 3%
  const STOP_LOSS_PCT = 0.02;    // Sell if down 2%

  try {
    // Get all current positions
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
        actions.push({ symbol, action, reason, pnlPct: (pnlPct * 100).toFixed(2) + '%', order: sellOrder });
      } else {
        actions.push({ symbol, action, reason, pnlPct: (pnlPct * 100).toFixed(2) + '%' });
      }
    }

    res.status(200).json({ message: 'Position check complete', actions });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
