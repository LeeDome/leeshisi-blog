// 评论频率限制 + IP 拉黑（防 AI token 被刷爆）
const aiModel = require('../models/ai');
const commentModel = require('../models/comment');

const WINDOW_MS = 60000;       // 限流窗口：1 分钟
const ipWindows = new Map();   // ip -> number[] 时间戳
const ipRejectCounts = new Map(); // ip -> { count, last }

function prune(ip) {
  const now = Date.now();
  const arr = ipWindows.get(ip);
  if (arr) {
    const kept = arr.filter(t => now - t < WINDOW_MS);
    if (kept.length) ipWindows.set(ip, kept);
    else ipWindows.delete(ip);
  }
}

// 校验评论是否被允许提交。返回 { allowed, reason }：allowed=false 时 reason 为 'blacklisted' | 'too_frequent'
async function checkCommentRateLimit(ip) {
  const limitPerMin = parseInt(await aiModel.getAiConfig('rate_limit_per_minute')) || 2;
  const threshold = parseInt(await aiModel.getAiConfig('rate_limit_blacklist_threshold')) || 3;
  const blackHours = parseInt(await aiModel.getAiConfig('rate_limit_blacklist_hours')) || 21;

  // 1. 黑名单中且未过期
  const blockedUntil = commentModel.isIpBlocked(ip);
  if (blockedUntil) return { allowed: false, reason: 'blacklisted' };

  // 2. 滑动窗口判频
  prune(ip);
  const now = Date.now();
  const arr = ipWindows.get(ip) || [];
  if (arr.length >= limitPerMin) {
    // 频繁触发：累计拒绝次数，达到阈值则拉黑
    const rec = ipRejectCounts.get(ip) || { count: 0, last: 0 };
    if (now - rec.last > 10 * 60000) rec.count = 0; // 10 分钟无触发则重置
    rec.count += 1;
    rec.last = now;
    ipRejectCounts.set(ip, rec);

    if (rec.count >= threshold) {
      ipRejectCounts.delete(ip);
      ipWindows.delete(ip);
      commentModel.addIpBlacklist(ip, '频繁触发评论频率限制', blackHours);
      return { allowed: false, reason: 'blacklisted' };
    }
    return { allowed: false, reason: 'too_frequent' };
  }

  // 3. 通过：记录本次评论时间，并清零拒绝次数
  arr.push(now);
  ipWindows.set(ip, arr);
  ipRejectCounts.delete(ip);
  return { allowed: true, reason: 'ok' };
}

// 周期清理内存，防止无限增长
function startCleanup() {
  setInterval(() => {
    const rejectExpire = Date.now() - 30 * 60000;
    for (const [ip, rec] of ipRejectCounts) {
      if (rec.last < rejectExpire) ipRejectCounts.delete(ip);
    }
    const winExpire = Date.now() - WINDOW_MS;
    for (const [ip, arr] of ipWindows) {
      const kept = arr.filter(t => t >= winExpire);
      if (kept.length) ipWindows.set(ip, kept);
      else ipWindows.delete(ip);
    }
  }, 10 * 60000);
}

module.exports = { checkCommentRateLimit, startCleanup };