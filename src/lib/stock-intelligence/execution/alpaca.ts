import type { TradeCard } from '../types';

type HttpMethod = 'GET' | 'POST';

type HttpDeps = {
  fetch: typeof fetch;
};

export interface AlpacaExecutionReport {
  enabled: boolean;
  placed: Array<{ ticker: string; orderId: string }>;
  skipped: Array<{ ticker: string; reason: string }>;
  errors: Array<{ ticker: string; error: string }>;
}

interface AlpacaConfig {
  enabled: boolean;
  keyId: string;
  secretKey: string;
  baseUrl: string;
  maxOrdersPerRun: number;
  notionalUsd: number;
  takeProfitR: number;
  executeOnModes: Set<string>;
}

export interface AlpacaPaperStatus {
  enabled: boolean;
  executeOnModes: string[];
  connected: boolean;
  error: string | null;
  account: {
    id: string | null;
    status: string | null;
    currency: string | null;
    cash: string | null;
    buyingPower: string | null;
    portfolioValue: string | null;
  } | null;
  positionsCount: number;
  openOrdersCount: number;
  positionSymbols: string[];
  openOrderSymbols: string[];
  recentOrderSymbols: string[];
  recentOrders: Array<{
    id: string;
    symbol: string;
    status: string;
    side: string;
    qty: string;
    createdAt: string | null;
  }>;
}

function loadConfig(env: NodeJS.ProcessEnv): AlpacaConfig {
  const enabled = (env.ALPACA_PAPER_TRADING_ENABLED || 'false').toLowerCase() === 'true';
  const baseUrl = (env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets').replace(/\/+$/, '');
  const maxOrdersPerRun = Math.max(1, Number(env.ALPACA_MAX_ORDERS_PER_RUN || 3));
  const notionalUsd = Math.max(10, Number(env.ALPACA_NOTIONAL_USD || 1000));
  const takeProfitR = Math.max(0.5, Number(env.ALPACA_ORDER_TAKE_PROFIT_R_MULT || 1));
  const executeOnModes = new Set(
    String(env.ALPACA_EXECUTE_ON || 'refresh')
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  );
  return {
    enabled,
    keyId: (env.ALPACA_API_KEY || '').trim(),
    secretKey: (env.ALPACA_API_SECRET || '').trim(),
    baseUrl,
    maxOrdersPerRun,
    notionalUsd,
    takeProfitR,
    executeOnModes,
  };
}

async function alpacaJson(
  config: AlpacaConfig,
  path: string,
  method: HttpMethod,
  deps: HttpDeps,
  body?: unknown,
): Promise<unknown> {
  const resp = await deps.fetch(`${config.baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'APCA-API-KEY-ID': config.keyId,
      'APCA-API-SECRET-KEY': config.secretKey,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await resp.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`);
  }
  return parsed;
}

function selectableActionable(cards: TradeCard[]): TradeCard[] {
  return cards.filter(
    (c) =>
      c.status === 'ACTIONABLE' &&
      !c.blocked &&
      !!c.plan &&
      Number.isFinite(c.price) &&
      c.price > 0 &&
      c.plan.riskPerShare > 0 &&
      c.plan.stopPrice > 0,
  );
}

function buildOrderBody(
  card: TradeCard,
  notionalUsd: number,
  takeProfitR: number,
): Record<string, unknown> | null {
  if (!card.plan) return null;
  const refPrice = card.plan.triggerPrice > 0 ? card.plan.triggerPrice : card.price;
  if (!Number.isFinite(refPrice) || refPrice <= 0) return null;
  const qty = Math.floor(notionalUsd / refPrice);
  if (qty < 1) return null;
  const takeProfit = Number((card.plan.triggerPrice + card.plan.riskPerShare * takeProfitR).toFixed(2));
  const stopPrice = Number(card.plan.stopPrice.toFixed(2));
  return {
    symbol: card.ticker,
    qty,
    side: 'buy',
    type: 'market',
    time_in_force: 'day',
    order_class: 'bracket',
    take_profit: { limit_price: takeProfit },
    stop_loss: { stop_price: stopPrice },
    client_order_id: `strader-${Date.now()}-${card.ticker}`,
  };
}

