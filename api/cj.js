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

    if (!token) {
      res.status(200).json({ imageUrl: null, supplierUrl: null, productId: null });
      return;
    }

    // Try exact search first then fallback to broader
    const searches = [query, query.split(' ').slice(0,3).join(' '), query.split(' ')[0]];
    
    for (const searchTerm of searches) {
      const searchRes = await fetch(`https://developers.cjdropshipping.com/api2.0/v1/product/list?productNameEn=${encodeURIComponent(searchTerm)}&pageNum=1&pageSize=5&orderBy=ORDERS`, {
        headers: { 'CJ-Access-Token': token }
      });
      const searchData = await searchRes.json();
      const products = searchData.data?.list || [];
      
      // Find best match - product name contains our search term
      const bestMatch = products.find(p => 
        p.productNameEn && p.productNameEn.toLowerCase().includes(searchTerm.toLowerCase().split(' ')[0])
      ) || products[0];

      if (bestMatch) {
        return res.status(200).json({
          imageUrl: bestMatch.productImage || null,
          supplierUrl: `https://cjdropshipping.com/product/${bestMatch.pid}.html`,
          productId: bestMatch.pid,
          productName: bestMatch.productNameEn,
          price: bestMatch.sellPrice
        });
      }
    }

    res.status(200).json({ 
      imageUrl: null, 
      supplierUrl: `https://cjdropshipping.com/search?q=${encodeURIComponent(query)}`,
      productId: null 
    });
  } catch (error) {
    res.status(200).json({ imageUrl: null, supplierUrl: null, error: error.message });
  }
}
