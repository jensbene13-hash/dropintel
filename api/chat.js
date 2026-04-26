export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { messages, system, model } = body;
    const apiKey = req.headers['x-api-key'];

    // If this is a product research request, fetch real trend data first
    const isProductResearch = messages?.[0]?.content?.includes('trending dropshipping products');
    let trendData = '';

    if (isProductResearch) {
      try {
        // Fetch real trending data from multiple sources
        const [amazonRes, redditRes, tiktokRes] = await Promise.allSettled([
          fetch('https://www.amazon.com/gp/bestsellers/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
          }),
          fetch('https://www.reddit.com/r/dropshipping/hot.json?limit=10', {
            headers: { 'User-Agent': 'Mozilla/5.0' }
          }),
          fetch('https://www.reddit.com/r/entrepreneur/search.json?q=trending+products+2026&sort=hot&limit=5', {
            headers: { 'User-Agent': 'Mozilla/5.0' }
          })
        ]);

        if (redditRes.status === 'fulfilled' && redditRes.value.ok) {
          const redditData = await redditRes.value.json();
          const posts = redditData?.data?.children?.slice(0, 5)
            .map(p => p.data.title).join(', ');
          if (posts) trendData += `Recent dropshipping discussions: ${posts}. `;
        }

        if (tiktokRes.status === 'fulfilled' && tiktokRes.value.ok) {
          const tiktokData = await tiktokRes.value.json();
          const posts = tiktokData?.data?.children?.slice(0, 5)
            .map(p => p.data.title).join(', ');
          if (posts) trendData += `Trending entrepreneur topics: ${posts}. `;
        }
      } catch(e) {
        // silently fail, still use AI knowledge
      }
    }

    // Inject trend data into the message if available
    const enhancedMessages = messages.map((m, i) => {
      if (i === 0 && trendData) {
        return { ...m, content: m.content + `\n\nReal-time trend context: ${trendData}` };
      }
      return m;
    });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({ 
        model, 
        max_tokens: 4000, 
        system, 
        messages: enhancedMessages 
      })
    });
    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: { message: error.message } });
  }
}
