export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const API_KEY = process.env.ALPACA_API_KEY;
  const SECRET_KEY = process.env.ALPACA_SECRET_KEY;
  const BASE_URL = 'https://paper-api.alpaca.markets';
  const DATA_URL = 'https://data.alpaca.markets';

  try {
    // Get account info
    const accountRes = await fetch(`${BASE_URL}/v2/account`, {
      headers: {
        'APCA-API-KEY-ID': API_KEY,
        'APCA-API-SECRET-KEY': SECRET_KEY,
      }
    });
    const account = await accountRes.json();

    // Get historical bars for AAPL
    const barsRes = await fetch(`${DATA_URL}/v2/stocks/AAPL/bars?timeframe=1Day&limit=50`, {
      headers: {
        'APCA-API-KEY-ID': API_KEY,
        'APCA-API-SECRET-KEY': SECRET_KEY,
      }
    });
    const bars = await barsRes.json();

    res.status(200).json({ account, bars });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
