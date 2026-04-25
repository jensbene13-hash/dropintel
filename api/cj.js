export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { query, cjKey } = body;

    // Get access token
    const tokenRes = await fetch('https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: cjKey })
    });
    const tokenData = await tokenRes.json();
    console.log('Token response:', JSON.stringify(tokenData));
    const token = tokenData.data?.accessToken;
    
    if (!token) {
      res.status(200).json({ 
        imageUrl: null, 
        supplierUrl: `https://cjdropshipping.com/search?q=${encodeURIComponent(query)}`,
        productId: null,
        error: 'No token: ' + JSON.stringify(tokenData)
      });
      return;
    }

    // Search products
    const searchRes = await fetch(`https://developers.cjdropshipping.com/api2.0/v1/product/list?productNameEn=${encodeURIComponent(query)}&pageNum=1&pageSize=1`, {
      method: 'GET',
      headers: { 'CJ-Access-Token': token }
    });
    const searchData = await searchRes.json();
    console.log('Search response:', JSON.stringify(searchData));
    const product = searchData.data?.list?.[0];

    if (product) {
      res.status(200).json({
        imageUrl: product.productImage || null,
        supplierUrl: `https://cjdropshipping.com/product/${product.pid}.html`,
        productId: product.pid,
        productName: product.productNameEn,
        price: product.sellPrice
      });
    } else {
      res.status(200).json({ 
        imageUrl: null, 
        supplierUrl: `https://cjdropshipping.com/search?q=${encodeURIComponent(query)}`,
        productId: null 
      });
    }
  } catch (error) {
    res.status(200).json({ imageUrl: null, supplierUrl: null, error: error.message });
  }
}
