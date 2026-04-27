export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { messages, system, model } = body;
    const apiKey = req.headers['x-api-key'];
    const isProductResearch = messages?.[0]?.content?.includes('trending dropshipping');
    let trendContext = '';

    if (isProductResearch) {
      try {
        const [amazonRes, redditRes, googleRes] = await Promise.allSettled([
          // Amazon Best Sellers
          fetch('https://www.amazon.com/gp/bestsellers/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }
          }),
          // Reddit dropshipping hot posts
          fetch('https://www.reddit.com/r/dropshipping/hot.json?limit=15', {
            headers: { 'User-Agent': 'DropIntelBot/1.0' }
          }),
          // Google Trends RSS for shopping
          fetch('https://trends.google.com/trends/trendingsearches/daily/rss?geo=US', {
            headers: { 'User-Agent': 'Mozilla/5.0' }
          })
        ]);

        // Parse Reddit
        if (redditRes.status === 'fulfilled' && redditRes.value.ok) {
          const data = await redditRes.value.json();
          const posts = data?.data?.children
            ?.filter(p => !p.data.stickied)
            ?.slice(0, 8)
            ?.map(p => p.data.title)
            ?.join(' | ');
          if (posts) trendContext += `HOT DROPSHIPPING TOPICS TODAY: ${posts}. `;
        }

        // Parse Google Trends
        if (googleRes.status === 'fulfilled' && googleRes.value.ok) {
          const xml = await googleRes.value.text();
          const matches = xml.match(/<title><!\[CDATA\[([^\]]+)\]\]>/g)?.slice(1, 10);
          if (matches) {
            const trends = matches.map(m => m.replace(/<title><!\[CDATA\[/, '').replace(/\]\]>/, '')).join(', ');
            trendContext += `GOOGLE TRENDING SEARCHES IN US TODAY: ${trends}. `;
          }
        }

        // Parse Amazon
        if (amazonRes.status === 'fulfilled' && amazonRes.value.ok) {
          const html = await amazonRes.value.text();
          const titleMatches = html.match(/class="p13n-sc-truncate[^"]*"[^>]*>([^<]+)</g)?.slice(0, 10);
          if (titleMatches) {
            const products = titleMatches.map(m => m.replace(/class="[^"]*"[^>]*>/, '').replace(/<.*/, '').trim()).join(', ');
            trendContext += `AMAZON BEST SELLERS RIGHT NOW: ${products}. `;
          }
        }

      } catch(e) { console.log('Trend fetch error:', e.message); }
    }

    const enhancedMessages = messages.map((m, i) => {
      if (i === 0 && trendContext) {
        return { ...m, content: m.content + `\n\nREAL-TIME DATA FROM TODAY:\n${trendContext}\n\nUse this real data to inform your product suggestions. Pick products that align with what people are actually searching and buying right now.` };
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
      body: JSON.stringify({ model, max_tokens: 4000, system, messages: enhancedMessages })
    });
    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: { message: error.message } });
  }
}