export async function executeAlpacaPaperTrades(args: {
  cards: TradeCard[];
  mode: 'daily' | 'refresh' | 'fallback_rescan';
  env?: NodeJS.ProcessEnv;
  deps?: HttpDeps;
}): Promise<AlpacaExecutionReport> {
  const env = args.env || process.env;
  const deps = args.deps || { fetch };
  const config = loadConfig(env);
  const report: AlpacaExecutionReport = {
    enabled: config.enabled,
    placed: [],
    skipped: [],
    errors: [],
  };

  if (!config.enabled) return report;
  if (!config.executeOnModes.has(args.mode)) {
    return report;
  }
  if (!config.keyId || !config.secretKey) {
    report.errors.push({ ticker: 'ALL', error: 'ALPACA_API_KEY / ALPACA_API_SECRET missing' });
    return report;
  }

  let heldSymbols = new Set<string>();
  let openOrderSymbols = new Set<string>();
  try {
    const positions = (await alpacaJson(config, '/v2/positions', 'GET', deps)) as Array<Record<string, unknown>>;
    heldSymbols = new Set((positions || []).map((p) => String(p.symbol || '').toUpperCase()).filter(Boolean));
  } catch (error: unknown) {
    report.errors.push({ ticker: 'ALL', error: `positions: ${error instanceof Error ? error.message : String(error)}` });
  }
  try {
    const orders = (await alpacaJson(config, '/v2/orders?status=open&limit=200', 'GET', deps)) as Array<
      Record<string, unknown>
    >;
    openOrderSymbols = new Set((orders || []).map((o) => String(o.symbol || '').toUpperCase()).filter(Boolean));
  } catch (error: unknown) {
    report.errors.push({ ticker: 'ALL', error: `orders: ${error instanceof Error ? error.message : String(error)}` });
  }

  const candidates = selectableActionable(args.cards).slice(0, config.maxOrdersPerRun);
  for (const card of candidates) {
    const symbol = card.ticker.toUpperCase();
    if (heldSymbols.has(symbol)) {
      report.skipped.push({ ticker: symbol, reason: 'already_in_position' });
      continue;
    }
    if (openOrderSymbols.has(symbol)) {
      report.skipped.push({ ticker: symbol, reason: 'open_order_exists' });
      continue;
    }
    const body = buildOrderBody(card, config.notionalUsd, config.takeProfitR);
    if (!body) {
      report.skipped.push({ ticker: symbol, reason: 'invalid_order_body' });
      continue;
    }
    try {
      const placed = (await alpacaJson(config, '/v2/orders', 'POST', deps, body)) as Record<string, unknown>;
      report.placed.push({
        ticker: symbol,
        orderId: String(placed.id || ''),
      });
    } catch (error: unknown) {
      report.errors.push({ ticker: symbol, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return report;
}

export async function getAlpacaPaperStatus(args?: {
  env?: NodeJS.ProcessEnv;
  deps?: HttpDeps;
}): Promise<AlpacaPaperStatus> {
  const env = args?.env || process.env;
  const deps = args?.deps || { fetch };
  const config = loadConfig(env);
  const base: AlpacaPaperStatus = {
    enabled: config.enabled,
    executeOnModes: [...config.executeOnModes].sort(),
    connected: false,
    error: null,
    account: null,
    positionsCount: 0,
    openOrdersCount: 0,
    positionSymbols: [],
    openOrderSymbols: [],
    recentOrderSymbols: [],
    recentOrders: [],
  };

  if (!config.keyId || !config.secretKey) {
    return {
      ...base,
      error: 'ALPACA_API_KEY / ALPACA_API_SECRET missing',
    };
  }

  try {
    const account = (await alpacaJson(config, '/v2/account', 'GET', deps)) as Record<string, unknown>;
    const positions = (await alpacaJson(config, '/v2/positions', 'GET', deps)) as Array<Record<string, unknown>>;
    const orders = (await alpacaJson(config, '/v2/orders?status=open&limit=200', 'GET', deps)) as Array<
      Record<string, unknown>
    >;
    const recent = (await alpacaJson(config, '/v2/orders?status=all&limit=8&direction=desc', 'GET', deps)) as Array<
      Record<string, unknown>
    >;

    return {
      ...base,
      connected: true,
      account: {
        id: String(account.id || ''),
        status: account.status == null ? null : String(account.status),
        currency: account.currency == null ? null : String(account.currency),
        cash: account.cash == null ? null : String(account.cash),
        buyingPower: account.buying_power == null ? null : String(account.buying_power),
        portfolioValue: account.portfolio_value == null ? null : String(account.portfolio_value),
      },
      positionsCount: Array.isArray(positions) ? positions.length : 0,
      openOrdersCount: Array.isArray(orders) ? orders.length : 0,
      positionSymbols: Array.isArray(positions)
        ? Array.from(new Set(positions.map((p) => String(p.symbol || '').toUpperCase()).filter(Boolean))).sort()
        : [],
      openOrderSymbols: Array.isArray(orders)
        ? Array.from(new Set(orders.map((o) => String(o.symbol || '').toUpperCase()).filter(Boolean))).sort()
        : [],
      recentOrderSymbols: Array.isArray(recent)
        ? Array.from(new Set(recent.map((o) => String(o.symbol || '').toUpperCase()).filter(Boolean))).sort()
        : [],
      recentOrders: Array.isArray(recent)
        ? recent.map((o) => ({
            id: String(o.id || ''),
            symbol: String(o.symbol || ''),
            status: String(o.status || ''),
            side: String(o.side || ''),
            qty: String(o.qty || ''),
            createdAt: o.created_at == null ? null : String(o.created_at),
          }))
        : [],
    };
  } catch (error: unknown) {
    return {
      ...base,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
