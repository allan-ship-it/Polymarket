'use client';

import { useState, useRef, useCallback } from 'react';

// ─── Config ─────────────────────────────────────────────────────────────────
const API_KEY = process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY;

// ─── Helpers ────────────────────────────────────────────────────────────────
const FLAG = {
  IT: '🇮🇹', UK: '🇬🇧', ES: '🇪🇸', DE: '🇩🇪', GR: '🇬🇷',
  US: '🇺🇸', CA: '🇨🇦', EU: '🇪🇺',
};

const SECTOR_STYLE = (s = '') => {
  if (s.includes('Mining') || s.includes('Metal'))
    return { label: 'Mining', bg: 'bg-amber-100', fg: 'text-amber-800' };
  if (s.includes('Airline') || s.includes('Aviation'))
    return { label: 'Airlines', bg: 'bg-blue-100', fg: 'text-blue-800' };
  if (s.includes('Software') || s.includes('Tech'))
    return { label: 'Software', bg: 'bg-green-100', fg: 'text-green-800' };
  if (s.includes('Bank') || s.includes('Financial') || s.includes('Capital'))
    return { label: 'Financials', bg: 'bg-red-100', fg: 'text-red-800' };
  if (s.includes('Commun'))
    return { label: 'Comms', bg: 'bg-purple-100', fg: 'text-purple-800' };
  return { label: s.split(' ')[0] || 'Other', bg: 'bg-gray-100', fg: 'text-gray-600' };
};

const BIAS_STYLE = (b) =>
  b === 'bullish' ? 'bg-green-100 text-green-800' :
  b === 'bearish' ? 'bg-red-100 text-red-800' :
  'bg-gray-100 text-gray-600';

const IMP_STYLE = (i) =>
  i === 'bullish' ? 'bg-green-100 text-green-700' :
  i === 'bearish' ? 'bg-red-100 text-red-700' :
  'bg-gray-100 text-gray-500';

const BAR_CLR = (p) =>
  p > 60 ? 'bg-green-500' : p < 40 ? 'bg-red-500' : 'bg-gray-400';

const fmtVol = (v) =>
  !v ? '—' : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v / 1000)}K` : `$${v}`;

// ─── Anthropic API call (client-side) ────────────────────────────────────────
async function callClaudeOnce({ system, userContent, tools = [] }) {
  const messages = [{ role: 'user', content: userContent }];
  const body = { model: 'claude-sonnet-4-20250514', max_tokens: 600, messages };
  if (system) body.system = system;
  if (tools.length) body.tools = tools;

  let resp;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw new Error(`Network error: ${networkErr.message}`);
  }

  if (!resp.ok) {
    let errMsg = `HTTP ${resp.status}`;
    try {
      const errBody = await resp.json();
      errMsg = errBody?.error?.message || errBody?.message || errMsg;
    } catch {}
    const err = new Error(errMsg);
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();
  return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

async function callClaude(params, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await callClaudeOnce(params);
    } catch (err) {
      const isRateLimit = err.status === 429 || (err.message || '').includes('rate limit');
      if (isRateLimit && attempt < retries - 1) {
        const wait = (attempt + 1) * 30000; // 30s, 60s, 90s
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
}

// ─── Extract tickers from text or image ─────────────────────────────────────
async function extractStocks({ tickers, image, mimeType, market }) {
  if (tickers && tickers.trim()) {
    const list = tickers.split(/[,\n\s;]+/).map((t) => t.trim().toUpperCase()).filter(Boolean);
    return list.map((ticker) => ({
      ticker,
      name: ticker,
      sector: 'Unknown',
      country: inferCountry(ticker, market),
    }));
  }

  const text = await callClaude({
    userContent: [
      { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/png', data: image } },
      {
        type: 'text',
        text: `Extract all stock information from this Danelfin screenshot table.
