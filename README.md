# Strader Hybrid Stock Scanner

Deterministic long-only stock intelligence engine:
- Daily swing-bias scan
- 15-minute intraday trigger checks
- Human approval workflow
- No auto-trading
- No account-size assumptions inside engine

## Scope
- Universe: liquid U.S. stocks (ETF-excluded) ranked by 20-day dollar volume
- Daily run: full universe scan (default target 500)
- Intraday run: refresh only shortlist + tracked open positions

## Engine Rules
- Long-only
- Cash-account compatible output
- Convergence gate: at least 3 of 4 pillars >= cutoff (default 60)
- Adaptive threshold:
  - Strong: `max(70, 85th percentile)`
  - Neutral: `max(75, 90th percentile)`
  - Weak: `max(80, 92nd percentile)`
- Shortlist target: 5-10 (can be 0 on poor days)

## Pillars
- Vol-Edge: trend + volatility structure + compression/expansion readiness
- Quality: lightweight profitability + balance sheet checks
- Regime: SPY/VIX/FRED macro with SPY-correlation scaling
- Info-Edge: sentiment direction + intensity + divergence/flow checks

## Earnings Handling
- Earnings within 2 trading days: `WATCH_ONLY`
- Missing earnings date: not hard-blocked
  - Adds risk note
  - Applies confidence penalty

## Trade Card Outputs
Each card includes:
- Ticker, sector, liquidity rank
- Regime label
- Pillar scores + overall score
- Adaptive threshold + percentile rank
- Confidence score + bucket
- Why bullets (factual)
- Risk warnings
- Trigger plan (deterministic):
  - Trigger description + trigger price
  - Stop description + stop price
  - Risk per share
  - ATR(14), distance to 20DMA
  - 1R / 2R reference levels

No share sizing is computed.

## Data + Reliability
- Yahoo candles:
  - Daily TTL: 24h
  - 15m TTL: 10m
- Finnhub:
  - Fundamentals TTL: 7d
  - Earnings TTL: 24h
  - News TTL: 3h
- FRED macro TTL: 24h
- Throttling + retry/backoff + provider circuit-breaker
- Missing data degrades gracefully (no fabrication)

## Narration
- Optional plain-English narration via Gemini
- Model: `gemini-3-flash-preview` (fallback `gemini-2.5-flash`)
- Rate limit: 50 requests/minute (in-process guard)
- Deterministic fallback text if LLM unavailable

## Environment Variables
Set in `.env.local`:

```env
FINNHUB_API_KEY="your-finnhub-key"
FRED_API_KEY="your-fred-key"
GEMINI_API_KEY="your-gemini-api-key"
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# Scheduler (optional)
SCHEDULER_ENABLED="true"
SCHEDULER_TIMEZONE="America/New_York"
SCHEDULER_WINDOW_START_ET="04:00"
SCHEDULER_WINDOW_END_ET="16:00"
SCHEDULER_DAILY_SCAN_TIME_ET="09:20"
SCHEDULER_REFRESH_MINUTES="15"
SCHEDULER_FALLBACK_RESCAN_MINUTES="60"
SCHEDULER_FALLBACK_POOL_MIN="5"
SCHEDULER_STATE_PATH="/data/scheduler-state.json"

# Telegram (optional, for phone alerts)
TELEGRAM_BOT_TOKEN="your-telegram-bot-token"
TELEGRAM_CHAT_ID="your-telegram-chat-id"

# Alpaca paper-trading automation (optional, disabled by default)
ALPACA_PAPER_TRADING_ENABLED="false"
ALPACA_API_KEY="your-alpaca-key-id"
ALPACA_API_SECRET="your-alpaca-secret-key"
ALPACA_BASE_URL="https://paper-api.alpaca.markets"
ALPACA_EXECUTE_ON="refresh"
ALPACA_MAX_ORDERS_PER_RUN="3"
ALPACA_NOTIONAL_USD="1000"
ALPACA_ORDER_TAKE_PROFIT_R_MULT="1"
```

## Run
```bash
npm install
npm run dev
```

Scheduler (always-on worker):
```bash
npm run stocks:scheduler
```

