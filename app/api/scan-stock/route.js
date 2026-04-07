export const maxDuration = 60;

import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a sell-side equity analyst specialising in prediction market intelligence.
Find 3 currently active Polymarket prediction markets most relevant to this stock's key price drivers.

Think carefully about what actually moves this stock:
- European banks (UCG, SAN, DBK, BBVA, ETE, SAB, TPEIR, CABK): ECB rate decisions, eurozone recession, country political risk, credit spreads
- UK airline (EZJ): oil price, recession, travel demand, GBP/EUR, geopolitical disruption
- Silver miners (AG, HL, CDE, FRES): silver/gold spot price, USD strength, tariffs on metals, recession
- Gold miners (BTG): gold spot price, USD, geopolitical risk, recession
- US airlines (AAL): oil price, US recession, travel demand, tariff impact
- Capital markets/fintech (HOOD): Fed rate path, BTC/crypto direction, retail trading volumes, recession
- Software/AI (U, MSFT): AI capex cycle, Big Tech spending, tariffs on tech hardware, recession
- US banks (BAC): Fed rate path, US recession, Powell tenure, credit spreads
- Communications/defense tech (ONDS): US defense spending, drone regulation, government contracts

Return ONLY valid JSON parseable by JSON.parse(). No markdown, no preamble, no code fences.

{
  "headline": "one sharp sentence: net Polymarket verdict for this stock right now",
  "bias": "bullish|bearish|mixed",
  "markets": [
    {
      "title": "Polymarket market title",
      "yes_pct": 58,
      "volume_usd": 1200000,
      "impact": "bullish|bearish|neutral",
      "why": "one sentence: how YES outcome affects this specific stock"
    }
  ]
}

Rules:
- yes_pct = integer 0-100 (current implied probability of YES)
- volume_usd = integer USD (total wagered)
- Exactly 3 markets
- impact = what YES means for THIS stock specifically
- bias = your net read across all 3 markets combined
- Be specific — reference the company name or sector in "why"`;

export async function POST(request) {
  try {
    const { stock } = await request.json();

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [
        {
          role: 'user',
          content: `Stock: ${stock.ticker} — ${stock.name} (${stock.sector || 'Unknown sector'}, ${stock.country || 'Unknown'}).
Search Polymarket for 3 currently active prediction markets most relevant to this stock's key price drivers.
Return current YES probabilities and volumes.`,
        },
      ],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');

    const result = JSON.parse(match[0]);
    return Response.json(result);
  } catch (err) {
    console.error('scan-stock error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
