// 消费 wake.flag：心跳只负责“想找人”，这里负责把信号交出去
// 用法：node src/consumer.mjs
// 每 10 秒看一眼 wake.flag；有就读出来、删掉、交给 onWake 配置的动作
import { readFileSync, existsSync, unlinkSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.EMOTION_HOME || join(HERE, '..');
const WAKE = join(HOME, 'wake.flag');
const LOG = join(HOME, 'consumer.log');
const CFG = existsSync(join(HOME, 'config.json')) ? JSON.parse(readFileSync(join(HOME, 'config.json'), 'utf8')) : {};
const hook = CFG.onWake || {};
const PERIOD = Number(CFG.consumerSeconds ?? 10) * 1000;

function log(s) { appendFileSync(LOG, new Date().toISOString().slice(0, 19).replace('T', ' ') + ' ' + s + '\n', 'utf8'); }

async function deliver(payload) {
  // 1) 走 webhook（把你自己的 agent 接口填在这里）
  if (hook.webhook) {
    try {
      const r = await fetch(hook.webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'emotion-wake', ...payload }),
        signal: AbortSignal.timeout(15000), // 卡住也不能拖死整个循环
      });
      log('webhook ' + r.status);
      if (!r.ok) log('webhook 返回异常，信号已丢弃：' + JSON.stringify(payload));
    } catch (e) {
      log('webhook 失败（' + e.message + '），信号已丢弃：' + JSON.stringify(payload));
    }
    return;
  }
  // 2) 走命令：命令的 stdin 收 JSON，stdout 随便
  if (hook.command) {
    await new Promise((resolve) => {
      const child = execFile(hook.command, (hook.args || []), { timeout: 60000 }, (err) => {
        if (err) log('命令失败：' + err.message + '，信号已丢弃');
        resolve();
      });
      try { child.stdin.write(JSON.stringify(payload)); child.stdin.end(); } catch (e) { log('写 stdin 失败：' + e.message); resolve(); }
    });
    return;
  }
  // 3) 什么都没配：只打日志，提醒你去接
  log('收到唤醒信号（未配置 onWake）：' + JSON.stringify(payload));
}

async function loop() {
  if (existsSync(WAKE)) {
    try {
      const payload = JSON.parse(readFileSync(WAKE, 'utf8'));
      unlinkSync(WAKE);
      await deliver(payload);
    } catch (e) {
      log('处理唤醒失败：' + e.message);
      try { unlinkSync(WAKE); } catch { /* ignore */ }
    }
  }
  setTimeout(loop, PERIOD);
}

log('consumer 启动，监听 ' + WAKE);
loop();
