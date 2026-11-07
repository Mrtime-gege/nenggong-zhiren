/** Small presentation helpers shared by the operator console. */

function shortId(id) {
  return String(id || "").replace(/^chatcmpl-/, "").slice(0, 10);
}

function fmtMs(ms) {
  if (ms === null || ms === undefined) return "—";
  const value = Math.max(0, Math.round(ms));
  if (value < 1000) return `${value}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

function fmtTime(timestamp) {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false });
}

function prettyArgs(raw) {
  if (typeof raw !== "string") {
    try {
      return JSON.stringify(raw, null, 2);
    } catch {
      return String(raw);
    }
  }
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function previewOf(ticket) {
  if (ticket.preview) return String(ticket.preview);
  const messages = ticket.messages || [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") {
      return (messages[i].content || "").replace(/\s+/g, " ").trim();
    }
  }
  if (messages.length) return (messages[messages.length - 1].content || "").replace(/\s+/g, " ").trim();
  return "(空请求)";
}


function elapsedText(startedAt) {
  const seconds = Math.max(0, Math.floor((Date.now() - Number(startedAt || Date.now())) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, "0")} 秒`;
  return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分`;
}

