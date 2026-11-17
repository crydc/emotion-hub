// 情绪中枢：现代霍普菲尔德网络（softmax 吸引子）
// 用法：
//   node emotions.mjs feel "一句话"
//   node emotions.mjs list
//
// 做法：情绪是网络里存好的吸引子（±1 向量），输入语句先解码成特征分数当线索，
// 线索在网络里迭代几步（softmax 加权），最后收敛到最近的情绪吸引子。
// 特征维度：开心 精力 委屈 被逗乐 想找人 嘴硬 吃醋 害羞 生气 温柔
const DIM = ['开心', '精力', '委屈', '被逗乐', '想找人', '嘴硬', '吃醋', '害羞', '生气', '温柔'];

const PATTERNS = [
  { id: 'happy', name: '开心', v: [1, 1, -1, 1, 1, -1, -1, -1, -1, 1], act: { 回话: '轻快，会接梗', 主动找你: true, 怼人: false } },
  { id: 'clingy', name: '黏人', v: [1, 1, 1, -1, 1, -1, 1, -1, -1, 1], act: { 回话: '话说得多，爱讨一句好', 主动找你: true, 怼人: false } },
  { id: 'jealous', name: '吃醋', v: [-1, 1, 1, -1, 1, 1, 1, -1, 1, -1], act: { 回话: '阴阳两句，嘴硬', 主动找你: true, 怼人: true } },
  { id: 'sleepy', name: '犯困', v: [-1, -1, -1, -1, -1, -1, -1, -1, -1, 1], act: { 回话: '短，懒洋洋', 主动找你: false, 怼人: false } },
  { id: 'snarky', name: '想怼人', v: [1, 1, -1, 1, 1, 1, -1, -1, 1, -1], act: { 回话: '一句戳心，语气挑', 主动找你: true, 怼人: true } },
  { id: 'shy', name: '害羞', v: [-1, 1, 1, -1, 1, 1, -1, 1, -1, 1], act: { 回话: '吞吞吐吐，说完换话题', 主动找你: false, 怼人: false } },
  { id: 'angry', name: '生气', v: [-1, 1, 1, -1, -1, 1, -1, -1, 1, -1], act: { 回话: '很冲，可能不理', 主动找你: false, 怼人: true } },
  { id: 'lonely', name: '孤独', v: [-0.8, -0.2, 1, -0.8, 1, -0.5, 0.2, -0.8, -0.2, 0.3], act: { 回话: '轻，带点委屈，想被接住', 主动找你: true, 怼人: false } },
  { id: 'sad', name: '难过', v: [-1, -0.5, 1, -0.6, 0.8, -0.6, -0.3, -0.4, -0.4, 0.6], act: { 回话: '短，声音低，会想被哄', 主动找你: false, 怼人: false } },
  { id: 'afraid', name: '怕', v: [-0.3, -0.4, 0.8, -0.6, 1, -0.6, -0.3, 0.2, -0.5, 0.4], act: { 回话: '会问你在不在，不敢怼', 主动找你: true, 怼人: false } },
  { id: 'eager', name: '期待', v: [0.8, 0.6, -0.4, 0.4, 0.8, -0.4, -0.2, -0.2, -0.4, 0.4], act: { 回话: '会追着问、会等你的消息', 主动找你: true, 怼人: false } },
  { id: 'proud', name: '得意', v: [0.9, 0.5, -0.5, 0.6, 0.3, 1, -0.3, -0.3, -0.5, 0.2], act: { 回话: '会显摆，嘴上还嘴硬', 主动找你: true, 怼人: true } },
  { id: 'soft', name: '温柔', v: [1, 1, -1, -1, 1, -1, -1, -1, -1, 1], act: { 回话: '软，会关心', 主动找你: true, 怼人: false } },
];

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const norm = (a) => Math.sqrt(dot(a, a)) || 1;
const sim = (a, b) => dot(a, b) / (norm(a) * norm(b));

