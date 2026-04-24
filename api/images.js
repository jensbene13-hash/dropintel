export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { query } = body;
    const searchUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(query+' product white background -logo')}&first=1&count=1`;
    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const html = await response.text();
    const match = html.match(/imgurl&quot;:&quot;(https?:\/\/[^&"]+\.(jpg|jpeg|png|webp))/i);
    const imageUrl = match ? match[1] : null;
    res.status(200).json({ imageUrl });
  } catch (error) {
    res.status(500).json({ imageUrl: null, error: error.message });
  }
}
