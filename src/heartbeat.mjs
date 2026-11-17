// 情绪心跳：每分钟算一次；过了阈值就投骰子，中了留一个唤醒信号
// 信号留给 agent / 上层应用读，由它看上下文后自己开口
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.EMOTION_HOME || join(HERE, '..');
const CFG_PATH = join(HOME, 'config.json');
const LOG = join(HOME, 'heartbeat.log');
const LAST_SEND = join(HOME, 'last-ping.json');
const WAKE = join(HOME, 'wake.flag');

const cfg = existsSync(CFG_PATH) ? JSON.parse(readFileSync(CFG_PATH, 'utf8')) : {};
const THRESHOLD = Number(cfg.threshold ?? 0.35);
const SNARK_THRESHOLD = Number(cfg.snarkThreshold ?? 0.25);
const COOLDOWN_MIN = Number(cfg.cooldownMinutes ?? 35);
const DAILY_MAX = Number(cfg.dailyMax ?? 5);
const IDLE_MIN = Number(cfg.idleMinutes ?? 12);
const [H1, H2] = cfg.activeHours || [8, 23];
const PERIOD = Number(cfg.heartbeatSeconds ?? 60) * 1000;
const ONEBOOT = cfg.onebotUrl || '';
const TOKEN = cfg.onebotToken || '';
const TARGET = cfg.targetUid;

function log(s) { appendFileSync(LOG, new Date().toISOString().slice(0, 19).replace('T', ' ') + ' ' + s + '\n', 'utf8'); }
function readJson(p, def) { try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : def; } catch { return def; } }

function emotions(arg) {
  return new Promise((resolve) => {
    const script = join(HERE, 'emotions.mjs');
    execFile(process.execPath, [script, 'tick', arg || ''], { timeout: 15000 }, (err, stdout) => {
      if (err) return resolve(null);
      try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
    });
  });
}

async function lastMsgMinutes() {
  if (!ONEBOOT || !TOKEN || !TARGET) return 0;
  try {
    const r = await fetch(ONEBOOT + '/get_friend_msg_history', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ user_id: Number(TARGET), message_seq: 0, count: 3 }),
    });
    const j = await r.json();
    const msgs = j?.data?.messages || [];
    const last = msgs.sort((a, b) => b.time - a.time)[0];
    return last ? (Date.now() / 1000 - Number(last.time)) / 60 : 9999;
  } catch { return 0; }
}

async function loop() {
  const now = new Date();
  const hour = now.getHours();
  if (hour < H1 || hour >= H2) { log('安静时段'); setTimeout(loop, 180000); return; }

  if (ONEBOOT && TOKEN && TARGET) {
    const last = await lastMsgMinutes();
    if (last < IDLE_MIN) { log('刚聊过（' + Math.round(last) + ' 分钟前），不打扰'); setTimeout(loop, 120000); return; }
  }

  const st = await emotions('');
  if (!st?.rows?.length) { setTimeout(loop, PERIOD); return; }
  const top = st.rows[0];
  const ping = readJson(LAST_SEND, { at: 0, day: '', count: 0, tries: 0 });
  const today = now.toLocaleDateString('sv-SE');
  if (ping.day !== today) { ping.day = today; ping.count = 0; }

  const mins = (Date.now() - (ping.at || 0)) / 60000;
  const limit = top.act?.怼人 ? SNARK_THRESHOLD : THRESHOLD;
  const base = Math.max(0, (top.w - limit) / (1 - limit));
  const e = 1 - Math.exp(-3.2 * base);
  const tries = Number(ping.tries || 0);
  const p = Math.min(0.9, 1 - Math.pow(1 - e, 1 + tries * 0.6));
  const roll = Math.random();
  log('情绪 ' + top.name + ' ' + top.w.toFixed(2) + ' 概率 ' + p.toFixed(2) + ' 掷 ' + roll.toFixed(2));

  if (p > 0 && roll < p && top.act?.主动找你 && mins >= COOLDOWN_MIN && ping.count < DAILY_MAX) {
    ping.at = Date.now(); ping.count += 1; ping.tries = 0;
    writeFileSync(LAST_SEND, JSON.stringify(ping), 'utf8');
    writeFileSync(WAKE, JSON.stringify({ at: Date.now(), emotion: top.name, weight: top.w, act: top.act }), 'utf8');
    log('留下唤醒信号：' + top.name);
  } else if (p > 0) {
    ping.tries = tries + 1;
    writeFileSync(LAST_SEND, JSON.stringify(ping), 'utf8');
  }
  setTimeout(loop, PERIOD);
}

loop();