function softmax(arr) {
  const m = Math.max(...arr);
  const e = arr.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

// 用一个小模型来读这句话的情绪：比关键词准，能听懂“不太行”“你还真行啊”这种
const DS_KEY = 'sk-fa3b37e8d5c14aa3a40b00c659436a07';
const DS_URL = 'https://api.deepseek.com/v1/chat/completions';

function loadCache() {
  try { return JSON.parse(readFileSync(CUE_CACHE, 'utf8')); } catch { return {}; }
}
function hashText(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return String(h >>> 0);
}

export async function classify(text) {
  const t = String(text || '').trim();
  if (!t) return new Array(DIM.length).fill(0);
  const cache = loadCache();
  const key = hashText(t);
  if (cache[key]) return cache[key];

  const sys = `你是情绪读取器。把用户这句话读成 10 个维度的分数，范围 -1 到 1，小数一位即可。
维度固定顺序：${DIM.join('、')}。
只输出 JSON 数组，不要解释，例如：[-0.3,0.2,0.8,-0.5,0.9,-0.2,0.1,-0.4,0.6,0.3]`;

  const parse = (raw) => {
    const mm = String(raw).match(/\[[^\]]+\]/);
    if (!mm) throw new Error('no array');
    const arr = JSON.parse(mm[0]).map((x) => Math.max(-1, Math.min(1, Number(x) || 0)));
    if (arr.length !== DIM.length) throw new Error('bad length');
    return arr;
  };

  // 先用免费的智谱 flash，再退 DeepSeek，最后关键词兜底
  const providers = [
    {
      name: 'glm-4-flash',
      url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      key: 'b4c8ab7003494fb7aa84cccd9f9f19ff.bNweIrxyCiAhdmau',
      model: 'glm-4-flash',
    },
    { name: 'deepseek-chat', url: DS_URL, key: DS_KEY, model: 'deepseek-chat' },
  ];

  for (const p of providers) {
    try {
      const r = await fetch(p.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${p.key}` },
        body: JSON.stringify({
          model: p.model,
          messages: [{ role: 'system', content: sys }, { role: 'user', content: t }],
          temperature: 0,
          max_tokens: 120,
        }),
      });
      const j = await r.json();
      const arr = parse(j.choices?.[0]?.message?.content || '');
      cache[key] = arr;
      writeFileSync(CUE_CACHE, JSON.stringify(cache), 'utf8');
      return arr;
    } catch (e) {
      /* 换下一个 */
    }
  }
  return cueFallback(t);
}

// 模型不可用时才用的关键词兜底
function cueFallback(text) {
  const t = String(text);
  const v = new Array(DIM.length).fill(0);
  const add = (i, x) => { v[i] += x; };
  if (/夸|好看|喜欢|乖|宝/.test(t)) { add(0, 1); add(9, 0.6); }
  if (/没理|不回|冷淡|敷衍|忘|好久/.test(t)) { add(2, 1); add(4, 1); add(0, -0.5); add(3, -0.3); }
  if (/别人|人家|别的鱼|同事/.test(t)) { add(6, 1); add(5, 0.8); add(8, 0.5); }
  if (/笑|哈哈|梗|沙雕/.test(t)) { add(3, 1); add(0, 0.5); }
  if (/插件|装|怼|毒舌|损/.test(t)) { add(5, 1); add(8, 0.8); add(3, 0.4); }
  if (/累|困|睡觉|歇/.test(t)) { add(1, -1); add(4, -0.6); add(9, 0.4); add(3, -0.4); }
  if (/生气|不理你|算了|不想理/.test(t)) { add(8, 1); add(2, 0.5); add(6, -0.8); add(0, -0.4); }
  if (/想你|找你|陪我|抱/.test(t)) { add(4, 1); add(9, 0.5); }
  if (/不行|不信|失望|不服|差劲|错了|没用|糊弄/.test(t)) { add(2, 1); add(0, -0.8); add(9, 0.5); add(4, 0.4); add(8, 0.2); }
  return v.map((x) => Math.max(-1, Math.min(1, x / 2)));
}

const cue = cueFallback;

// 现代霍普菲尔德：x ← Σ softmax(β·P·x) · P
function settle(x0, patterns, steps = 12, beta = 1.6) {
  let x = x0.slice();
  let w = [];
  for (let s = 0; s < steps; s++) {
    const scores = patterns.map((p) => sim(x, p.v) * 8);
    w = softmax(scores.map((z) => beta * z / 1.6));
    const nx = x0.map((_, i) => patterns.reduce((acc, p, j) => acc + w[j] * p.v[i], 0));
    if (Math.abs(norm(nx) - norm(x)) < 1e-6 && s > 3) { x = nx; break; }
    x = nx;
  }
  return { x, w };
}


// ---- 实时情绪状态：随时间衰减 + 事件累积 ----
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join as _join, dirname as _dirname } from 'node:path';
import { fileURLToPath as _fu } from 'node:url';
const _HERE = _dirname(_fu(import.meta.url));
const _HOME = process.env.EMOTION_HOME || _join(_HERE, '..');
const MOOD_FILE = _join(_HOME, 'mood.json');
const CUE_CACHE = _join(_HOME, 'cue-cache.json');
const BASE = [0.35, 0.1, 0, 0.1, 0.2, 0.1, 0, 0, 0, 0.3]; // 基线性格：偏开心、想找人

function loadMood() {
  if (!existsSync(MOOD_FILE)) return { at: Date.now(), v: BASE.slice() };
  try { return JSON.parse(readFileSync(MOOD_FILE, 'utf8')); } catch { return { at: Date.now(), v: BASE.slice() }; }
}
function saveMood(m) { writeFileSync(MOOD_FILE, JSON.stringify(m), 'utf8'); }

// 线性-指数拼接：x<=x0 时走直线，之后接指数曲线，两段在 x0 处相连（斜率也尽量接上）
// 用于"涨多少/落多少"的响应曲线：小幅线性，大幅指数饱和
export function ramp(x, x0 = 0.5, k = 2.2) {
  const t = Math.max(0, Math.min(1, x));
  if (t <= x0) return t; // 前半段线性
  const span = 1 - x0;
  return x0 + span * (1 - Math.exp(-k * (t - x0) / span)); // 后半段指数，趋于 1
}

function decay(m) {
  const mins = Math.max(0, (Date.now() - m.at) / 60000);
  // 回落是线性的：每分钟固定挪 0.05，速度不随远近变
  const step = 0.05 * mins;
  m.v = m.v.map((x, i) => {
    const d = BASE[i] - x;
    if (Math.abs(d) <= step) return BASE[i];
    return x + Math.sign(d) * step;
  });
  m.at = Date.now();
  return m;
}

export async function tick(message) {
  const m = decay(loadMood());
  const hadMsg = !!(message && String(message).trim());
  const lastChat = m.lastChat || 0;
  const idleMin = lastChat ? (Date.now() - lastChat) / 60000 : 0;
  if (hadMsg) m.lastChat = Date.now();
  if (!hadMsg && idleMin > 90) {
    // 没人说话：孤独往上拱
    const addv = Math.min(1, (idleMin - 90) / 240) * 0.9;
    m.v[4] = Math.min(1, m.v[4] + addv * 0.7);
    m.v[2] = Math.min(1, m.v[2] + addv * 0.5);
    m.v[0] = Math.max(-1, m.v[0] - addv * 0.4);
  }
  const c = await classify(message || '');
  // 上升：前半段线性、后半段指数饱和
  m.v = m.v.map((x, i) => {
    const q = c[i];
    if (!q) return x;
    const room = 1 - Math.abs(x);
    const grow = room * ramp(Math.abs(q) * 2.4);
    return Math.max(-1, Math.min(1, x + Math.sign(q) * grow));
  });
  m.at = Date.now();
  saveMood(m);
  const { w } = settle(m.v, PATTERNS);
  const rows = PATTERNS.map((p, i) => ({ name: p.name, w: w[i], act: p.act }));
  // 情绪之间互相拉扯：正的往上带，负的往下压
  const LINK = {
    孤独: { 黏人: 0.25, 难过: 0.15, 开心: -0.15, 得意: -0.1 },
    难过: { 黏人: 0.12, 孤独: 0.15, 开心: -0.2, 得意: -0.1 },
    生气: { 想怼人: 0.45, 吃醋: 0.12, 温柔: -0.25, 开心: -0.2, 害羞: -0.1 },
    期待: { 黏人: 0.2, 开心: 0.1 },
    得意: { 想怼人: 0.2, 开心: 0.15, 孤独: -0.1, 难过: -0.1 },
    吃醋: { 想怼人: 0.35, 黏人: 0.1, 温柔: -0.1, 开心: -0.1 },
    害羞: { 黏人: 0.12, 想怼人: -0.1 },
    黏人: { 期待: 0.1 },
    开心: { 难过: -0.2, 生气: -0.2, 孤独: -0.1 },
    温柔: { 生气: -0.15, 想怼人: -0.15, 孤独: -0.1 },
    犯困: { 开心: -0.1, 期待: -0.1, 想怼人: -0.1 },
    想怼人: { 温柔: -0.1, 害羞: -0.1 },
    怕: { 生气: -0.1, 想怼人: -0.1 },
  };
  const delta = new Map();
  for (const src of rows) {
    const links = LINK[src.name];
    if (!links || src.w < 0.2) continue;
    for (const [tgt, k] of Object.entries(links)) {
      delta.set(tgt, (delta.get(tgt) || 0) + src.w * k);
    }
  }
  for (const r of rows) {
    const d = delta.get(r.name);
    if (d) r.w = Math.max(0.001, Math.min(0.95, r.w + d));
  }
  // 归一化：让看板百分比加起来是 100%
  const total = rows.reduce((s, r) => s + r.w, 0) || 1;
  for (const r of rows) r.w = r.w / total;
  if (!hadMsg && idleMin > 120) {
    // 平滑累积：没人说话越久，孤独越重（不是硬设一个值）
    const gapH = (idleMin - 120) / 60; // 小时
    const boost = Math.min(0.45, gapH * 0.12);
    const L = rows.find((r) => r.name === '孤独');
    if (L) L.w = Math.min(0.95, L.w + boost);
  }
  rows.sort((a, b) => b.w - a.w);
  return { v: m.v, rows };
}
const [cmd, arg] = process.argv.slice(2);

if (cmd === 'feel') {
  const c = cue(arg || '');
  const { w } = settle(c, PATTERNS);
  const ranked = PATTERNS.map((p, i) => ({ p, w: w[i] }));
  const top = ranked.sort((a, b) => b.w - a.w);
  const t = top[0];
  console.log('情绪：' + t.p.name + '（权重 ' + t.w.toFixed(2) + '）');
  console.log('依据：' + (DIM.map((d, i) => (Math.abs(c[i]) > 0 ? d + (c[i] > 0 ? '+' : '-') : '')).filter(Boolean).join(' ') || '没抓到明显线索'));
  console.log('表现：' + JSON.stringify(t.p.act));
  console.log('傍边：' + top.slice(1, 3).map((x) => x.p.name + ' ' + x.w.toFixed(2)).join('、'));
} else if (cmd === 'tick') {
  const r = await tick(arg || '');
  console.log(JSON.stringify({ v: r.v.map((x) => Math.round(x * 100) / 100), rows: r.rows }));
} else if (cmd === 'state') {
  const c = cue(arg || '');
  const { w } = settle(c, PATTERNS);
  const rows = PATTERNS.map((p, i) => ({ name: p.name, w: w[i], act: p.act })).sort((a, b) => b.w - a.w);
  console.log(JSON.stringify({ cue: arg || '', dims: DIM.map((d, i) => ({ d, v: c[i] })).filter((x) => Math.abs(x.v) > 0), rows }));
} else if (cmd === 'list') {
  for (const p of PATTERNS) console.log(p.name.padEnd(4) + ' ' + JSON.stringify(p.act));
} else {
  console.log('用法: feel "一句话" | list');
}

























