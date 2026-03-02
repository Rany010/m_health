export function json(statusCode, data) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(data)
  };
}

export function ok(data) {
  return json(200, data);
}

export function created(data) {
  return json(201, data);
}

export function badRequest(message) {
  return json(400, { error: message });
}

export function unauthorized(message = "未授权访问") {
  return json(401, { error: message });
}

export function forbidden(message = "禁止访问") {
  return json(403, { error: message });
}

export function tooManyRequests(message = "请求过于频繁，请稍后再试") {
  return json(429, { error: message });
}

export function serverError(message = "服务内部错误") {
  return json(500, { error: message });
}
