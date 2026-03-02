const ACTIVITY_FACTORS = {
  sedentary: 1.2,
  light: 1.3,
  moderate: 1.45,
  high: 1.6
};

export function activityFactorFromType(type) {
  return ACTIVITY_FACTORS[type] ?? ACTIVITY_FACTORS.sedentary;
}

export function calculateBmr({ sex, weightKg, heightCm, age }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return Math.round(base + (sex === "male" ? 5 : -161));
}

export function calculateTdee({ bmr, activityFactor, averageExerciseKcal = 0 }) {
  return Math.round(bmr * activityFactor + averageExerciseKcal);
}

export function recommendedDeficit(desiredDays, currentWeight, targetWeight) {
  const weightDiff = Math.max(0, currentWeight - targetWeight);
  if (weightDiff <= 0) {
    return 300;
  }
  const totalKcal = weightDiff * 7700;
  const deficit = Math.round(totalKcal / Math.max(1, desiredDays));
  if (deficit < 300) return 300;
  if (deficit > 900) return 900;
  return deficit;
}

export function minimumIntakeKcal(sex) {
  return sex === "male" ? 1200 : 1000;
}

export function classifyDailyStatus(deficit, targetDeficit) {
  if (deficit >= targetDeficit) return "green";
  if (deficit >= Math.round(targetDeficit * 0.8)) return "yellow";
  return "red";
}

export function normalizeDailyDeficit(deficit) {
  if (deficit < 300) return 300;
  if (deficit > 900) return 900;
  return deficit;
}
