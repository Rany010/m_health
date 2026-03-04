const PERF_KEY = "__MHEALTH_PERF__";
const MAX_API_RECORDS = 500;

function hasWindow() {
  return typeof window !== "undefined";
}

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function percentile(sortedValues, ratio) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * ratio) - 1));
  return sortedValues[index];
}

function getStore() {
  if (!hasWindow()) {
    return {
      api_calls: [],
      marks: {},
      first_interactive: null
    };
  }
  if (!window[PERF_KEY]) {
    window[PERF_KEY] = {
      api_calls: [],
      marks: {},
      first_interactive: null
    };
  }
  return window[PERF_KEY];
}

export function markPerf(name) {
  if (!name) return 0;
  const ts = nowMs();
  const store = getStore();
  store.marks[name] = ts;
  return ts;
}

export function markFirstInteractive(label = "dashboard_first_interactive") {
  const store = getStore();
  if (store.first_interactive) return store.first_interactive;
  const ts = nowMs();
  store.first_interactive = {
    label,
    since_navigation_ms: Math.round(ts),
    at: new Date().toISOString()
  };
  return store.first_interactive;
}

export function recordApiMetric(metric) {
  if (!metric) return;
  const store = getStore();
  store.api_calls.push({
    method: metric.method || "GET",
    path: metric.path || "",
    duration_ms: Number(metric.duration_ms ?? 0),
    status: Number(metric.status ?? 0),
    ok: Boolean(metric.ok),
    error: metric.error || "",
    at: metric.at || new Date().toISOString()
  });
  if (store.api_calls.length > MAX_API_RECORDS) {
    store.api_calls.splice(0, store.api_calls.length - MAX_API_RECORDS);
  }
}

export function getPerfSnapshot() {
  const store = getStore();
  return {
    api_calls: [...store.api_calls],
    marks: { ...store.marks },
    first_interactive: store.first_interactive ? { ...store.first_interactive } : null
  };
}

export function printPerfSummary(label = "runtime") {
  if (!hasWindow()) return null;
  const snapshot = getPerfSnapshot();
  const groups = new Map();
  for (const item of snapshot.api_calls) {
    const key = `${item.method} ${item.path}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(item);
  }

  const rows = [];
  for (const [key, items] of groups.entries()) {
    const sorted = items.map((it) => it.duration_ms).sort((a, b) => a - b);
    const total = sorted.reduce((sum, ms) => sum + ms, 0);
    const errors = items.filter((it) => !it.ok).length;
    rows.push({
      api: key,
      count: items.length,
      avg_ms: Math.round(total / Math.max(items.length, 1)),
      p95_ms: Math.round(percentile(sorted, 0.95)),
      max_ms: Math.round(sorted[sorted.length - 1] || 0),
      error_count: errors
    });
  }
  rows.sort((a, b) => b.avg_ms - a.avg_ms);

  console.groupCollapsed(`[perf] ${label}`);
  if (snapshot.first_interactive) {
    console.info("first_interactive_ms:", snapshot.first_interactive.since_navigation_ms);
  }
  if (rows.length > 0) {
    console.table(rows);
  } else {
    console.info("no api metrics collected");
  }
  console.groupEnd();

  return {
    first_interactive: snapshot.first_interactive,
    apis: rows
  };
}
