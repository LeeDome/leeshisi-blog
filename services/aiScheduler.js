// AI 评论后台调度：
// 1) 每 X 分钟批量审核一次未审核评论（合并调用，省 token）
// 2) 对通过审核的评论逐个触发 AI 回复（满足回复条件、且有配额才回）
const aiModel = require('../models/ai');

let lastModerateRun = null;

async function runModerationCycle() {
  try {
    const intervalMin = parseInt(await aiModel.getAiConfig('moderate_batch_interval_min')) || 2;
    const now = Date.now();
    if (lastModerateRun && now - lastModerateRun < intervalMin * 60000) return;
    lastModerateRun = now;

    const passed = await aiModel.moderatePendingBatch();
    if (passed && passed.length) {
      for (const c of passed) {
        setImmediate(() => {
          aiModel.autoReply(c).catch(err => console.error('[AI回复] 失败:', err.message));
        });
      }
    }
  } catch (err) {
    console.error('[AI调度] 批量审核异常:', err.message);
  }
}

function start() {
  // 每 30 秒检查一次是否到达批量时间点
  setInterval(runModerationCycle, 30000);
  runModerationCycle(); // 启动即跑一次
}

module.exports = { start, runModerationCycle };