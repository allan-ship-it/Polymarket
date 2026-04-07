# Polymarket Signal Scanner

Scan Polymarket prediction markets for any list of stocks. Paste tickers or upload a Danelfin screenshot — the app extracts them automatically via Claude Vision, then fires all Polymarket scans simultaneously.

Supports both EU and US stock lists.

---

## Deploy to Vercel (5 min)

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "init"
gh repo create polymarket-scanner --private --push --source=.
```

Or manually create a repo on github.com and push.

### 2. Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) → New Project
2. Import your `polymarket-scanner` GitHub repo
3. Framework: **Next.js** (auto-detected)
4. Add environment variable:
   - Key: `ANTHROPIC_API_KEY`
   - Value: your Anthropic API key (from console.anthropic.com)
5. Click **Deploy**

That's it. You'll get a URL like `polymarket-scanner.vercel.app`.

---

## Run locally

```bash
npm install
cp .env.example .env.local
# Add your ANTHROPIC_API_KEY to .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## How to use

1. **Paste tickers** — comma or space separated, e.g. `AG, HL, AAL, HOOD, BTG`
2. **Upload screenshot** — drag & drop a Danelfin screenshot, Claude Vision reads the tickers automatically
3. Select **Market** (Auto / US / EU) — helps with sector inference
4. Click **→ Scan Polymarket**
5. All stocks scan simultaneously — cards appear as results arrive
6. Click any card to expand and see the 3 Polymarket markets with probability bars

---

## Stack

- Next.js 14 (App Router)
- Tailwind CSS
- Anthropic SDK (server-side — API key never exposed to browser)
- Claude claude-sonnet-4-20250514 with web_search tool for live Polymarket data