Return ONLY a valid JSON array — no markdown, no code fences, no preamble.
Format: [{"ticker":"UCG.MI","name":"UniCredit SpA","sector":"Banks","country":"IT"}]
Country from suffix: .MI=IT, .L=UK, .MC=ES, .DE=DE, .AT=GR, no suffix=US, Canadian=CA.
Extract all visible rows.`,
      },
    ],
  });

  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Could not parse stocks from image');
  return JSON.parse(match[0]);
}

function inferCountry(ticker, market) {
  if (ticker.endsWith('.MI')) return 'IT';
  if (ticker.endsWith('.L')) return 'UK';
  if (ticker.endsWith('.MC')) return 'ES';
  if (ticker.endsWith('.DE')) return 'DE';
  if (ticker.endsWith('.AT')) return 'GR';
  if (ticker.endsWith('.TO')) return 'CA';
  return market === 'EU' ? 'EU' : 'US';
}

// ─── Scan single stock against Polymarket ───────────────────────────────────
const SCAN_PROMPT = `Equity analyst. Today: April 2026. Find 3 ACTIVE (unresolved, open after April 2026) Polymarket markets for this stock's price drivers. Skip resolved/expired markets.
Return ONLY JSON: {"headline":"verdict","bias":"bullish|bearish|mixed","markets":[{"title":"...","yes_pct":58,"volume_usd":1200000,"impact":"bullish|bearish|neutral","why":"..."}]}
3 markets only. yes_pct=integer. volume_usd=integer.`;

async function scanStock(stock) {
  const text = await callClaude({
    system: SCAN_PROMPT,
    userContent: `Stock: ${stock.ticker} — ${stock.name} (${stock.sector}, ${stock.country}). Find 3 active Polymarket markets most relevant to this stock's price drivers. Return YES% and volumes.`,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
  });

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in response');
  return JSON.parse(match[0]);
}

