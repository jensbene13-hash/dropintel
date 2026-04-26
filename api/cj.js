export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { query, cjKey } = body;

    const tokenRes = await fetch('https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: cjKey })
    });
    const tokenData = await tokenRes.json();
    const token = tokenData.data?.accessToken;
    if (!token) { res.status(200).json({ imageUrl: null, supplierUrl: `https://cjdropshipping.com/search?q=${encodeURIComponent(query)}`, productId: null }); return; }

    // Use just first 2 keywords for better matching
    const shortQuery = query.split(' ').slice(0, 2).join(' ');
    
    const searchRes = await fetch(`https://developers.cjdropshipping.com/api2.0/v1/product/list?productNameEn=${encodeURIComponent(shortQuery)}&pageNum=1&pageSize=10&orderBy=ORDERS`, {
      headers: { 'CJ-Access-Token': token }
    });
    const searchData = await searchRes.json();
    const products = searchData.data?.list || [];

    if (products.length === 0) {
      // Try single word
      const oneWord = query.split(' ')[0];
      const res2 = await fetch(`https://developers.cjdropshipping.com/api2.0/v1/product/list?productNameEn=${encodeURIComponent(oneWord)}&pageNum=1&pageSize=5&orderBy=ORDERS`, {
        headers: { 'CJ-Access-Token': token }
      });
      const data2 = await res2.json();
      const p = data2.data?.list?.[0];
      if (p) {
        return res.status(200).json({
          imageUrl: p.productImage || null,
          supplierUrl: `https://cjdropshipping.com/product/${p.pid}.html`,
          productId: p.pid,
          productName: p.productNameEn,
          price: p.sellPrice
        });
      }
      return res.status(200).json({ imageUrl: null, supplierUrl: `https://cjdropshipping.com/search?q=${encodeURIComponent(query)}`, productId: null });
    }

    const best = products[0];
    res.status(200).json({
      imageUrl: best.productImage || null,
      supplierUrl: `https://cjdropshipping.com/product/${best.pid}.html`,
      productId: best.pid,
      productName: best.productNameEn,
      price: best.sellPrice
    });
  } catch (error) {
    res.status(200).json({ imageUrl: null, supplierUrl: null, error: error.message });
  }
}
