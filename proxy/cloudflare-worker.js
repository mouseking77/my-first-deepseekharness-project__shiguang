/**
 * 时光 · 跨域中转（Cloudflare Worker）
 *
 * 什么时候需要它：
 *   浏览器直连 api.deepseek.com 被 CORS 拦下（设置里「测试连接」报连不上/跨域）时，
 *   把这个 Worker 部署到 Cloudflare，然后把它的地址填进 App 的「自定义接口地址」。
 *
 * 部署（免费，约 3 分钟）：
 *   1. 打开 https://dash.cloudflare.com/ → Workers & Pages → Create → Worker
 *   2. 把这份文件的内容整段贴进去，Deploy
 *   3. 记下地址，例如 https://shiguang.你的名字.workers.dev
 *   4. App 设置 → 自定义接口地址 → 填这个地址（不用加 /chat/completions）
 *
 * 想让 Key 完全不进手机：
 *   Worker → Settings → Variables → 添加 Secret：DEEPSEEK_API_KEY = sk-...
 *   这样手机端可以不填 Key，请求由 Worker 补上。
 */

const UPSTREAM = 'https://api.deepseek.com/chat/completions';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Max-Age': '86400'
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    if (request.method === 'GET') {
      return new Response('时光代理已就绪。把本地址填进 App 的「自定义接口地址」即可。', {
        headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS });
    }

    if (!/\/chat\/completions$/.test(url.pathname)) {
      return new Response('Not Found', { status: 404, headers: CORS });
    }

    // 优先用 Worker 里配置的 Key；没配就用手机传来的
    const auth = request.headers.get('authorization') || '';
    const key = (env && env.DEEPSEEK_API_KEY) || auth.replace(/^Bearer\s+/i, '');
    if (!key) {
      return new Response(JSON.stringify({ error: { message: '没有 API Key：请在 Worker 里配置 DEEPSEEK_API_KEY，或在 App 里填写。' } }), {
        status: 401,
        headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }

    const body = await request.text();

    let upstream;
    try {
      upstream = await fetch(UPSTREAM, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          Accept: 'text/event-stream'
        },
        body
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: { message: '上游请求失败：' + err.message } }), {
        status: 502,
        headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }

    // 流式响应原样转发
    const headers = new Headers(CORS);
    headers.set('Content-Type', upstream.headers.get('content-type') || 'text/event-stream');
    headers.set('Cache-Control', 'no-cache, no-transform');
    headers.set('X-Accel-Buffering', 'no');

    return new Response(upstream.body, { status: upstream.status, headers });
  }
};
