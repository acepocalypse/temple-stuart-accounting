import type {
  ConvergenceInput,
  InfoEdgeResult,
  AnalystConsensusTrace,
  InsiderActivityTrace,
  EarningsMomentumTrace,
} from './types';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round(v: number, decimals = 2): number {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

function scoreAnalystConsensus(input: ConvergenceInput): AnalystConsensusTrace {
  const recs = input.finnhubRecommendations;

  if (recs.length === 0) {
    return {
      score: 50,
      weight: 0.3,
      inputs: { periods_available: 0 },
      formula: 'No analyst recommendation data -> default 50',
      notes: 'No Finnhub recommendation data available.',
      sub_scores: { buy_sell_ratio_score: 50, strong_conviction_score: 50, coverage_score: 50 },
      raw_counts: { strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0, total: 0 },
    };
  }

  const sorted = [...recs].sort((a, b) => b.period.localeCompare(a.period));
  const latest = sorted[0];
  const total = latest.strongBuy + latest.buy + latest.hold + latest.sell + latest.strongSell;

  if (total === 0) {
    return {
      score: 50,
      weight: 0.3,
      inputs: { periods_available: sorted.length, total_analysts: 0 },
      formula: 'Zero analyst coverage -> default 50',
      notes: 'Latest period has zero analysts.',
      sub_scores: { buy_sell_ratio_score: 50, strong_conviction_score: 50, coverage_score: 50 },
      raw_counts: { strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0, total: 0 },
    };
  }

  const bullish = latest.strongBuy + latest.buy;
  const bearish = latest.sell + latest.strongSell;
  const bullishPct = bullish / total;

  const consensusScore = clamp(15 + bullishPct * 70, 0, 100);

  let momentumScore = 50;
  if (sorted.length >= 2) {
    const previous = sorted[1];
    const bullishCurrent = latest.strongBuy + latest.buy;
    const bullishPrevious = previous.strongBuy + previous.buy;
    if (bullishCurrent > bullishPrevious) momentumScore = 75;
    else if (bullishCurrent < bullishPrevious) momentumScore = 35;
  }

  let coverageScore = 50;
  if (total >= 30) coverageScore = 80;
  else if (total >= 20) coverageScore = 70;
  else if (total >= 10) coverageScore = 60;
  else if (total < 5) coverageScore = 35;

  const score = round(0.35 * consensusScore + 0.65 * momentumScore, 1);

  return {
    score: round(score),
    weight: 0.3,
    inputs: {
      periods_available: sorted.length,
      latest_period: latest.period,
      total_analysts: total,
      bullish_pct: round(bullishPct * 100, 1),
      bearish_count: bearish,
    },
    formula: `0.35xConsensus(${round(consensusScore)}) + 0.65xMomentum(${round(momentumScore)}) = ${score}`,
    notes: `${latest.strongBuy} StrongBuy, ${latest.buy} Buy, ${latest.hold} Hold, ${latest.sell} Sell, ${latest.strongSell} StrongSell`,
    sub_scores: {
      buy_sell_ratio_score: round(consensusScore),
      strong_conviction_score: round(momentumScore),
      coverage_score: round(coverageScore),
    },
    raw_counts: {
      strongBuy: latest.strongBuy,
      buy: latest.buy,
      hold: latest.hold,
      sell: latest.sell,
      strongSell: latest.strongSell,
      total,
    },
  };
}

function scoreInsiderActivity(input: ConvergenceInput): InsiderActivityTrace {
  const sentiment = input.finnhubInsiderSentiment;

  if (sentiment.length === 0) {
    return {
      score: 50,
      weight: 0.35,
      inputs: { months_available: 0 },
      formula: 'No insider sentiment data -> default 50',
      notes: 'No Finnhub insider sentiment data available.',
      sub_scores: { mspr_score: 50, trend_score: 50 },
      insider_detail: {
        months_available: 0,
        latest_mspr: null,
        avg_mspr_3m: null,
        net_direction: 'UNKNOWN',
      },
    };
  }

  const sorted = [...sentiment].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.month - a.month;
  });

  const latestMspr = sorted[0].mspr;
  const recent3 = sorted.slice(0, 3);
  const avgMspr3m =
    recent3.length > 0
      ? round(recent3.reduce((s, r) => s + r.mspr, 0) / recent3.length, 4)
      : null;

  let msprScore = 50;
  if (latestMspr > 20) msprScore = 80;
  else if (latestMspr > 5) msprScore = 65;
  else if (latestMspr > -5) msprScore = 50;
  else if (latestMspr > -20) msprScore = 35;
  else msprScore = 20;

  let trendScore = 50;
  let netDirection = 'NEUTRAL';
  if (sorted.length >= 3) {
    const recentAvg = (sorted[0].mspr + sorted[1].mspr) / 2;
    const olderAvg = sorted.length >= 4 ? (sorted[2].mspr + sorted[3].mspr) / 2 : sorted[2].mspr;

    if (recentAvg > olderAvg + 5) {
      trendScore = 70;
      netDirection = 'IMPROVING';
    } else if (recentAvg < olderAvg - 5) {
      trendScore = 30;
      netDirection = 'DETERIORATING';
    } else {
      trendScore = 50;
      netDirection = 'STABLE';
    }
  } else if (latestMspr > 5) {
    netDirection = 'NET_BUYING';
    trendScore = 60;
  } else if (latestMspr < -5) {
    netDirection = 'NET_SELLING';
    trendScore = 40;
  }

  const score = round(0.6 * msprScore + 0.4 * trendScore, 1);

  return {
    score: round(score),
    weight: 0.35,
    inputs: {
      months_available: sorted.length,
      latest_mspr: latestMspr,
      avg_mspr_3m: avgMspr3m,
    },
    formula: `0.60xMSPR(${round(msprScore)}) + 0.40xTrend(${round(trendScore)}) = ${score}`,
    notes: `Latest MSPR ${latestMspr}, 3mo avg ${avgMspr3m ?? 'N/A'}, direction ${netDirection}`,
    sub_scores: {
      mspr_score: round(msprScore),
      trend_score: round(trendScore),
    },
    insider_detail: {
      months_available: sorted.length,
      latest_mspr: latestMspr,
      avg_mspr_3m: avgMspr3m,
      net_direction: netDirection,
    },
  };
}

