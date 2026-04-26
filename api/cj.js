export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { query, cjKey, addToList } = body;

    const tokenRes = await fetch('https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: cjKey })
    });
    const tokenData = await tokenRes.json();
    const token = tokenData.data?.accessToken;
    if (!token) { res.status(200).json({ imageUrl: null, supplierUrl: null, productId: null }); return; }

    const shortQuery = query.split(' ').slice(0, 2).join(' ');
    const searchRes = await fetch(`https://developers.cjdropshipping.com/api2.0/v1/product/list?productNameEn=${encodeURIComponent(shortQuery)}&pageNum=1&pageSize=5&orderBy=ORDERS`, {
      headers: { 'CJ-Access-Token': token }
    });
    const searchData = await searchRes.json();
    const product = searchData.data?.list?.[0];

    if (!product) {
      return res.status(200).json({ 
        imageUrl: null, 
        supplierUrl: `https://cjdropshipping.com/search?q=${encodeURIComponent(query)}`, 
        productId: null 
      });
    }

    if (addToList && product.pid) {
      // Correct endpoint for adding to sourcing list
      await fetch('https://developers.cjdropshipping.com/api2.0/v1/product/sourcing/create', {
        method: 'POST',
        headers: { 
          'CJ-Access-Token': token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          productName: product.productNameEn,
          productImage: product.productImage,
          productUrl: `https://cjdropshipping.com/product/${product.pid}.html`,
          price: product.sellPrice
        })
      });
    }

    res.status(200).json({
      imageUrl: product.productImage || null,
      supplierUrl: `https://cjdropshipping.com/product/${product.pid}.html`,
      productId: product.pid,
      productName: product.productNameEn,
      price: product.sellPrice
    });
  } catch (error) {
    res.status(200).json({ imageUrl: null, supplierUrl: null, error: error.message });
  }
}
