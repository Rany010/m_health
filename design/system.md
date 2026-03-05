# m_health 项目现状说明

更新日期：2026-03-05  
适用范围：当前仓库代码（`src/` + `netlify/functions/`）已实现功能

## 1. 项目定位

`m_health` 是一个面向减脂场景的 Web 应用，核心目标是：

- 通过基础身体信息和活动水平，自动生成可执行的减脂计划
- 支持按天记录饮食、运动、体重
- 基于执行数据输出日历状态、趋势图和达标日期预测

---

## 2. 技术架构（当前）

- 前端：Vue 3 + Vue Router + Vite（SPA，两页：登录页/工作台）
- 后端：Netlify Functions（Node.js，函数式 API）
- 数据库：PostgreSQL（`pg` 驱动）
- 部署路由：`/api/* -> /.netlify/functions/:splat`（见 `netlify.toml`）

### 架构分层

- `src/`
- 前端页面与交互逻辑（登录、计划创建、记录、趋势展示）
- `netlify/functions/`
- API 入口层（参数校验、鉴权、查询与写入）
- `netlify/functions/_lib/`
- 公共能力层（鉴权、DB、领域计算、预设、限流、响应封装）

---

## 3. 已实现功能清单

### 3.1 账号与会话

- 账号注册（6 位数字账号 + 最短 8 位密码）
- 弱账号拦截（如 `000000`、`123456` 等）
- 登录鉴权（统一错误提示，避免暴露“账号不存在/密码错误”）
- 登录失败锁定（5 次失败后临时锁定 15 分钟）
- 会话令牌机制（Bearer Token，服务端存 token hash，默认 7 天过期）
- 退出登录（服务端撤销会话 + 前端清理本地 token）
- 审计日志（注册、登录成功/失败、锁定）

### 3.2 计划生成与管理

- 三步向导创建减脂计划
- 输入：性别、年龄、身高、当前体重、目标体重、活动水平、运动习惯、周期
- 输出：BMR、TDEE、建议日摄入、目标缺口、预计结束日期
- 创建新计划时会将用户历史 `active` 计划标记为 `completed`
- 计划参数约束：目标体重必须低于当前体重；每日目标缺口限制在 `300-900 kcal`；每日摄入安全下限男性 `1200 kcal`、女性 `1000 kcal`

### 3.3 每日记录

- 食物记录（按早餐/午餐/晚餐分组）
- 运动记录（当前前端为手动输入 kcal）
- 体重记录（同一天只保留最新一条）
- 日记录保存时自动计算：`intake_kcal`、`exercise_kcal`、`deficit = tdee - intake + exercise`、`status`（green/yellow/red）

### 3.4 看板与分析

- 月视图日历（按状态着色：green/yellow/red/gray）
- 连续达标天数（streak）
- 最近 7 天成功率
- 预测模块：使用最近 14 天 `deficit` 计算平均缺口；缺口不足或数据太少时暂停预测并返回原因
- 趋势模块：体重趋势、缺口趋势、摄入趋势、运动消耗趋势；对缺失体重的日期使用“前值延续”显示（虚线段）

### 3.5 预设能力

- 预设食物与运动通过后端统一下发
- 已新增预设食物：`麦当劳1+1`（`1份 = 586 kcal`）

---

## 4. 前端页面现状

### 4.1 登录页（`/`）

- 登录/注册双模式
- 前端输入校验（账号数字化、密码长度）
- 本地倒计时锁定提示（与服务端锁定策略一致）

### 4.2 工作台（`/dashboard`）

- 首次加载调用 `/dashboard-bootstrap` 一次性拉取核心数据
- 无 active 计划时展示创建向导
- 有计划时展示：顶部指标卡（体重进度/预计达标/执行质量）、日历与当日记录面板、体重更新与当日保存、多指标趋势图（SVG 绘制）

---

## 5. API 列表（当前代码）

