function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function filterWeightOutliers(weightLogs) {
  if (weightLogs.length <= 2) {
    return weightLogs;
  }
  const weights = weightLogs.map((item) => Number(item.weight));
  const med = median(weights);
  return weightLogs.filter((item) => Math.abs(Number(item.weight) - med) <= 2);
}

export function estimateFinishDate({
  latestWeight,
  targetWeight,
  averageDeficit,
  fromDate = new Date()
}) {
  const remainKg = Number(latestWeight) - Number(targetWeight);
  if (remainKg <= 0) {
    return {
      estimated_date: fromDate.toISOString().slice(0, 10),
      remain_days: 0
    };
  }
  const dailyFatLossKg = Math.max(averageDeficit, 1) / 7700;
  const remainDays = Math.ceil(remainKg / dailyFatLossKg);
  const estimated = new Date(fromDate);
  estimated.setDate(estimated.getDate() + remainDays);
  return {
    estimated_date: estimated.toISOString().slice(0, 10),
    remain_days: remainDays
  };
}
