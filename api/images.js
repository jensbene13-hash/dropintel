export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { query } = body;
    const searchQuery = encodeURIComponent(query);
    const aliUrl = `https://www.aliexpress.com/wholesale?SearchText=${searchQuery}`;
    const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(aliUrl)}`);
    const data = await response.json();
    const html = data.contents || '';
    const match = html.match(/https:\/\/ae01\.alicdn\.com\/kf\/[^"'\s]+\.(jpg|jpeg|png|webp)/i);
    const imageUrl = match ? match[0] : null;
    res.status(200).json({ 
      imageUrl,
      supplierUrl: aliUrl
    });
  } catch (error) {
    res.status(500).json({ imageUrl: null, supplierUrl: null });
  }
}