| 接口 | 方法 | 鉴权 | 说明 |
|---|---|---|---|
| `/api/health` | GET | 否 | 健康检查，触发 schema 初始化 |
| `/api/auth-register` | POST | 否 | 注册并返回 token |
| `/api/auth-login` | POST | 否 | 登录并返回 token |
| `/api/auth-logout` | POST | 可选 | 撤销当前 token |
| `/api/me` | GET | 是 | 返回当前用户信息 |
| `/api/plan-create` | POST | 是 | 创建并激活计划 |
| `/api/plan-active` | GET | 是 | 获取当前 active 计划摘要 |
| `/api/dashboard-bootstrap` | GET | 是 | 聚合返回 profile/plan/calendar/forecast/dailyLog/trend/presets |
| `/api/calendar-month` | GET | 是 | 月日历数据 |
| `/api/daily-log-get` | GET | 是 | 获取指定日期记录 |
| `/api/daily-log-upsert` | POST | 是 | 保存指定日期饮食/运动 |
| `/api/weight-log-upsert` | POST | 是 | 保存指定日期体重 |
| `/api/trend-series` | GET | 是 | 趋势序列数据 |
| `/api/forecast` | GET | 是 | 达标日期预测 |
| `/api/presets` | GET | 是 | 食物与运动预设列表 |

---

## 6. 数据模型（PostgreSQL）

核心表（已由 `ensureSchemaReady()` 自动建表/补列）：

- `users`：用户账号信息
- `sessions`：会话 token hash、过期与撤销状态
- `auth_locks`：登录失败次数与锁定时间
- `rate_limit_counters`：接口限流窗口计数
- `audit_logs`：安全审计日志
- `plans`：减脂计划主表
- `daily_logs`：每日汇总（摄入/运动/缺口/状态）
- `food_items`：每日食物明细（含餐次）
- `exercise_items`：每日运动明细
- `weight_logs`：体重记录

关键关系：

- `users 1-N plans`
- `plans 1-N daily_logs`
- `daily_logs 1-N food_items / exercise_items`
- `plans 1-N weight_logs`

---

## 7. 核心业务规则（当前实现）

- BMR：Mifflin-St Jeor 公式
- TDEE：`bmr * activity_factor + average_exercise_kcal`
- 建议缺口：按目标体重差折算并限制在 `300-900`
- 日状态判定：`green` 为 `deficit >= target_deficit`；`yellow` 为 `deficit >= 0.8 * target_deficit`；其余为 `red`
- 预测暂停条件：日缺口记录少于 2 天或平均缺口 `<= 0`
- 体重预测前会做离群过滤（偏离中位数超过 2kg 的点剔除）

---

## 8. 运行与部署现状

- 构建命令：`npm run build`
- 前端开发：`npm run dev`
- 无 Vite 本地 `/api` 代理配置，前后端联调建议使用 Netlify 本地环境（如 `netlify dev`）
- 必需环境变量：`DATABASE_URL`、`SESSION_SECRET`

---

## 9. 已知限制与待补项

- 前端 `saveDailyLog` 当前未提交 `note` 内容（接口支持，UI未接入）
- 运动记录目前以“手动 kcal”为主，前端未启用“按时长+预设自动算热量”流程
- “保持登录7天”复选框仅本地记忆状态，服务端会话本身固定 7 天
- 项目未内置自动化测试（单测/集成/E2E 未接入 CI）
- `dashboard-bootstrap` 与独立接口存在一定能力重叠（可后续统一策略）

---

## 10. 给新同学的快速理解路径

1. 先看前端入口：`src/main.js`、`src/pages/LoginPage.vue`、`src/pages/DashboardPage.vue`
2. 再看后端聚合接口：`netlify/functions/dashboard-bootstrap.js`
3. 最后看写入链路：`plan-create.js`、`daily-log-upsert.js`、`weight-log-upsert.js`
4. 如需改业务规则，优先看：`netlify/functions/_lib/calc.js`、`netlify/functions/_lib/forecast.js`、`netlify/functions/_lib/presets.js`
