export const maxDuration = 60;

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(request) {
  try {
    const { image, mimeType, tickers, market } = await request.json();

    // Manual ticker text input
    if (tickers && tickers.trim()) {
      const tickerList = tickers
        .split(/[,\n\s;]+/)
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean);

      const stocks = tickerList.map((ticker) => {
        const country = inferCountry(ticker, market);
        const sector = inferSector(ticker, market);
        return { ticker, name: ticker, sector, country };
      });

      return Response.json({ stocks });
    }

    // Image upload — Claude Vision
    if (!image) {
      return Response.json({ error: 'No image or tickers provided' }, { status: 400 });
    }

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mimeType || 'image/png', data: image },
            },
            {
              type: 'text',
              text: `Extract all stock information from this Danelfin screenshot table.
Return ONLY a valid JSON array — no markdown, no code fences, no preamble.

Format:
[{"ticker":"UCG.MI","name":"UniCredit SpA","sector":"Banks","country":"IT"}]

Rules for country inference from ticker suffix:
- .MI = IT (Italy)
- .L = UK (United Kingdom)  
- .MC = ES (Spain)
- .DE = DE (Germany)
- .AT = GR (Greece)
- No suffix, US exchange = US
- Canadian stocks (TSX) = CA

Extract all visible rows. Include ticker, full company name, industry/sector, and country.`,
            },
          ],
        },
      ],
    });

    const text = response.content[0].text;
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('Could not parse stock data from image');
    const stocks = JSON.parse(match[0]);

    return Response.json({ stocks });
  } catch (err) {
    console.error('extract-tickers error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

function inferCountry(ticker, market) {
  if (market === 'EU') {
    if (ticker.endsWith('.MI')) return 'IT';
    if (ticker.endsWith('.L')) return 'UK';
    if (ticker.endsWith('.MC')) return 'ES';
    if (ticker.endsWith('.DE')) return 'DE';
    if (ticker.endsWith('.AT')) return 'GR';
    return 'EU';
  }
  if (ticker.endsWith('.TO') || ticker.endsWith('.TSX')) return 'CA';
  return 'US';
}

function inferSector(ticker, market) {
  return 'Unknown';
}
