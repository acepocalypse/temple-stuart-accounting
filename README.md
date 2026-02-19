# Strader (Manual Stock Scanner)

This is a stock-only Next.js app for manual swing trading.

## What It Does
- Scans a seed universe of liquid U.S. stocks.
- Builds a daily bias from daily candles.
- Refreshes 15m triggers for shortlist symbols.
- Produces deterministic trade cards with:
  - direction (`LONG`/`SHORT`/`WATCH`)
  - entry/stop/targets
  - whole-share position sizing
  - risk flags and plain-English explanations

## Data Sources
- Yahoo chart API: daily and 15m candles
- Finnhub: fundamentals, analyst recs, insider sentiment, earnings calendar/profile
- FRED: macro regime inputs

## Required Environment Variables
Set in `.env.local`:

```env
FINNHUB_API_KEY="your-finnhub-key"
FRED_API_KEY="your-fred-key"
```

## Run
```bash
npm install
npm run dev
```

Open:
- `http://localhost:3000/trading/stocks`

## API Endpoints
- `GET /api/stocks/scan?refresh=true`
- `GET /api/stocks/shortlist?refresh=true`

Optional overrides:
- `accountSize`
- `riskPct`
- `maxPositionPct`
- `maxOpen`
- `maxPerSector`

