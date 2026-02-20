export const POPULAR_SYMBOLS: string[] = [

  'SPY','QQQ','IWM','AAPL','MSFT','GOOGL','AMZN','TSLA','NVDA','META',
  'AMD','NFLX','JPM','BAC','GS','XOM','CVX','PFE','JNJ','UNH',
  'DIS','BA','COST','HD','LOW','CRM','ORCL','ADBE','INTC','MU',
  'COIN','MARA','SQ','SHOP','SNAP','PLTR','SOFI','RIVN','LCID','NIO',
  'ARM','SMCI','AVGO','MRVL','PANW','CRWD','NET','DKNG','ABNB','UBER',

];

export const SP500_SYMBOLS: string[] = [

  'A','AAPL','ABBV','ABNB','ABT','ACGL','ACN','ADBE','ADI','ADM',
  'ADP','ADSK','AEE','AEP','AES','AFL','AIG','AIZ','AJG','AKAM',
  'ALB','ALGN','ALL','ALLE','AMAT','AMCR','AMD','AME','AMGN','AMP',
  'AMT','AMZN','ANET','ANSS','AOS','APA','APD','APH','APO','APP',
  'ARE','ATO','AVGO','AVB','AVY','AWK','AXON','AXP','BA','BAC',
  'BALL','BAX','BBWI','BBY','BDX','BEN','BFB','BG','BIIB','BK',
  'BKNG','BKR','BLDR','BLK','BMY','BR','BRO','BRKB','BSX','BX',
  'BXP','C','CAG','CAH','CARR','CAT','CB','CBOE','CCI','CCL',
  'CDNS','CDW','CEG','CF','CFG','CHD','CHRW','CHTR','CI','CIEN',
  'CINF','CL','CLX','CMS','CNC','CNP','COF','COO','COP','COR',
  'COST','CPRT','CPB','CPT','CRH','CRL','CRM','CRWD','CSCO','CSGP',
  'CSX','CTAS','CTSH','CTRA','CTVA','CVNA','CVS','CVX','D','DAL',
  'DASH','DDOG','DD','DE','DECK','DELL','DG','DGX','DHI','DHR',
  'DIS','DLTR','DOV','DOW','DPZ','DRI','DTE','DUK','DVA','DVN',
  'DXCM','EA','EBAY','ECL','ED','EFX','EG','EIX','EL','EME',
  'EMN','EMR','EQIX','EQR','EQT','ERIE','ES','ESS','ETN','ETR',
  'EW','EXC','EXE','EXPE','EXR','F','FANG','FAST','FSLR','FBHS',
  'FCX','FDS','FDX','FE','FFIV','FICO','FI','FIS','FITB','FIX',
  'FLT','FMC','FOX','FOXA','FRT','FTV','GD','GDDY','GE','GEHC',
  'GEN','GEV','GILD','GIS','GL','GLW','GM','GNRC','GOOG','GOOGL',
  'GPC','GPN','GRMN','GS','GWW','HAL','HAS','HBAN','HCA','HD',
  'HOLX','HON','HOOD','HPE','HPQ','HRL','HSIC','HST','HSY','HUBB',
  'HWM','IBM','ICE','IDXX','IEX','IFF','INCY','INTC','INTU','INVH',
  'IP','IQV','IR','IRM','ISRG','IT','ITW','IVZ','JBHT','JBL',
  'JCI','JKHY','JNJ','JPM','K','KDP','KEY','KHC','KIM','KKR',
  'KLAC','KMB','KMI','KO','KR','KVUE','L','LDOS','LEN','LH',
  'LHX','LII','LIN','LLY','LMT','LOW','LRCX','LULU','LUV','LVS',
  'LW','LYB','LYV','MA','MAA','MAR','MCD','MCHP','MCK','MCO',
  'MDLZ','MDT','MET','META','MGM','MKC','MLM','MMM','MNST','MO',
  'MOH','MOS','MPC','MPWR','MRNA','MRSH','MRVL','MS','MSCI','MSFT',
  'MSI','MTB','MTD','MU','NCLH','NDAQ','NDSN','NEE','NEM','NFLX',
  'NI','NKE','NOC','NOW','NRG','NSC','NTAP','NTRS','NUE','NVDA',
  'NVR','NWS','NWSA','NXPI','O','ODFL','OKE','OMC','ON','ORCL',
  'ORLY','OTIS','OXY','PANW','PARA','PAYC','PAYX','PCAR','PCG','PEG',
  'PEP','PFE','PFG','PG','PGR','PH','PHM','PKG','PLD','PLTR',
  'PM','PNC','PNR','PNW','PODD','POOL','PPG','PPL','PRU','PSA',
  'PSX','PTC','PVH','PWR','PYPL','QCOM','RCL','REG','REGN','RF',
  'RJF','RL','RMD','ROK','ROL','ROP','ROST','RSG','RTX','RVTY',
  'SBAC','SBUX','SCHW','SHW','SJM','SLB','SMCI','SNA','SNDK','SNPS',
  'SO','SOLV','SPG','SPGI','SRE','STE','STLD','STT','STZ','SWK',
  'SWKS','SYF','SYK','SYY','T','TAP','TDG','TDY','TER','TFC',
  'TGT','TJX','TKO','TMUS','TPL','TPR','TRGP','TRMB','TRV','TSCO',
  'TSLA','TSN','TT','TTD','TTWO','TXN','TXT','TYL','UAL','UBER',
  'UDR','UHS','ULTA','UNH','UNP','UPS','URI','USB','V','VICI',
  'VLO','VLTO','VMC','VRSK','VRSN','VRTX','VTR','VTRS','VZ','WAB',
  'WAT','WBA','WBD','WDC','WEC','WELL','WFC','WM','WMB','WMT',
  'WRB','WRK','WSM','WST','WTW','WY','WYNN','XEL','XOM','XYL',
  'XYZ','YUM','ZBH','ZBRA','ZTS',

];

