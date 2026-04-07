export const maxDuration = 10;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || '';

    const url = `https://gamma-api.polymarket.com/markets?q=${encodeURIComponent(q)}&active=true&closed=false&limit=20&order=volume&ascending=false`;

    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!resp.ok) throw new Error(`Polymarket API error: ${resp.status}`);

    const markets = await resp.json();

    // Split search terms for title matching
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);

    const slim = (Array.isArray(markets) ? markets : [])
      .filter(m => {
        // Only keep markets whose title contains at least one search term
        const title = (m.question || m.title || '').toLowerCase();
        return terms.some(t => title.includes(t));
      })
      .map((m) => {
        let yesPct = 50;
        try {
          const prices = JSON.parse(m.outcomePrices || '["0.5","0.5"]');
          yesPct = Math.round(parseFloat(prices[0]) * 100);
        } catch {}
        return {
          title: m.question || m.title || '',
          yes_pct: yesPct,
          volume_usd: Math.round(parseFloat(m.volume || m.volumeNum || 0)),
          end_date: m.endDate || '',
        };
      })
      .filter(m => m.title)
      .slice(0, 8);

    return Response.json(slim);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
