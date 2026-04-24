export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { query } = body;
    const response = await fetch(
      `https://serpapi.com/search.json?engine=google_images&q=${encodeURIComponent(query+' product white background')}&num=1&api_key=free`,
      { headers: { 'Content-Type': 'application/json' } }
    );
    const data = await response.json();
    const imageUrl = data.images_results?.[0]?.original || null;
    res.status(200).json({ imageUrl });
  } catch (error) {
    res.status(500).json({ imageUrl: null });
  }
}
