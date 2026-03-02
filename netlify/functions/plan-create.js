import { requireAuth } from "./_lib/auth.js";
import {
  activityFactorFromType,
  calculateBmr,
  calculateTdee,
  minimumIntakeKcal,
  normalizeDailyDeficit,
  recommendedDeficit
} from "./_lib/calc.js";
import { query } from "./_lib/db.js";
import { parseJsonBody } from "./_lib/request.js";
import { badRequest, created, serverError } from "./_lib/response.js";

function parsePositiveNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return n;
}

function validateDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return badRequest("不支持的请求方法");
  }

  try {
    const auth = await requireAuth(event);
    if (auth.error) {
      return auth.error;
    }
    const body = parseJsonBody(event);
    if (!body) {
      return badRequest("请求体不是合法 JSON");
    }

    const sex = body.sex === "male" ? "male" : "female";
    const age = parsePositiveNumber(body.age);
    const heightCm = parsePositiveNumber(body.height_cm);
    const currentWeight = parsePositiveNumber(body.current_weight);
    const targetWeight = parsePositiveNumber(body.target_weight);
    const desiredDays = parsePositiveNumber(body.desired_days) ?? 90;
    const averageExerciseKcal = parsePositiveNumber(body.average_exercise_kcal) ?? 0;
    const activityType = String(body.activity_type ?? "sedentary");
    const startDate = String(body.start_date ?? new Date().toISOString().slice(0, 10));
    const today = new Date().toISOString().slice(0, 10);

    if (!age || !heightCm || !currentWeight || !targetWeight) {
      return badRequest("缺少必要参数");
    }
    if (!validateDate(startDate)) {
      return badRequest("开始日期格式无效");
    }
    if (startDate > today) {
      return badRequest("计划开始日期不能晚于今天");
    }
    if (targetWeight >= currentWeight) {
      return badRequest("目标体重必须低于当前体重");
    }

    const activityFactor = activityFactorFromType(activityType);
    const bmr = calculateBmr({ sex, weightKg: currentWeight, heightCm, age });
    const tdee = calculateTdee({ bmr, activityFactor, averageExerciseKcal });
    const deficit = normalizeDailyDeficit(
      recommendedDeficit(desiredDays, currentWeight, targetWeight)
    );
    const minIntake = minimumIntakeKcal(sex);
    const dailyKcalTarget = Math.max(minIntake, tdee - deficit);
    const endDateObj = new Date(startDate);
    endDateObj.setDate(endDateObj.getDate() + desiredDays);
    const endDate = endDateObj.toISOString().slice(0, 10);

    await query(
      `
        UPDATE plans
        SET status = 'completed'
        WHERE user_id = $1 AND status = 'active'
      `,
      [auth.user.user_id]
    );

    const result = await query(
      `
        INSERT INTO plans (
          user_id, start_date, end_date, start_weight, target_weight,
          daily_kcal_target, daily_deficit_target, tdee, activity_factor, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
        RETURNING *
      `,
      [
        auth.user.user_id,
        startDate,
        endDate,
        currentWeight,
        targetWeight,
        dailyKcalTarget,
        deficit,
        tdee,
        activityFactor
      ]
    );
    const plan = result.rows[0];
    return created({
      plan_id: plan.id,
      start_date: plan.start_date,
      end_date: plan.end_date,
      daily_kcal_target: plan.daily_kcal_target,
      daily_deficit_target: plan.daily_deficit_target,
      tdee: plan.tdee
    });
  } catch (error) {
    return serverError(error.message);
  }
}