function scoreEarningsMomentum(input: ConvergenceInput): EarningsMomentumTrace {
  const earnings = input.finnhubEarnings;

  if (earnings.length === 0) {
    return {
      score: 50,
      weight: 0.35,
      inputs: { quarters_available: 0 },
      formula: 'No earnings data -> default 50',
      notes: 'No Finnhub earnings history available.',
      sub_scores: { beat_streak_score: 50, surprise_magnitude_score: 50, consistency_score: 50 },
      momentum_detail: {
        last_4_surprises: [],
        consecutive_beats: 0,
        consecutive_misses: 0,
        avg_surprise_pct: null,
        direction: 'UNKNOWN',
      },
    };
  }

  const recent = earnings.slice(0, 4);
  const surprises = recent.map((e) => e.surprisePercent);

  let consecutiveBeats = 0;
  let consecutiveMisses = 0;
  for (const e of recent) {
    if (e.surprisePercent > 0) {
      if (consecutiveMisses === 0) consecutiveBeats++;
      else break;
    } else if (e.surprisePercent < 0) {
      if (consecutiveBeats === 0) consecutiveMisses++;
      else break;
    } else {
      break;
    }
  }

  let beatStreakScore = 50;
  if (consecutiveBeats >= 4) beatStreakScore = 85;
  else if (consecutiveBeats >= 3) beatStreakScore = 75;
  else if (consecutiveBeats >= 2) beatStreakScore = 65;
  else if (consecutiveBeats >= 1) beatStreakScore = 55;
  else if (consecutiveMisses >= 3) beatStreakScore = 20;
  else if (consecutiveMisses >= 2) beatStreakScore = 30;
  else if (consecutiveMisses >= 1) beatStreakScore = 40;

  const avgSurprise =
    surprises.length > 0
      ? round(surprises.reduce((a, b) => a + b, 0) / surprises.length, 2)
      : null;

  let surpriseMagnitudeScore = 50;
  if (avgSurprise !== null) {
    if (avgSurprise > 10) surpriseMagnitudeScore = 85;
    else if (avgSurprise > 5) surpriseMagnitudeScore = 70;
    else if (avgSurprise > 1) surpriseMagnitudeScore = 60;
    else if (avgSurprise > -1) surpriseMagnitudeScore = 50;
    else if (avgSurprise > -5) surpriseMagnitudeScore = 35;
    else surpriseMagnitudeScore = 20;
  }

  const positiveSurprises = surprises.filter((s) => s > 0).length;
  const negativeSurprises = surprises.filter((s) => s < 0).length;
  let consistencyScore = 50;
  if (surprises.length > 0) {
    const maxSameDir = Math.max(positiveSurprises, negativeSurprises);
    const consistencyPct = maxSameDir / surprises.length;
    consistencyScore = clamp(50 + (consistencyPct - 0.5) * 60, 20, 85);
    if (positiveSurprises === surprises.length) consistencyScore = clamp(consistencyScore + 10, 0, 90);
    if (negativeSurprises === surprises.length) consistencyScore = clamp(consistencyScore - 20, 10, 100);
  }

  let direction = 'NEUTRAL';
  if (consecutiveBeats >= 2 && (avgSurprise ?? 0) > 2) direction = 'BULLISH_MOMENTUM';
  else if (consecutiveBeats >= 1 && (avgSurprise ?? 0) > 0) direction = 'POSITIVE';
  else if (consecutiveMisses >= 2 && (avgSurprise ?? 0) < -2) direction = 'BEARISH_MOMENTUM';
  else if (consecutiveMisses >= 1 && (avgSurprise ?? 0) < 0) direction = 'NEGATIVE';

  const score = round(
    0.4 * beatStreakScore + 0.35 * surpriseMagnitudeScore + 0.25 * consistencyScore,
    1,
  );

  return {
    score: round(score),
    weight: 0.35,
    inputs: {
      quarters_available: recent.length,
      consecutive_beats: consecutiveBeats,
      consecutive_misses: consecutiveMisses,
    },
    formula:
      `0.40xStreak(${round(beatStreakScore)}) + ` +
      `0.35xMagnitude(${round(surpriseMagnitudeScore)}) + ` +
      `0.25xConsistency(${round(consistencyScore)}) = ${score}`,
    notes: `${consecutiveBeats} consecutive beats, avg surprise ${avgSurprise ?? 'N/A'}%, direction ${direction}`,
    sub_scores: {
      beat_streak_score: round(beatStreakScore),
      surprise_magnitude_score: round(surpriseMagnitudeScore),
      consistency_score: round(consistencyScore),
    },
    momentum_detail: {
      last_4_surprises: surprises,
      consecutive_beats: consecutiveBeats,
      consecutive_misses: consecutiveMisses,
      avg_surprise_pct: avgSurprise,
      direction,
    },
  };
}

export function scoreInfoEdge(input: ConvergenceInput): InfoEdgeResult {
  const analystConsensus = scoreAnalystConsensus(input);
  const insiderActivity = scoreInsiderActivity(input);
  const earningsMomentum = scoreEarningsMomentum(input);

  const score = round(
    analystConsensus.weight * analystConsensus.score +
      insiderActivity.weight * insiderActivity.score +
      earningsMomentum.weight * earningsMomentum.score,
    1,
  );

  return {
    score,
    breakdown: {
      analyst_consensus: analystConsensus,
      insider_activity: insiderActivity,
      earnings_momentum: earningsMomentum,
    },
  };
}
