/* 自测：把 index.html 里的内联脚本抽出来，在 Node 里跑一遍纯逻辑。
   不依赖浏览器，用来抓语法错误、时间判断、提示词、Markdown 转义、SSE 解析。
   用法：node tools/selftest.mjs
*/
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* ---------- 抽出内联脚本 ---------- */
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error('没找到内联脚本');
let code = m[1];

const EXPORT_MARK = 'globalThis.__SG = {';
code = code.replace(
  /if \(document\.readyState === 'loading'\)[\s\S]*?else init\(\);/,
  ''
);
code = code.replace(/\}\)\(\);\s*$/, `
  globalThis.__SG = {
    periodOf, activeSlot, slotDayKey, hintAllowed, gapText, nowContext,
    buildSystemPrompt, directiveFor, renderMarkdown, inlineMd, explainError,
    readStream, fmtMsgTime, SLOTS, store, dateKeyOf, pad2, DAY_SLOT_KEYS: SLOTS.map(s => s.id),
    callAPI, apiUrl, apiError,
    collectDays, countInDay, deleteDay, deleteBefore, bytesUsed, dayLabel,
    summaryBlock, dayLabelShort,
    parseCourseLine, makeWeeks, fmtWeeks, weekNoOf, coursesOn, nextClass, courseBlock,
    extractOps, applyScheduleOps, parseWeeksSpec, toWeekday, buildSchedulePrompt,
    imgTargetSize, composePayload, pickImagesToDrop
  };
})();
`);

/* ---------- 最小环境桩 ---------- */
function makeEl() {
  const el = {
    style: {}, dataset: {}, hidden: false, value: '', textContent: '', innerHTML: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, setAttribute() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    focus() {}, scrollHeight: 0, scrollTop: 0, clientHeight: 0
  };
  return el;
}
const storage = new Map();
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  cancelAnimationFrame: () => {},
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k)
  },
  location: { protocol: 'file:', search: '' },
  navigator: {},
  document: {
    readyState: 'complete',
    addEventListener() {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => makeEl()
  },
  matchMedia: () => ({ matches: false }),
  TextDecoder,
  ReadableStream,
  Response,
  AbortController,
  Math, Date, JSON, Object, Array, String, Number, Boolean, Error, Promise, RegExp
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'index.inline.js' });

const G = sandbox.__SG;
if (!G) throw new Error('导出失败');

