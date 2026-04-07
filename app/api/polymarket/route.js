export const maxDuration = 10;

// Curated list of high-volume macro Polymarket markets grouped by theme.
// Fetched directly by slug — no search API needed, guaranteed results.
const MARKET_SLUGS = {
  rates:       ['fed-decision-in-april', 'fed-decision-in-june', 'how-many-fed-rate-cuts-in-2026', 'what-will-the-fed-rate-be-at-the-end-of-2026', 'fed-rate-hike-in-2026'],
  recession:   ['us-recession-by-end-of-2026', 'us-gdp-growth-in-2026'],
  crypto:      ['what-price-will-bitcoin-hit-before-2027', 'will-bitcoin-hit-150k-in-2026', 'bitcoin-below-60k-in-2026'],
  oil:         ['oil-price-above-100-in-2026', 'will-oil-prices-rise-in-2026', 'brent-crude-above-90-in-2026'],
  gold:        ['gold-above-3000-in-2026', 'will-gold-hit-3500-in-2026', 'gold-price-in-2026'],
  silver:      ['will-silver-hit-40-in-2026', 'silver-price-2026'],
  tariffs:     ['us-china-tariffs-2026', 'trump-tariffs-2026', 'us-tariff-rate-2026'],
  geopolitics: ['us-recession-by-end-of-2026', 'iran-conflict-2026', 'russia-ukraine-ceasefire-2026'],
};

// Map each theme to a Polymarket search query as fallback
const THEME_QUERIES = {
  rates:       'Fed rate',
  recession:   'recession 2026',
  crypto:      'Bitcoin 2026',
  oil:         'oil price',
  gold:        'gold price',
  silver:      'silver',
  tariffs:     'tariff',
  geopolitics: 'war ceasefire',
};

async function fetchBySlug(slug) {
  try {
    const resp = await fetch(`https://gamma-api.polymarket.com/events?slug=${slug}`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const event = Array.isArray(data) ? data[0] : data;
    if (!event) return null;
    const market = event.markets?.[0];
    if (!market) return null;

    let yesPct = 50;
    try {
      const prices = JSON.parse(market.outcomePrices || '["0.5","0.5"]');
      yesPct = Math.round(parseFloat(prices[0]) * 100);
    } catch {}

    return {
      title: event.title || market.question || slug,
      yes_pct: yesPct,
      volume_usd: Math.round(parseFloat(market.volume || event.volume || 0)),
    };
  } catch {
    return null;
  }
}

async function fetchByQuery(q) {
  try {
    const resp = await fetch(
      `https://gamma-api.polymarket.com/markets?q=${encodeURIComponent(q)}&active=true&closed=false&limit=10&order=volume&ascending=false`,
      { headers: { 'Accept': 'application/json' } }
    );
    if (!resp.ok) return [];
    const markets = await resp.json();
    return (Array.isArray(markets) ? markets : [])
      .filter(m => parseFloat(m.volume || 0) >= 10000)
      .slice(0, 3)
      .map(m => {
        let yesPct = 50;
        try {
          const prices = JSON.parse(m.outcomePrices || '["0.5","0.5"]');
          yesPct = Math.round(parseFloat(prices[0]) * 100);
        } catch {}
        return {
          title: m.question || m.title || '',
          yes_pct: yesPct,
          volume_usd: Math.round(parseFloat(m.volume || 0)),
        };
      })
      .filter(m => m.title);
  } catch {
    return [];
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const themes = (searchParams.get('themes') || 'rates,recession').split(',');

    const results = [];
    const seen = new Set();

    // For each theme, try slugs first then fall back to search
    await Promise.all(themes.map(async (theme) => {
      const slugs = MARKET_SLUGS[theme] || [];
      const query = THEME_QUERIES[theme];

      // Try top 3 slugs
      const slugResults = await Promise.all(slugs.slice(0, 3).map(fetchBySlug));
      const validSlug = slugResults.filter(Boolean);

      if (validSlug.length > 0) {
        validSlug.forEach(m => {
          if (!seen.has(m.title)) { seen.add(m.title); results.push(m); }
        });
      } else if (query) {
        // Fallback to search
        const searched = await fetchByQuery(query);
        searched.forEach(m => {
          if (!seen.has(m.title)) { seen.add(m.title); results.push(m); }
        });
      }
    }));

    // Sort by volume, return top 10
    const sorted = results
      .filter(m => m.volume_usd > 0)
      .sort((a, b) => b.volume_usd - a.volume_usd)
      .slice(0, 10);

    return Response.json(sorted);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
