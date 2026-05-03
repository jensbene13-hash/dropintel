export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  
  const { messages, context } = req.body;
  
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: context,
        messages: messages
      })
    });
    const data = await response.json();
    const reply = data?.content?.[0]?.text || "I couldn't get a response right now, try again!";
    res.status(200).json({ reply });
  } catch (e) {
    console.error('Chat error:', e);
    res.status(500).json({ reply: 'Something went wrong!' });
  }
}
