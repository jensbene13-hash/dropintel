export default async function handler(req, res) {
  const { endpoint } = req.query;
  const KEY = process.env.ALPACA_API_KEY;
  const SECRET = process.env.ALPACA_SECRET_KEY;

  try {
    const response = await fetch(`https://paper-api.alpaca.markets/v2/${endpoint}`, {
      headers: {
        'APCA-API-KEY-ID': KEY,
        'APCA-API-SECRET-KEY': SECRET,
      }
    });
    const data = await response.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
