export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { query } = body;
    const searchQuery = encodeURIComponent(query + ' dropshipping');
    const response = await fetch(`https://www.googleapis.com/customsearch/v1?key=AIzaSyD9s4QOiMWDmHGHbPNn3kiHOMFomcOSoVY&cx=017576662512468239146:omuauf10dwe&q=${searchQuery}&searchType=image&num=1`);
    const data = await response.json();
    const imageUrl = data.items?.[0]?.link || null;
    const supplierUrl = `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(query)}`;
    res.status(200).json({ imageUrl, supplierUrl });
  } catch (error) {
    res.status(500).json({ imageUrl: null, supplierUrl: `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(req.body?.query||'')}` });
  }
}
