export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { query } = body;
    
    // Search AliExpress via scraping proxy
    const searchUrl = `https://www.aliexpress.com/wholesale?SortType=total_tranqnumber_desc&SearchText=${encodeURIComponent(query)}&minPrice=1&maxPrice=20`;
    
    const proxyRes = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(searchUrl)}`);
    const proxyData = await proxyRes.json();
    const html = proxyData.contents || '';
    
    // Extract first product URL
    const productMatch = html.match(/\/item\/(\d+)\.html/);
    const productId = productMatch ? productMatch[1] : null;
    const productUrl = productId ? `https://www.aliexpress.com/item/${productId}.html` : searchUrl;
    
    // Extract image from the page
    const imageMatch = html.match(/https:\/\/ae01\.alicdn\.com\/kf\/[A-Za-z0-9]+\.(jpg|jpeg|png|webp)/i);
    const imageUrl = imageMatch ? imageMatch[0] : null;
    
    res.status(200).json({ imageUrl, supplierUrl: productUrl });
  } catch (error) {
    res.status(500).json({ imageUrl: null, supplierUrl: null });
  }
}