Scheduler behavior:
- Runs daily scan once per market day at `SCHEDULER_DAILY_SCAN_TIME_ET`
- Runs refresh every `SCHEDULER_REFRESH_MINUTES` during premarket/RTH window
- Sends Telegram alert when actionable set changes
- Enters fallback mode when `returnedCards == 0` and `shortlisted < SCHEDULER_FALLBACK_POOL_MIN`
- Runs fallback mini rescan every `SCHEDULER_FALLBACK_RESCAN_MINUTES` while fallback remains active

Alpaca paper-trading behavior (only when `ALPACA_PAPER_TRADING_ENABLED=true`):
- Trades only `ACTIONABLE` cards with valid plan/stop/risk
- Default executes on `refresh` mode only (`ALPACA_EXECUTE_ON`)
- Skips symbols with existing open position/order
- Uses bracket market orders with:
  - stop = card stop price
  - take profit = trigger + `riskPerShare * ALPACA_ORDER_TAKE_PROFIT_R_MULT`
- Position sizing uses fixed notional per order (`ALPACA_NOTIONAL_USD`)

## Docker
Example with separate app + scheduler services:

```bash
docker compose up --build
```

This repo includes:
- `Dockerfile`
- `docker-compose.yml` with:
  - `app` service (`npm run dev`)
  - `scheduler` service (`npm run stocks:scheduler`)
  - persistent `scheduler-data` volume mounted at `/data`

## API
- Daily full scan:
  - `GET /api/stocks/scan?refresh=true`
- Intraday refresh (shortlist + open positions):
  - `GET /api/stocks/refresh?refresh=true`
- Compatibility alias:
  - `GET /api/stocks/shortlist?refresh=true`
- Progress:
  - `GET /api/stocks/scan/status`
- Approvals:
  - `GET /api/stocks/approvals`
  - `POST /api/stocks/approvals`
- Audit:
  - `GET /api/stocks/audit?limit=200`

Useful query overrides:
- `universeSize`
- `minDollarVolume`
- `pillarCutoff`
- `expand=true|false`
- `expandBuffer=<points>`

## Tests
```bash
npm test
```

Included test coverage:
- Adaptive threshold by regime
- Earnings handling (near-date watch-only, unknown-date penalty/no hard block)
- No-setup behavior
- Intraday refresh scope (shortlist/open only)
- Deterministic trigger plan output (per-share risk)

## Sample Candidate JSON
```json
{
  "ticker": "AAPL",
  "sector": "Technology",
  "liquidityRank": 8,
  "status": "ACTIONABLE",
  "price": 191.4,
  "regime": "NEUTRAL",
  "pillars": {
    "volEdge": 78.2,
    "quality": 69.4,
    "regime": 73.1,
    "infoEdge": 64.7
  },
  "overallScore": 72.96,
  "adaptiveThreshold": 75.0,
  "percentileRank": 91.4,
  "convergence": {
    "met": true,
    "pillarsAboveCutoff": 4,
    "cutoff": 60,
    "strength": "STRONG"
  },
  "confidence": {
    "score": 81.3,
    "label": "HIGH"
  },
  "why": [
    "Price is above 20/50/200DMA trend stack.",
    "Higher-high/higher-low structure remains intact.",
    "Breakout volume confirmed at 1.82x 20-day average."
  ],
  "riskWarnings": [
    "VIX elevated at 28.1."
  ],
  "plan": {
    "strategy": "BREAK_ABOVE_PRIOR_15M_SWING_HIGH",
    "triggerDescription": "Breakout above prior 15m swing high with volume confirmation.",
    "triggerPrice": 192.05,
    "stopDescription": "Stop below recent 15m swing low.",
    "stopPrice": 189.88,
    "status": "ACTIONABLE",
    "volumeConfirmed": true,
    "atr14": 3.12,
    "distanceTo20dmaPct": 1.44,
    "daily20dma": 189.32,
    "recent15mSwingHigh": 192.04,
    "recent15mSwingLow": 189.89,
    "entryTo20dmaDistancePct": 1.44,
    "riskPerShare": 2.17,
    "oneR": 194.22,
    "twoR": 196.39
  },
  "blocked": false,
  "blockedReason": null,
  "generatedAt": "2026-02-20T17:14:01.113Z"
}
```