/* ---------- 断言工具 ---------- */
let pass = 0, fail = 0;
const bad = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; bad.push(name + (extra ? ' :: ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' :: ' + extra : '')); }
}
function eq(name, got, want) { ok(name, got === want, `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); }

console.log('\n[1] 时段划分');
eq('0:00 → 凌晨', G.periodOf(0), '凌晨');
eq('5:00 → 清晨', G.periodOf(5), '清晨');
eq('7:00 → 上午', G.periodOf(7), '上午');
eq('11:00 → 上午', G.periodOf(11), '上午');
eq('12:00 → 中午', G.periodOf(12), '中午');
eq('15:00 → 下午', G.periodOf(15), '下午');
eq('18:00 → 傍晚', G.periodOf(18), '傍晚');
eq('21:00 → 晚上', G.periodOf(21), '晚上');
eq('23:30 → 深夜', G.periodOf(23), '深夜');

console.log('\n[2] 提醒时段边界');
eq('00:30 命中深夜', G.activeSlot(30) && G.activeSlot(30).id, 'night');
eq('05:20 命中深夜', G.activeSlot(5 * 60 + 20).id, 'night');
eq('05:30 不再是深夜', G.activeSlot(5 * 60 + 30), null);
eq('06:00 清晨', G.activeSlot(360).id, 'morning');
eq('09:29 清晨', G.activeSlot(569).id, 'morning');
eq('09:30 无时段', G.activeSlot(570), null);
eq('12:00 午间', G.activeSlot(720).id, 'noon');
eq('13:00 无时段', G.activeSlot(780), null);
eq('18:30 晚间', G.activeSlot(1110).id, 'evening');
eq('20:00 无时段', G.activeSlot(1200), null);
eq('23:29 无时段', G.activeSlot(23 * 60 + 29), null);
eq('23:30 深夜', G.activeSlot(1410).id, 'night');

console.log('\n[3] 深夜跨零点只提醒一次');
const night = G.SLOTS.find((s) => s.id === 'night');
const ts2330 = new Date(2026, 4, 1, 23, 30).getTime();
const ts0100 = new Date(2026, 4, 2, 1, 0).getTime();
eq('23:30 的日记到 5/1', G.slotDayKey(night, ts2330), '2026-05-01');
eq('01:00 的日记到 5/1（同一晚）', G.slotDayKey(night, ts0100), '2026-05-01');

console.log('\n[4] 提醒闸门');
const S = G.store;
S.settings.reminders = { enabled: true, tone: 'gentle', night: true, morning: true, noon: true, evening: true };
S.hints = {};
S.lastHintTs = 0;
ok('默认允许深夜提醒', G.hintAllowed(night, ts2330));
S.hints = { night: ts2330 };
ok('同一晚已提醒过 → 拒绝', !G.hintAllowed(night, ts0100));
S.hints = {};
S.lastHintTs = ts2330;
ok('45 分钟内 → 拒绝', !G.hintAllowed(night, new Date(2026, 4, 2, 0, 5).getTime()));
ok('隔天同一时段 → 允许', G.hintAllowed(night, new Date(2026, 4, 2, 23, 40).getTime()));
S.settings.reminders.tone = 'quiet';
ok('不打扰模式 → 拒绝', !G.hintAllowed(night, new Date(2026, 4, 2, 23, 40).getTime()));
S.settings.reminders.tone = 'gentle';
S.settings.reminders.night = false;
ok('关闭深夜 → 拒绝', !G.hintAllowed(night, new Date(2026, 4, 3, 23, 40).getTime()));
S.settings.reminders.night = true;
S.settings.reminders.enabled = false;
ok('总开关关 → 拒绝', !G.hintAllowed(night, new Date(2026, 4, 3, 23, 40).getTime()));
S.settings.reminders.enabled = true;
S.hints = {}; S.lastHintTs = 0;

console.log('\n[5] 提示词');
const ctx = { full: '2026年5月1日 23:41', weekday: '星期五', period: '深夜', clock: '23:41', minutes: 23 * 60 + 41, ts: ts2330 };
const p1 = G.buildSystemPrompt(ctx, night, S.settings, '3 小时前');
ok('含准确时间', p1.includes('2026年5月1日 23:41'));
ok('含星期', p1.includes('星期五'));
ok('含本轮建议', p1.includes('【本轮建议】') && p1.includes('早点休息'));
ok('含不许硬提时间的规则', p1.includes('不要为了显得你知道时间而硬提时间'));
ok('含距上次聊天', p1.includes('3 小时前'));
const p2 = G.buildSystemPrompt(ctx, null, S.settings, '刚刚');
ok('无时段时不催关心', p2.includes('本轮不需要主动提时间'));
ok('无时段仍给时间', p2.includes('23:41'));
S.settings.persona = '叫我小林';
ok('人设追加', G.buildSystemPrompt(ctx, null, S.settings, '刚刚').includes('叫我小林'));
S.settings.persona = '';

console.log('\n[6] 错误解释');
eq('401', G.explainError({ code: 'http', extra: { status: 401 } }).slice(0, 6), '401 AP');
ok('网络错误提到跨域', G.explainError({ code: 'network' }).includes('跨域'));
ok('缺 Key 提示去设置', G.explainError({ code: 'no_key' }).includes('设置'));

console.log('\n[7] Markdown 转义与渲染');
const injected = G.renderMarkdown('<img src=x onerror=alert(1)>');
ok('HTML 被转义', !injected.includes('<img') && injected.includes('&lt;img'));
const md = G.renderMarkdown('**粗体** 和 `代码`\n\n- 一\n- 二\n\n```js\nconst a = 1;\n```');
ok('加粗', md.includes('<strong>粗体</strong>'));
ok('行内代码', md.includes('<code>代码</code>'));
ok('列表', md.includes('<ul><li>一</li><li>二</li></ul>'));
ok('代码块', md.includes('code-lang') && md.includes('const a = 1;'));
const link = G.renderMarkdown('[官网](https://example.com)');
ok('链接', link.includes('<a href="https://example.com"'));
ok('javascript: 不生成链接', !G.renderMarkdown('[x](javascript:alert(1))').includes('href="javascript'));

console.log('\n[8] SSE 流解析');
const sse =
  'data: {"choices":[{"delta":{"reasoning_content":"想一想"}}]}\n\n' +
  'data: {"choices":[{"delta":{"content":"你"}}]}\n\n' +
  'data: {"choices":[{"delta":{"content":"好"}}]}\n\n' +
  'data: [DONE]\n\n';
const stream = new ReadableStream({
  start(c) {
    const bytes = new TextEncoder().encode(sse);
    // 故意切成两半，验证跨 chunk 的行拼接
    c.enqueue(bytes.slice(0, 60));
    c.enqueue(bytes.slice(60));
    c.close();
  }
});
const deltas = [];
G.readStream(new Response(stream), (kind, txt) => deltas.push(kind + ':' + txt)).then(async (r) => {
  eq('内容拼接', r.content, '你好');
  eq('思考内容', r.reasoning, '想一想');
  eq('delta 顺序', deltas.join('|'), 'reasoning:想一想|content:你|content:好');

  console.log('\n[9] 时间文案');
  const now = Date.now();
  eq('刚刚', G.gapText(now - 30 * 1000, now), '刚刚');
  eq('分钟', G.gapText(now - 20 * 60000, now), '20 分钟前');
  eq('小时', G.gapText(now - 3 * 3600 * 1000, now), '3 小时前');
  eq('天', G.gapText(now - 50 * 3600 * 1000, now), '2 天前');

  console.log('\n[10] 结构一致性');
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]));
  const cacheSrc = (html.match(/\[\s*'btnMenu'[\s\S]*?\]\.forEach/) || [''])[0];
  const refs = [...cacheSrc.matchAll(/'([A-Za-z]\w*)'/g)].map((x) => x[1]);
  ok('界面缓存列表已解析（' + refs.length + ' 个 id）', refs.length > 20);
  const missing = refs.filter((id) => !ids.has(id));
  ok('所有引用的元素 id 都存在', missing.length === 0, missing.join(','));

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  ok('manifest 可解析', !!manifest.name && manifest.display === 'standalone');
  const iconOk = manifest.icons.every((i) => fs.existsSync(path.join(ROOT, i.src.replace('./', ''))));
  ok('manifest 里的图标文件都存在', iconOk);
  ok('index.html 引用了 manifest', html.includes('manifest.webmanifest'));
  ok('index.html 引用了 sw.js 注册', html.includes("register('./sw.js')"));

  console.log('\n[11] 接口层（打桩 fetch）');
  const S2 = G.store;
  S2.settings.apiKey = 'sk-test';
  S2.settings.proxyUrl = '';
  eq('默认地址', G.apiUrl(), 'https://api.deepseek.com/chat/completions');
  S2.settings.proxyUrl = 'https://relay.example.com';
  eq('代理地址拼接', G.apiUrl(), 'https://relay.example.com/chat/completions');
  S2.settings.proxyUrl = 'https://relay.example.com/chat/completions/';
  eq('已含路径不重复拼接', G.apiUrl(), 'https://relay.example.com/chat/completions');
  S2.settings.proxyUrl = '';

  let seen = null;
  sandbox.fetch = async (url, init) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ choices: [{ message: { content: '收到' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  const r1 = await G.callAPI([{ role: 'user', content: 'hi' }], { stream: false });
  eq('非流式内容', r1.content, '收到');
  eq('请求地址', seen.url, 'https://api.deepseek.com/chat/completions');
  eq('model 默认值', seen.body.model, 'deepseek-flash');
  eq('stream 标记', seen.body.stream, false);
  eq('Authorization', seen.init.headers.Authorization, 'Bearer sk-test');
  ok('未开深度思考时不传 thinking', !('thinking' in seen.body));

  const deltas2 = [];
  sandbox.fetch = async () =>
    new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"嗨"}}]}\n\ndata: {"choices":[{"delta":{"content":"呀"}}]}\n\ndata: [DONE]\n\n'));
          c.close();
        }
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } }
    );
  const r2 = await G.callAPI([{ role: 'user', content: 'hi' }], {
    stream: true,
    onDelta: (k, t) => deltas2.push(k + ':' + t)
  });
  eq('流式内容', r2.content, '嗨呀');
  eq('流式回调', deltas2.join('|'), 'content:嗨|content:呀');

  sandbox.fetch = async () => new Response('{"error":{"message":"Invalid API key"}}', { status: 401 });
  let e401 = null;
  try { await G.callAPI([{ role: 'user', content: 'x' }], { stream: false }); } catch (e) { e401 = e; }
  eq('401 归类', e401 && e401.code, 'http');
  eq('401 状态码', e401 && e401.extra.status, 401);
  ok('401 中文文案', G.explainError(e401).indexOf('401') === 0);

  sandbox.fetch = async () => { throw new TypeError('Failed to fetch'); };
  let eNet = null;
  try { await G.callAPI([{ role: 'user', content: 'x' }], { stream: false }); } catch (e) { eNet = e; }
  eq('网络错误归一化', eNet && eNet.code, 'network');

  S2.settings.apiKey = '';
  let eKey = null;
  try { await G.callAPI([], { stream: false }); } catch (e) { eKey = e; }
  eq('缺 Key 拦截', eKey && eKey.code, 'no_key');
  S2.settings.apiKey = 'sk-test';
  S2.settings.proxyUrl = '';

  console.log('\n[12] 记录面板：分组与删除');
  const t1 = new Date(2026, 9, 1, 9, 0).getTime();
  const t2 = new Date(2026, 9, 2, 9, 0).getTime();
  const t3 = new Date(2026, 9, 3, 9, 0).getTime();
  S2.convs = [
    { id: 'a', title: '甲', updatedAt: t3, messages: [
      { id: '1', role: 'user', content: '一号', ts: t1 },
      { id: '2', role: 'assistant', content: '回复一', ts: t1 + 1000 }
    ] },
    { id: 'b', title: '乙', updatedAt: t3, messages: [
      { id: '3', role: 'user', content: '二号', ts: t2 },
      { id: '4', role: 'user', content: '三号', ts: t3 }
    ] }
  ];
  let days = G.collectDays();
  eq('按天分组天数', days.length, 3);
  eq('最新一天排最前', days[0].key, '2026-10-03');
  eq('最早一天有 2 条', days[2].count, 2);
  eq('countInDay 单日计数', G.countInDay('2026-10-02'), 1);
  ok('bytesUsed 大于 0', G.bytesUsed() > 0);
  eq('dayLabel 格式', G.dayLabel('2026-10-03'), '10月3日 星期六');

  eq('删除单天返回条数', G.deleteDay('2026-10-02'), 1);
  eq('删除后剩 2 天', G.collectDays().length, 2);
  eq('删除不影响别的天', G.countInDay('2026-10-03'), 1);

  eq('批量删除更早返回条数', G.deleteBefore('2026-10-03'), 2);
  let left = 0;
  S2.convs.forEach(function (c) { left += c.messages.length; });
  eq('批量删除后只剩 1 条', left, 1);

  console.log('\n[13] 每日摘要');
  const S4 = G.store;
  S4.days = {
    '2026-10-01': { text: '用户在准备四级', ts: 0, src: 'auto' },
    '2026-10-02': { text: '聊了课表和部署', ts: 0, src: 'auto' },
    '2026-10-03': { text: '', ts: 0, src: 'auto' }
  };
  const block = G.summaryBlock();
  ok('摘要块含日期', block.indexOf('10月1日') >= 0);
  ok('摘要块含内容', block.indexOf('四级') >= 0);
  ok('空摘要不入块', block.indexOf('10月3日') < 0);
  ok('摘要块带使用约束', block.indexOf('不要主动复述') >= 0);
  eq('dayLabelShort 格式', G.dayLabelShort('2026-10-03'), '10月3日');

  G.deleteDay('2026-10-02');
  ok('删一天会同时删摘要', !S4.days['2026-10-02']);
  G.deleteBefore('2026-10-03');
  ok('批量删除会清掉更早的摘要', !S4.days['2026-10-01']);

  console.log('\n[14] 课表解析');
  const p1 = G.parseCourseLine('周一 08:00-09:40 数据结构 @教三204 1-16周');
  ok('解析课程名', p1 && p1.name === '数据结构');
  eq('解析教室', p1 && p1.room, '教三204');
  eq('解析星期', p1 && p1.weekday, 1);
  eq('解析时间', p1 && p1.start + '-' + p1.end, '08:00-09:40');
  eq('周数 16 周', p1 && p1.weeks.length, 16);

  const p2 = G.parseCourseLine('星期三 14:00-15:40 计算机组成原理，教二108，1-16周');
  ok('中文逗号 + 无 @ 也能认教室', p2 && p2.name === '计算机组成原理' && p2.room === '教二108');

  const p3 = G.parseCourseLine('周二 10:00-11:40 大学英语 @外语楼301 1-16周 单周');
  ok('单周只留奇数周', p3 && p3.weeks.every((n) => n % 2 === 1));

  eq('没有时间视为无效', G.parseCourseLine('随便一句话'), null);
  eq('全角数字兼容', G.parseCourseLine('周一 ０８:００-０９:４０ 高数 @A101 1-4周').start, '08:00');
  ok('单周但未写周次也生效', G.parseCourseLine('周一 08:00-09:40 体育 @操场 单周').weeks.indexOf(2) < 0);

  console.log('\n[15] 周次与下一节课');
  const S5 = G.store;
  S5.settings.termStart = '2026-09-07';
  S5.settings.useCourses = true;
  eq('第 1 周', G.weekNoOf(new Date(2026, 8, 7, 9, 0)), 1);
  eq('第 2 周', G.weekNoOf(new Date(2026, 8, 14, 9, 0)), 2);
  eq('没填学期起点返回 null', (() => { S5.settings.termStart = ''; const v = G.weekNoOf(new Date(2026, 8, 7)); S5.settings.termStart = '2026-09-07'; return v; })(), null);

  S5.courses = [
    { id: 'c1', name: '数据结构', room: '教三204', weekday: 1, start: '08:00', end: '09:40', weeks: G.makeWeeks(1, 16, false, false) },
    { id: 'c2', name: '单周课', room: 'X101', weekday: 1, start: '10:00', end: '11:40', weeks: G.makeWeeks(1, 16, true, false) }
  ];
  const nx = G.nextClass(new Date(2026, 8, 7, 7, 0));
  ok('周一 07:00 找到 08:00 的课', nx && nx.course.name === '数据结构');
  eq('下一节是 8 点', nx && new Date(nx.ts).getHours(), 8);
  const nx2 = G.nextClass(new Date(2026, 8, 8, 7, 0));
  ok('周二能找到下周一的课', nx2 && nx2.course.name === '数据结构');
  ok('单周课在第 1 周出现', G.coursesOn(new Date(2026, 8, 7), 1).some((c) => c.name === '单周课'));
  ok('单周课在第 2 周消失', !G.coursesOn(new Date(2026, 8, 14), 2).some((c) => c.name === '单周课'));

  const blk = G.courseBlock({ weekday: '星期一' });
  ok('课表块含标题', blk.indexOf('【我的课表】') >= 0);
  ok('课表块含课程名', blk.indexOf('数据结构') >= 0);
  ok('课表块含未来几天', blk.indexOf('明天') >= 0);
  ok('课表块含教室', blk.indexOf('教三204') >= 0);
  const nxNow = G.nextClass(new Date());
  ok('有下一节时课表块会提到', !nxNow || blk.indexOf('下一节') >= 0);

  console.log('\n[16] 对话改课表（操作协议）');
  const S6 = G.store;
  S6.courses = [];

  const ex = G.extractOps('好的，已经改到教二108了。\n<op>{"action":"update","name":"数据结构","field":"room","value":"教二108"}</op>');
  eq('剥离标签后只剩文字', ex.clean, '好的，已经改到教二108了。');
  eq('解析出 1 个操作', ex.ops.length, 1);

  const ex2 = G.extractOps('<op>{坏 JSON}</op>正常文字');
  eq('坏 JSON 被忽略', ex2.ops.length, 0);
  ok('坏 JSON 不污染正文', ex2.clean.indexOf('正常文字') >= 0);

  const logsAdd = G.applyScheduleOps([
    { action: 'add', name: '体育', room: '操场', weekday: 3, start: '14:00', end: '15:40', weeks: '1-16' }
  ]);
  eq('新增返回 1 条日志', logsAdd.length, 1);
  eq('新增后课程数', S6.courses.length, 1);
  eq('新增星期', S6.courses[0].weekday, 3);
  eq('新增时间', S6.courses[0].start + '-' + S6.courses[0].end, '14:00-15:40');
  eq('新增周数', S6.courses[0].weeks.length, 16);

  const logsUpd = G.applyScheduleOps([{ action: 'update', name: '体育', field: 'room', value: '体育馆' }]);
  ok('改教室有日志', logsUpd.length === 1 && logsUpd[0].indexOf('体育馆') >= 0);
  eq('教室已改', S6.courses[0].room, '体育馆');

  G.applyScheduleOps([{ action: 'update', name: '体育', field: 'time', value: '16:00-17:40' }]);
  eq('改时间生效', S6.courses[0].start, '16:00');

  G.applyScheduleOps([{ action: 'update', name: '体育', field: 'weekday', value: '周五' }]);
  eq('改星期生效', S6.courses[0].weekday, 5);

  const logsDel = G.applyScheduleOps([{ action: 'delete', name: '体育' }]);
  eq('删除返回日志', logsDel.length, 1);
  eq('删除后课程数', S6.courses.length, 0);

  eq('周次解析：单周', G.parseWeeksSpec('单周').indexOf(2), -1);
  eq('周次解析：1-4', G.parseWeeksSpec('1-4').join(','), '1,2,3,4');
  eq('星期解析：周三', G.toWeekday('周三'), 3);

  console.log('\n[17] 对话录入课表');
  S6.courses = [
    { id: 'x', name: '高数', room: '教一101', weekday: 2, start: '10:00', end: '11:40', weeks: G.makeWeeks(1, 16, false, false) }
  ];
  const sp = G.buildSchedulePrompt();
  ok('含已有课程', sp.indexOf('高数') >= 0);
  ok('含提问顺序', sp.indexOf('【怎么问】') >= 0);
  ok('含操作协议', sp.indexOf('<op>') >= 0);
  ok('要求一次只问一个', sp.indexOf('一次只问一个问题') >= 0);
  ok('要求限制长度', sp.indexOf('不超过两行') >= 0);
  ok('录入模式也带当前时间', sp.indexOf('【现在】') >= 0);
  ok('录入模式带星期', /星期[一二三四五六日]/.test(sp));

  console.log('\n[18] 图片：缩放与拼装');
  const sz = G.imgTargetSize(4000, 3000, 1280);
  eq('横图长边缩到 1280', sz.w, 1280);
  eq('横图高按比例', sz.h, 960);
  const sz2 = G.imgTargetSize(500, 1000, 1280);
  ok('小图不放大', sz2.w === 500 && sz2.h === 1000);
  eq('尺寸为 0 时兜底', G.imgTargetSize(0, 0, 1280).w, 0);

  const cache = { a: 'data:a', b: 'data:b', c: 'data:c' };
  const msgs = [
    { role: 'user', content: '图1', img: { id: 'a' } },
    { role: 'assistant', content: '看到了' },
    { role: 'user', content: '图2', img: { id: 'b' } },
    { role: 'user', content: '图3', img: { id: 'c' } },
    { role: 'user', content: '最后一句' }
  ];
  const pl = G.composePayload(msgs, cache, 2);
  const withImg = pl.filter((m) => Array.isArray(m.content)).length;
  eq('只保留最近 2 张图', withImg, 2);
  ok('最新的图还在', Array.isArray(pl[3].content) && pl[3].content[1].image_url.url === 'data:c');
  ok('老图降级为文字', String(pl[0].content).indexOf('此前发送过一张图片') >= 0);
  eq('文字消息不受影响', pl[4].content, '最后一句');

  const recs = [
    { id: 'x', day: '2026-10-19', ts: 1 },
    { id: 'y', day: '2026-10-20', ts: 3 },
    { id: 'z', day: '2026-10-20', ts: 2 }
  ];
  const drop = G.pickImagesToDrop(recs, '2026-10-20', 30);
  eq('跨天的图要删', drop.length, 1);
  eq('删的是昨天那张', drop[0].id, 'x');
  const drop2 = G.pickImagesToDrop(recs, '2026-10-20', 1);
  ok('超上限的也删', drop2.length === 2 && drop2.some((r) => r.id === 'z'));

  console.log('\n' + (fail === 0 ? '全部通过：' + pass + ' 项' : '失败 ' + fail + ' / ' + (pass + fail)));
  if (fail) { console.log(bad.join('\n')); process.exit(1); }
}).catch((e) => { console.error(e); process.exit(1); });
