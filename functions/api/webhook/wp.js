/**
 * WeChat Article Relay for Cloudflare Pages (RESTful Style)
 * 路径: /api/webhook/wp 或 /api/webhook/memos
 */

export async function onRequest(context) {
  const { request, env, params } = context;

  // 1. 获取路径中的 target (wp 或 memos)
  const target = params.target ? params.target[0].toLowerCase() : "wp";

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await request.json();
    const inputText = (body.url || body.text || body.content || "").trim();

    if (!inputText) {
      throw new Error("未检测到有效内容");
    }

    // 判断是否为 URL，如果是则调用抓取服务，否则视为纯文本
    const isUrl = inputText.startsWith("http");

    // 环境变量配置
    const EXPORTER_URL = env.EXPORTER_URL?.replace(/\/$/, "");
    const WP_URL = env.WP_URL?.replace(/\/$/, "");
    const WP_USER = env.WP_USER;
    const WP_PASS = env.WP_PASS;
    const DB = env.DB;

    let title = "无标题";
    let finalContent = inputText;

    if (isUrl && inputText.includes("mp.weixin.qq.com")) {
      if (!EXPORTER_URL) throw new Error("未配置 EXPORTER_URL");

      const format = (target === "memos") ? "markdown" : "html";
      const apiEndpoint =
        `${EXPORTER_URL}/api/public/v1/download?url=${encodeURIComponent(inputText)}&format=${format}`;

      console.log(`正在抓取 ${format}: ${inputText}`);
      const fetchRes = await fetch(apiEndpoint);
      if (!fetchRes.ok) throw new Error(`抓取失败: ${fetchRes.status}`);

      let rawContent = await fetchRes.text();

      // 提取标题
      const titleMatch = rawContent.match(/<h1[^>]*>(.*?)<\/h1>/) || rawContent.match(/<title>(.*?)<\/title>/);
      title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "微信文章";
      title = title.replace(/[-_]微信公众号.*$/, "").trim();

      // 图片反盗链与优化处理
      const processImages = (text, isMd) => {
        if (isMd) {
          return text.replace(/!\[(.*?)\]\((http[s]?:\/\/mmbiz\.qpic\.cn\/[^)]+)\)/g,
        '![$1](https://wsrv.nl/?url=$2&output=webp)');
        } else {
          let html = text.replace(/data-src="([^"]+)"/g, 'src="https://wsrv.nl/?url=$1&output=webp"');
          html = html.replace(/src="http:\/\/mmbiz/g, 'src="https://wsrv.nl/?url=http://mmbiz');
          // 清理掉可能干扰 WP 的脚本和样式
          html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
          html = html.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
          return html;
        }
      };

      finalContent = processImages(rawContent, target === "memos");
    }

    // --- 根据路径分发推送 ---
    if (target === "memos") {
      if (!DB) throw new Error("未绑定 D1 数据库");

      const memoId = "wc_" + Date.now().toString() + Math.random().toString(36).substring(2, 5);
      const now = new Date().toISOString();
      const memosBody = title !== "无标题" ? `# ${title}\n\n${finalContent}` : finalContent;

      await DB.prepare(
        `INSERT INTO memos (memo_id, content, tags, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        memoId, memosBody, JSON.stringify(["微信采集", "自动推送"]), 0, now, now
      ).run();

      return new Response(JSON.stringify({ success: true, target: "memos", id: memoId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } else if (target === "wp") {
      if (!WP_URL || !WP_PASS) throw new Error("未配置 WordPress 环境变量");

      const wpAuth = btoa(`${WP_USER}:${WP_PASS}`);
      const wpResp = await fetch(`${WP_URL}/wp-json/wp/v2/posts`, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${wpAuth}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: title,
          content: finalContent,
          status: "publish",
          categories: [47]
        })
      });

      const wpData = await wpResp.json();
      if (!wpResp.ok) throw new Error(`WordPress 错误: ${wpData.message}`);

      return new Response(JSON.stringify({ success: true, target: "wp", id: wpData.id, link: wpData.link }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } else {
      throw new Error(`不支持的推送目标: ${target}`);
    }

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}