// ─── Stock Card ──────────────────────────────────────────────────────────────
function StockCard({ stock, result, status, errorMsg, onRetry }) {
  const [expanded, setExpanded] = useState(false);
  const ss = SECTOR_STYLE(stock.sector);

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div
        className={`p-4 flex items-start justify-between gap-3 ${result ? 'cursor-pointer hover:bg-gray-50' : ''} transition-colors`}
        onClick={() => result && setExpanded((e) => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm">{FLAG[stock.country] || '🌐'}</span>
            <span className="text-sm font-semibold text-gray-900 tracking-tight">{stock.ticker}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-md font-semibold ${ss.bg} ${ss.fg}`}>
              {ss.label}
            </span>
          </div>
          <p className="text-[11px] text-gray-400 mb-2 truncate">{stock.name}</p>

          {status === 'loading' && (
            <div className="flex gap-1 items-center">
              {[0, 1, 2].map((i) => (
                <span key={i} className="pulse-dot w-1 h-1 rounded-full bg-gray-300 inline-block"
                  style={{ animationDelay: `${i * 0.2}s` }} />
              ))}
              <span className="text-[10px] text-gray-400 ml-1">scanning...</span>
            </div>
          )}
          {status === 'error' && (
            <div>
              <p className="text-[11px] text-red-500 mb-1">{errorMsg || 'Failed to load'}</p>
              <button
                onClick={(e) => { e.stopPropagation(); onRetry(stock); }}
                className="text-[10px] text-blue-500 underline hover:text-blue-700"
              >
                retry
              </button>
            </div>
          )}
          {result && (
            <p className="text-xs text-gray-600 leading-relaxed">{result.headline}</p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {result && (
            <span className={`text-[9px] px-2 py-0.5 rounded-md font-bold uppercase tracking-widest ${BIAS_STYLE(result.bias)}`}>
              {result.bias}
            </span>
          )}
          {result && (
            <span className="text-[10px] text-gray-400">{expanded ? '▲' : '▼'}</span>
          )}
        </div>
      </div>

      {expanded && result && (
        <div className="border-t border-gray-100 p-4 flex flex-col gap-2">
          {(result.markets || []).map((m, i) => (
            <div key={i} className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-[11px] font-semibold text-gray-900 flex-1 leading-snug">{m.title}</p>
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider shrink-0 ${IMP_STYLE(m.impact)}`}>
                  {m.impact}
                </span>
              </div>
              <div className="flex justify-between mb-1">
                <span className="font-mono text-[9px] text-gray-500">YES {Math.round(m.yes_pct)}%</span>
                <span className="font-mono text-[9px] text-gray-500">{fmtVol(m.volume_usd)}</span>
              </div>
              <div className="h-0.5 bg-gray-200 rounded-full overflow-hidden mb-2">
                <div className={`h-full bar-fill rounded-full ${BAR_CLR(m.yes_pct)}`}
                  style={{ width: `${Math.min(100, Math.max(0, Math.round(m.yes_pct)))}%` }} />
              </div>
              <p className="text-[11px] text-gray-500 leading-relaxed">{m.why}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function Home() {
  const [mode, setMode] = useState('text');
  const [market, setMarket] = useState('auto');
  const [tickerInput, setTickerInput] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [stocks, setStocks] = useState([]);
  const [results, setResults] = useState({});
  const [statuses, setStatuses] = useState({});
  const [completed, setCompleted] = useState(0);
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState(null);
  const fileRef = useRef();

  const handleImageChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const toBase64 = (file) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });

  const [errors, setErrors] = useState({});

  const runScan = useCallback(async (stockList) => {
    setPhase('scanning');
    const initStatuses = {};
    stockList.forEach((s) => { initStatuses[s.ticker] = 'loading'; });
    setStatuses(initStatuses);
    setCompleted(0);
    setErrors({});

    // Scan sequentially with 4s gap to respect rate limits
    for (let i = 0; i < stockList.length; i++) {
      const stock = stockList[i];
      try {
        const data = await scanStock(stock);
        setResults((r) => ({ ...r, [stock.ticker]: data }));
        setStatuses((s) => ({ ...s, [stock.ticker]: 'done' }));
      } catch (e) {
        setStatuses((s) => ({ ...s, [stock.ticker]: 'error' }));
        setErrors((er) => ({ ...er, [stock.ticker]: e.message }));
      } finally {
        setCompleted((c) => c + 1);
      }
      if (i < stockList.length - 1) {
        await new Promise((r) => setTimeout(r, 8000));
      }
    }
    setPhase('done');
  }, []);

  const handleRetry = useCallback(async (stock) => {
    setStatuses((s) => ({ ...s, [stock.ticker]: 'loading' }));
    setErrors((er) => { const n = {...er}; delete n[stock.ticker]; return n; });
    try {
      const data = await scanStock(stock);
      setResults((r) => ({ ...r, [stock.ticker]: data }));
      setStatuses((s) => ({ ...s, [stock.ticker]: 'done' }));
    } catch (e) {
      setStatuses((s) => ({ ...s, [stock.ticker]: 'error' }));
      setErrors((er) => ({ ...er, [stock.ticker]: e.message }));
    }
  }, []);

  const handleScan = useCallback(async () => {
    if (!API_KEY) {
      setError('NEXT_PUBLIC_ANTHROPIC_API_KEY is not set. Add it to your Vercel environment variables.');
      return;
    }
    setError(null);
    setStocks([]);
    setResults({});
    setStatuses({});
    setCompleted(0);
    setPhase('extracting');

    try {
      let image, mimeType;
      if (mode === 'image' && imageFile) {
        image = await toBase64(imageFile);
        mimeType = imageFile.type;
      }

      const extractedStocks = await extractStocks({
        tickers: mode === 'text' ? tickerInput : null,
        image,
        mimeType,
        market,
      });

      if (!extractedStocks?.length) throw new Error('No stocks found');
      setStocks(extractedStocks);
      await runScan(extractedStocks);
    } catch (err) {
      setError(err.message);
      setPhase('idle');
    }
  }, [mode, imageFile, tickerInput, market, runScan]);

  const doneCount = Object.values(statuses).filter((s) => s === 'done').length;
  const totalCount = stocks.length;
  const pct = totalCount ? Math.round((completed / totalCount) * 100) : 0;
  const isScanning = phase === 'extracting' || phase === 'scanning';

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-10">

        <div className="mb-8">
          <p className="font-mono text-[10px] text-gray-400 tracking-widest uppercase mb-1">Allan · Personal Tool</p>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Polymarket Signal Scanner</h1>
          <p className="text-sm text-gray-500 mt-1">
            Upload a Danelfin screenshot or paste tickers — scans Polymarket live for each stock.
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
          <div className="flex flex-wrap items-center gap-4 mb-5">
            <div>
              <p className="font-mono text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">Input</p>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
                {['text', 'image'].map((m) => (
                  <button key={m} onClick={() => setMode(m)}
                    className={`px-4 py-1.5 transition-colors ${mode === m ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                    {m === 'text' ? 'Paste tickers' : 'Upload screenshot'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="font-mono text-[10px] text-gray-400 uppercase tracking-wider mb-1.5">Market</p>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
                {['auto', 'US', 'EU'].map((m) => (
                  <button key={m} onClick={() => setMarket(m)}
                    className={`px-4 py-1.5 transition-colors ${market === m ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                    {m === 'auto' ? 'Auto' : m}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {mode === 'text' && (
            <div className="mb-4">
              <textarea
                className="w-full border border-gray-200 rounded-lg p-3 text-sm font-mono text-gray-800 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-gray-900"
                rows={3}
                placeholder="AG, HL, AAL, HOOD, BTG, U, CDE, ONDS, BAC, MSFT"
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value)}
              />
              <p className="text-[11px] text-gray-400 mt-1">Comma, space, or newline separated.</p>
            </div>
          )}

          {mode === 'image' && (
            <div
              className="mb-4 border-2 border-dashed border-gray-200 rounded-xl p-6 text-center cursor-pointer hover:border-gray-400 transition-colors"
              onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}
              onClick={() => fileRef.current?.click()}
            >
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
              {imagePreview ? (
                <div>
                  <img src={imagePreview} alt="Preview" className="max-h-40 mx-auto rounded-lg mb-2 object-contain" />
                  <p className="text-xs text-gray-500">{imageFile?.name} · Click to change</p>
                </div>
              ) : (
                <div>
                  <p className="text-2xl mb-2">📸</p>
                  <p className="text-sm font-medium text-gray-700">Drop Danelfin screenshot here</p>
                  <p className="text-xs text-gray-400 mt-1">or click to browse · PNG, JPG</p>
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          {!API_KEY && (
            <div className="mb-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs text-amber-700 font-medium">⚠ NEXT_PUBLIC_ANTHROPIC_API_KEY not detected. Add it to Vercel environment variables and redeploy.</p>
            </div>
          )}
          <button
            onClick={handleScan}
            disabled={isScanning || (mode === 'text' && !tickerInput.trim()) || (mode === 'image' && !imageFile)}
            className="w-full py-2.5 px-4 rounded-lg text-sm font-semibold bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {phase === 'extracting' ? 'Reading tickers...' :
             phase === 'scanning' ? `Scanning Polymarket... ${doneCount}/${totalCount}` :
             '→ Scan Polymarket'}
          </button>
        </div>

        {isScanning && (
          <div className="mb-6">
            <div className="flex justify-between mb-1">
              <span className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">
                {phase === 'extracting' ? 'Extracting tickers...' : `${doneCount}/${totalCount} complete — scanning one at a time`}
              </span>
              <span className="font-mono text-[10px] text-gray-400">{pct}%</span>
            </div>
            <div className="h-0.5 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-gray-900 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {phase === 'done' && stocks.length > 0 && (
          <div className="flex items-center justify-between mb-4">
            <p className="font-mono text-[10px] text-gray-400 uppercase tracking-wider">
              {doneCount}/{totalCount} complete · Click any card to expand
            </p>
            <button onClick={() => { setPhase('idle'); setStocks([]); setResults({}); setStatuses({}); setCompleted(0); }}
              className="text-xs text-gray-500 hover:text-gray-900 underline underline-offset-2">
              Clear
            </button>
          </div>
        )}

        {stocks.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {stocks.map((stock) => (
              <StockCard key={stock.ticker} stock={stock}
                result={results[stock.ticker]}
                status={statuses[stock.ticker]}
                errorMsg={errors[stock.ticker]}
                onRetry={handleRetry}
              />
            ))}
          </div>
        )}

        <p className="font-mono text-[9px] text-gray-300 text-center mt-10 uppercase tracking-widest">
          Live data via Polymarket · Powered by Claude
        </p>
      </div>
    </div>
  );
}
