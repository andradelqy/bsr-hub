'use strict';
// Descriptive diagnostics only. No automatic changes to thresholds or profiles.
function quantile(values, percentile) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b);
  return sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*percentile))];
}
function summarize(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.discipline || 'road'} / ${row.carClass || 'Unknown'}`;
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(row);
  }
  return [...groups].map(([group,items]) => {
    const sessions = new Set(items.map(row => row.importKey).filter(Boolean)).size;
    const deltas = items.map(row => Number(row.deltaSafetyRating)).filter(Number.isFinite);
    const rated = items.filter(row => row.ratingEligible && Number.isFinite(Number(row.expectedFinish)) && Number(row.expectedFinish) > 0);
    const cpi = items.map(row => Number(row.safetyCpi)).filter(value => Number.isFinite(value) && value > 0);
    return { group, results:items.length,sessions, sufficientForInitialReview:sessions >= 20,
      medianCpi:quantile(cpi,0.5), lowSafetyDelta:quantile(deltas,0.05), medianSafetyDelta:quantile(deltas,0.5), highSafetyDelta:quantile(deltas,0.95),
      meanAbsoluteRankError:rated.length ? rated.reduce((sum,row) => sum + Math.abs(Number(row.expectedFinish)-Number(row.classPosition)),0)/rated.length : null,
      provisionalResults:items.filter(row => row.skillBefore?.provisional).length,
      note:sessions < 20 ? 'Amostra insuficiente para calibrar parâmetros.' : 'Revisar qualidade e representatividade antes de alterar parâmetros.' };
  });
}
module.exports = { summarize, quantile };
