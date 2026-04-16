/**
 * WeChat Article Relay for Cloudflare Pages (v4 - 代码块与清洗增强版)
 * 适配路径: /api/webhook/wp 或 /api/webhook/memos
 */

export async function onRequest(context) {
  const { request, env, params } = context;

  // 1. 获取路径中的 target (wp 或 memos)
  const target = (Array.isArray(params.target) ? params.target[0] : (params.target || "wp")).toLowerCase();

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

    if (!inputText) throw new Error("未检测到有效内容");

    const isWechatUrl = inputText.startsWith("http") && inputText.includes("mp.weixin.qq.com");

    const EXPORTER_URL = env.EXPORTER_URL?.replace(/\/$/, "");
    const WP_URL = env.WP_URL?.replace(/\/$/, "");
    const WP_USER = env.WP_USER;
    const WP_PASS = env.WP_PASS;
    const DB = env.DB;

    let title = "无标题";
    let finalContent = inputText;

    if (isWechatUrl) {
      if (!EXPORTER_URL) throw new Error("未配置 EXPORTER_URL 环境变量");

      // 强制抓取 HTML 以便进行深度清洗和标题提取
      const apiEndpoint =
        `${EXPORTER_URL}/api/public/v1/download?url=${encodeURIComponent(inputText)}&format=html`;

      console.log(`正在抓取并清洗数据: ${inputText}`);
      const fetchRes = await fetch(apiEndpoint);
      if (!fetchRes.ok) throw new Error(`抓取服务失败: ${fetchRes.status}`);

      const htmlRaw = await fetchRes.text();

      // --- 1. 提取标题 (参考 main.py 逻辑) ---
      const titleMatch =
        htmlRaw.match(/id="activity-name"[^>]*>([\s\S]*?)<\/h1>/i) ||
        htmlRaw.match(/class="rich_media_title"[^>]*>([\s\S]*?)<\/h1>/i) ||
        htmlRaw.match(/property="og:title"[^>]+content="([^"]*)"/i) ||
        htmlRaw.match(/<title>(.*?)<\/title>/i);

      if (titleMatch) {
        title = (titleMatch[1] || titleMatch[2]).replace(/<[^>]+>/g, "").trim();
      }
      title = title.replace(/[-_]微信公众号.*$/, "").trim();

      // --- 2. 提取正文 (js_content) ---
      let bodyHtml = "";
      const contentMatch =
        htmlRaw.match(/<div[^>]+id="js_content"[^>]*>([\s\S]*?)<\/div>\s*(?:<script|<!--|$)/i);
      if (contentMatch) {
        bodyHtml = contentMatch[1].trim();
      } else {
        bodyHtml = htmlRaw;
      }

      // --- 3. 深度清洗 ---

      // A. 移除开头空标签、空白 section、多余 br (解决多余空行问题)
      bodyHtml = bodyHtml.replace(/^(\s*<(section|p|span|div)[^>]*>\s*(<br\/?>|&nbsp;|\s)*\s*<\/\2>)+/gi, "");
      bodyHtml = bodyHtml.replace(/^(\s*<br\/?>\s*)+/gi, "");

      // B. 处理图片 (wsrv.nl 代理)
      bodyHtml = bodyHtml.replace(/<(?:img|source)[^>]+(?:data-src|src)="([^">]+)"[^>]*>/g, (match, url) => {
        const cleanUrl = url.split("?")[0];
        const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(cleanUrl)}&output=webp`;
        return `<img src="${proxyUrl}" style="max-width:100%;height:auto;display:block;margin:10px auto;">`;
      });

      // C. 代码块清洗 (参考 main.py 逻辑)
      bodyHtml = bodyHtml.replace(/<pre([^>]*)>([\s\S]*?)<\/pre>/gi, (match, attrs, inner) => {
        // 尝试提取编程语言
        let lang = "plaintext";
        const langMatch = attrs.match(/language-([\w-]+)/i) || inner.match(/language-([\w-]+)/i);
        if (langMatch) lang = langMatch[1];

        // 清洗内容：将 <br> 换回 \n，移除内部多余 HTML 标签，处理非断行空格
        let cleanCode = inner
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<[^>]+>/g, "")
          .replace(/\xa0/g, " ")
          .trim();

        // 关键：HTML 转义保护，确保代码中的 < > & 等符号能原样显示 (针对 WP)
        const escapedCode = cleanCode
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");

        return `<pre class="wp-block-code"><code class="${lang} language-${lang}">${escapedCode}</code></pre>`;
      });

      // D. 彻底移除无用标签
      bodyHtml = bodyHtml.replace(/<(script|style|iframe)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi, "");

      if (target === "memos") {
        // Memos 模式：转换为极致精简的 Markdown
        finalContent = bodyHtml
          .replace(/<p[^>]*>/gi, "\n")
          .replace(/<\/p>/gi, "")
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**")
          .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, "\n## $1\n")
          // 还原代码块为 Markdown 语法
          .replace(/<pre class="wp-block-code"><code class="([\w-]+) language-[\w-]+">([\s\S]*?)<\/code><\/pre>/gi, (m, l, c) => {
            const unescaped = c.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, "&");
            return `\n\`\`\`${l}\n${unescaped}\n\`\`\`\n`;
          })
          .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (m, c) => `\n> ${c.replace(/<[^>]+>/g, "").trim()}\n`)
          .replace(/<[^>]+>/g, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      } else {
        finalContent = bodyHtml;
      }
    }

    // --- 4. 分发推送 ---
    if (target === "memos") {
      if (!DB) throw new Error("未绑定 D1 数据库");
      const memoId = "wc_" + Date.now().toString();
      const now = new Date().toISOString();
      const memosBody = title !== "无标题" ? `# ${title}\n\n${finalContent}` : finalContent;

      await DB.prepare(
        `INSERT INTO memos (memo_id, content, tags, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(memoId, memosBody, JSON.stringify(["微信采集"]), 0, now, now).run();

      return new Response(JSON.stringify({ success: true, target: "memos", id: memoId, title }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } else {
      if (!WP_URL || !WP_PASS) throw new Error("未配置 WordPress 环境");

      const wpAuth = btoa(`${WP_USER}:${WP_PASS}`);
      const wpResp = await fetch(`${WP_URL}/wp-json/wp/v2/posts`, {
        method: "POST",
        headers: { "Authorization": `Basic ${wpAuth}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title,
          content: finalContent,
          status: "publish",
          categories: [47]
        })
      });

      const wpData = await wpResp.json();
      if (!wpResp.ok) throw new Error(`WP错误: ${wpData.message}`);

      return new Response(JSON.stringify({ success: true, target: "wp", id: wpData.id, title }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}
