export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { query, cjKey, addToList } = body;
    const shortQuery = (query || '').split(' ').slice(0, 3).join(' ');
    const searchUrl = `https://cjdropshipping.com/list/wholesale-all-categories-l-all.html?searchValue=${encodeURIComponent(shortQuery)}`;

    const tokenRes = await fetch('https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: cjKey })
    });
    const tokenData = await tokenRes.json();
    const token = tokenData.data?.accessToken;
    if (!token) {
      return res.status(200).json({ imageUrl: null, supplierUrl: searchUrl, productId: null });
    }

    const searchRes = await fetch(`https://developers.cjdropshipping.com/api2.0/v1/product/list?productNameEn=${encodeURIComponent(shortQuery)}&pageNum=1&pageSize=5&orderBy=ORDERS`, {
      headers: { 'CJ-Access-Token': token }
    });
    const searchData = await searchRes.json();
    const product = searchData.data?.list?.[0];

    if (addToList && product?.pid) {
      await fetch('https://developers.cjdropshipping.com/api2.0/v1/product/addToMyProduct', {
        method: 'POST',
        headers: { 'CJ-Access-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.pid })
      });
    }

    // Build specific product URL using the search value of the actual product name
    const specificUrl = product?.productNameEn 
      ? `https://cjdropshipping.com/list/wholesale-all-categories-l-all.html?searchValue=${encodeURIComponent(product.productNameEn.split(' ').slice(0,4).join(' '))}`
      : searchUrl;

    res.status(200).json({
      imageUrl: product?.productImage || null,
      supplierUrl: specificUrl,
      productId: product?.pid || null,
      productName: product?.productNameEn || null,
      price: product?.sellPrice || null
    });

  } catch (error) {
    res.status(200).json({ 
      imageUrl: null, 
      supplierUrl: `https://cjdropshipping.com/list/wholesale-all-categories-l-all.html?searchValue=${encodeURIComponent((query||'').split(' ').slice(0,3).join(' '))}`,
      error: error.message 
    });
  }
}
