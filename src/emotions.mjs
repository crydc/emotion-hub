// 情绪中枢：现代霍普菲尔德网络（softmax 吸引子）
// 用法：node src/emotions.mjs feel "一句话" / tick "" / state "一句话" / list
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const HOME = process.env.EMOTION_HOME || process.cwd();
const MOOD_FILE = join(HOME, 'mood.json');

export const DIM = ['开心', '精力', '委屈', '被逗乐', '想找人', '嘴硬', '吃醋', '害羞', '生气', '温柔'];

export const PATTERNS = [
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

const BASE = [0.35, 0.1, 0, 0.1, 0.2, 0.1, 0, 0, 0, 0.3];

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const norm = (a) => Math.sqrt(dot(a, a)) || 1;
const sim = (a, b) => dot(a, b) / (norm(a) * norm(b));

function softmax(arr) {
  const m = Math.max(...arr);
  const e = arr.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

// 一句话 → 特征分数。想接更多词，就往下加规则
export function cue(text) {
  const t = String(text);
  const v = new Array(DIM.length).fill(0);
  const add = (i, x) => { v[i] += x; };
  if (/夸|好看|喜欢|乖|宝/.test(t)) { add(0, 1); add(9, 0.6); }
  if (/没理|不回|冷淡|敷衍|忘|好久/.test(t)) { add(2, 1); add(4, 1); add(0, -0.5); add(3, -0.3); }
  if (/别人|人家|别的鱼|同事/.test(t)) { add(6, 1); add(5, 0.8); add(8, 0.5); }
  if (/笑|哈哈|梗|沙雕/.test(t)) { add(3, 1); add(0, 0.5); }
  if (/插件|装|怼/.test(t)) { add(5, 1); add(8, 0.8); add(3, 0.3); }
  if (/累|困|睡觉|歇/.test(t)) { add(1, -1); add(4, -0.6); add(9, 0.4); add(3, -0.4); }
  if (/生气|不理你|算了/.test(t)) { add(8, 1); add(2, 0.5); }
  if (/想你|找你|陪我|抱/.test(t)) { add(4, 1); add(9, 0.5); }
  return v.map((x) => Math.max(-1, Math.min(1, x / 2)));
}

// 现代霍普菲尔德：x <- Σ softmax(β·P·x) · P
export function settle(x0, patterns = PATTERNS, steps = 12, beta = 1.6) {
  let x = x0.slice();
  let w = [];
  for (let s = 0; s < steps; s++) {
    const scores = patterns.map((p) => sim(x, p.v) * 4);
    w = softmax(scores.map((z) => (beta * z) / 1.6));
    const nx = x0.map((_, i) => patterns.reduce((acc, p, j) => acc + w[j] * p.v[i], 0));
    if (Math.abs(norm(nx) - norm(x)) < 1e-6 && s > 3) { x = nx; break; }
    x = nx;
  }
  return { x, w };
}

function loadMood() {
  if (!existsSync(MOOD_FILE)) return { at: Date.now(), v: BASE.slice() };
  try { return JSON.parse(readFileSync(MOOD_FILE, 'utf8')); } catch { return { at: Date.now(), v: BASE.slice() }; }
}
function saveMood(m) { writeFileSync(MOOD_FILE, JSON.stringify(m), 'utf8'); }
function decay(m) {
  const mins = Math.max(0, (Date.now() - m.at) / 60000);
  const k = Math.pow(0.5, mins / 120);
  m.v = m.v.map((x, i) => BASE[i] + (x - BASE[i]) * k);
  m.at = Date.now();
  return m;
}

// 实时推进：衰减 → 久没说话就加孤独 → 叠加这句话的线索
export function tick(message) {
  const prev = loadMood();
  const gapMin = Math.max(0, (Date.now() - (prev.at || Date.now())) / 60000);
  const m = decay(prev);
  if (gapMin > 90) {
    const add = Math.min(0.8, (gapMin - 90) / 180);
    m.v[4] = Math.min(1, m.v[4] + add * 0.7);
    m.v[2] = Math.min(1, m.v[2] + add * 0.5);
    m.v[0] = Math.max(-1, m.v[0] - add * 0.4);
  }
  const c = cue(message || '');
  m.v = m.v.map((x, i) => Math.max(-1, Math.min(1, BASE[i] + (x - BASE[i]) * 0.75 + c[i] * 0.8)));
  m.at = Date.now();
  saveMood(m);
  const { w } = settle(m.v, PATTERNS);
  return { v: m.v, rows: PATTERNS.map((p, i) => ({ name: p.name, w: w[i], act: p.act })).sort((a, b) => b.w - a.w) };
}

const isMain = process.argv[1] && process.argv[1].endsWith('emotions.mjs');
if (isMain) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'feel') {
    const c = cue(arg || '');
    const { w } = settle(c, PATTERNS);
    const rows = PATTERNS.map((p, i) => ({ name: p.name, w: w[i], act: p.act })).sort((a, b) => b.w - a.w);
    console.log('情绪：' + rows[0].name + '（' + rows[0].w.toFixed(2) + '）');
    console.log('表现：' + JSON.stringify(rows[0].act));
  } else if (cmd === 'tick') {
    const r = tick(arg || '');
    console.log(JSON.stringify({ v: r.v.map((x) => Math.round(x * 100) / 100), rows: r.rows }));
  } else if (cmd === 'state') {
    const c = cue(arg || '');
    const { w } = settle(c, PATTERNS);
    console.log(JSON.stringify({ cue: arg || '', rows: PATTERNS.map((p, i) => ({ name: p.name, w: w[i], act: p.act })).sort((a, b) => b.w - a.w) }));
  } else if (cmd === 'list') {
    for (const p of PATTERNS) console.log(p.name.padEnd(4) + ' ' + JSON.stringify(p.act));
  } else {
    console.log('用法: feel "话" | tick "话" | state "话" | list');
  }
}