// Symbols known to return persistent 404s on the current Yahoo chart feed.
// Keep excluded so scan diagnostics stay clean and runtime is not wasted.
export const EXCLUDED_SYMBOLS: string[] = [
  'ANSS',
  'FBHS',
  'FI',
  'FLT',
  'K',
  'PARA',
  'WBA',
  'WRK',
  'SQ',
];

const EXCLUDED = new Set(EXCLUDED_SYMBOLS.map((s) => s.toUpperCase()));

const BASE_SEED_SYMBOLS: string[] = Array.from(
  new Set([...SP500_SYMBOLS, ...POPULAR_SYMBOLS].map((s) => s.toUpperCase())),
);

export const ETF_EXCLUSION_SYMBOLS: string[] = [
  'SPY',
  'QQQ',
  'IWM',
  'DIA',
  'VTI',
  'VOO',
  'XLF',
  'XLK',
  'XLE',
  'XLV',
  'XLI',
  'XLY',
  'XLP',
  'XLB',
  'XLU',
  'XLRE',
  'XLC',
];

const ETF_EXCLUSIONS = new Set(ETF_EXCLUSION_SYMBOLS.map((s) => s.toUpperCase()));

export const UNIVERSE_BACKFILL_SYMBOLS: string[] = [
  'ACHR',
  'AFRM',
  'AI',
  'ALAB',
  'ASAN',
  'BABA',
  'BIDU',
  'BILI',
  'BROS',
  'BYND',
  'CART',
  'CHWY',
  'DLO',
  'DOCN',
  'ESTC',
  'ETSY',
  'EXAS',
  'FIVE',
  'FSLY',
  'FTCH',
  'FUBO',
  'GME',
  'GRAB',
  'HIMS',
  'HOOD',
  'IONQ',
  'JOBY',
  'LI',
  'LMND',
  'LULU',
  'MDB',
  'MELI',
  'OPEN',
  'PINS',
  'RBLX',
  'RDDT',
  'RIOT',
  'RKLB',
  'ROKU',
  'S',
  'SOUN',
  'U',
  'UPST',
  'W',
  'WIX',
  'WOLF',
  'XPEV',
  'YETI',
  'ZM',
  'ZS',
];

export function buildSeedUniverse(
  limit: number,
  options?: {
    excludeEtfs?: boolean;
  },
): string[] {
  const excludeEtfs = options?.excludeEtfs === true;
  const out: string[] = [];
  const seen = new Set<string>();
  const candidates = [...BASE_SEED_SYMBOLS, ...UNIVERSE_BACKFILL_SYMBOLS];

  for (const raw of candidates) {
    const symbol = raw.toUpperCase();
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    if (EXCLUDED.has(symbol)) continue;
    if (excludeEtfs && ETF_EXCLUSIONS.has(symbol)) continue;
    out.push(symbol);
    if (out.length >= limit) break;
  }

  return out;
}

export const SEED_SYMBOLS: string[] = buildSeedUniverse(Number.MAX_SAFE_INTEGER, {
  excludeEtfs: false,
});
