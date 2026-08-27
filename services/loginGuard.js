// 管理后台登录防护：单 IP 失败计数 / 图形验证码 / 阶梯封禁（内存态）
// 规则：连续失败 5 次 → 封禁 10 分钟；再错 → 封禁 1 小时；之后清零重新从 10 分钟开始。
// 说明：状态存于内存，重启即清零；封禁到期后自动解锁。
const FAIL_LIMIT = 5;          // 触发封禁的连续失败次数
const MIN10 = 10 * 60 * 1000;  // 首次封禁 10 分钟
const HOUR1 = 60 * 60 * 1000;  // 升级封禁 1 小时
const RESET_MS = 10 * 60 * 1000; // 无新增失败的静默窗口：满 10 分钟后清零计数

// ip -> { fail_count, escalated(本轮是否已做过 10 分钟封禁), blocked_until }
const state = new Map();

function getMin(until) {
  return Math.max(1, Math.ceil((until - Date.now()) / 60000));
}

// 是否处于封禁中。返回 null 或 { minutes }
function isBlocked(ip) {
  const rec = state.get(ip);
  if (!rec || !rec.blocked_until) return null;
  if (Date.now() < rec.blocked_until) return { minutes: getMin(rec.blocked_until) };
  return null;
}

// 是否需要图形验证码（存在至少一次失败/封禁记录）
function needsCaptcha(ip) {
  const rec = state.get(ip);
  return !!(rec && (rec.fail_count > 0 || (rec.blocked_until && Date.now() < rec.blocked_until)));
}

// 记录一次登录失败。返回 { blocked, minutes }：blocked=true 时刚刚触发封禁
function registerFailure(ip) {
  const now = Date.now();
  let rec = state.get(ip);

  // 仍处于封禁期：不再累计，直接返回当前剩余分钟
  if (rec && rec.blocked_until && now < rec.blocked_until) {
    return { blocked: true, minutes: getMin(rec.blocked_until) };
  }

  // 记录不存在
  if (!rec) {
    rec = { fail_count: 0, escalated: false, blocked_until: 0, last_fail: 0 };
  }

  // 静默清零：未进入封禁升级阶段，且距上次失败已满 10 分钟 → 重新从 10 分钟起点计数
  // 注意：若已触发过 10 分钟封禁（escalated=true），10 分钟静默窗口不会重置该 IP 的升级状态，
  // 从而保证"封禁解除后再错 → 升级为 1 小时"的规则仍成立。
  if (!rec.escalated && rec.fail_count > 0 && now - rec.last_fail >= RESET_MS) {
    rec.fail_count = 0;
  }

  rec.last_fail = now;
  rec.fail_count += 1;

  let blocked = false;
  let minutes = 0;
  if (rec.fail_count >= FAIL_LIMIT) {
    if (!rec.escalated) {
      // 首次：封禁 10 分钟
      rec.blocked_until = now + MIN10;
      rec.escalated = true;
      blocked = true;
      minutes = 10;
    } else {
      // 升级：封禁 1 小时，然后清零，重新从 10 分钟开始
      rec.blocked_until = now + HOUR1;
      blocked = true;
      minutes = 60;
      rec.fail_count = 0;
      rec.escalated = false;
    }
  } else {
    rec.blocked_until = 0;
  }

  state.set(ip, rec);
  return { blocked, minutes };
}

// 登录成功：清零该 IP 的封禁/失败记录
function clear(ip) {
  state.delete(ip);
}

// 是否被封禁（或需要验证码）信息，以及当前剩余登录机会
// 剩余次数 = 触发封禁的阈值 - 当前失败次数，最少为 0
function remainingAttempts(ip) {
  const rec = state.get(ip);
  const count = rec ? rec.fail_count : 0;
  const remain = FAIL_LIMIT - count;
  return remain > 0 ? remain : 0;
}

// 周期清理过期记录，防止内存无限增长
function startCleanup() {
  setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of state) {
      if (!rec.blocked_until || now >= rec.blocked_until + HOUR1) {
        state.delete(ip);
      }
    }
  }, 10 * 60 * 1000);
}

module.exports = { isBlocked, needsCaptcha, registerFailure, remainingAttempts, clear, startCleanup };