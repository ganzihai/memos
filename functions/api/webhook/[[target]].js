/**
 * WeChat Article Relay for Cloudflare Pages (v6 - Memos Markdown 极致优化版)
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

      const apiEndpoint =
        `${EXPORTER_URL}/api/public/v1/download?url=${encodeURIComponent(inputText)}&format=html`;

      console.log(`正在抓取并清洗数据: ${inputText}`);
      const fetchRes = await fetch(apiEndpoint);
      if (!fetchRes.ok) throw new Error(`抓取服务失败: ${fetchRes.status}`);

      const htmlRaw = await fetchRes.text();

      // --- 1. 提取标题 ---
      const titleMatch =
        htmlRaw.match(/id="activity-name"[^>]*>([\s\S]*?)<\/h1>/i) ||
        htmlRaw.match(/class="rich_media_title"[^>]*>([\s\S]*?)<\/h1>/i) ||
        htmlRaw.match(/property="og:title"[^>]+content="([^"]*)"/i) ||
        htmlRaw.match(/<title>(.*?)<\/title>/i);

      if (titleMatch) {
        title = (titleMatch[1] || titleMatch[2]).replace(/<[^>]+>/g, "").trim();
      }
      title = title.replace(/[-_]微信公众号.*$/, "").trim();

      // --- 2. 更加鲁棒的正文提取 (定位 js_content) ---
      let bodyHtml = "";
      const contentStartMatch = htmlRaw.match(/<div[^>]+id="js_content"[^>]*>/i);
      if (contentStartMatch) {
        const startIdx = contentStartMatch.index + contentStartMatch[0].length;
        // 寻找正文结束点：通常是下一个脚本标签、底部广告位或点赞分享区
        const contentEndMatch = htmlRaw.slice(startIdx).match(/<(?:script|div[^>]+id="js_bottom_ad_area"|div[^>]+id="js_to_share")/i);
        if (contentEndMatch) {
          bodyHtml = htmlRaw.slice(startIdx, startIdx + contentEndMatch.index).trim();
        } else {
          // 兜底：寻找最后一个主要的 </div>
          const lastDivIdx = htmlRaw.lastIndexOf("</div>");
          bodyHtml = htmlRaw.slice(startIdx, lastDivIdx).trim();
        }
        // 移除可能残留在末尾的闭合标签
        bodyHtml = bodyHtml.replace(/<\/div>\s*$/i, "");
      } else {
        bodyHtml = htmlRaw;
      }

      // --- 3. 深度清洗 ---

      // A. 移除微信垃圾组件 (公众号关注卡片、视频号卡片等)
      bodyHtml = bodyHtml.replace(/<(mp-common-profile|mp-common-share-card|mp-common-videosnap)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi, "");
      bodyHtml = bodyHtml.replace(/<section[^>]+class="mp_profile_iframe_wrp"[^>]*>[\s\S]*?<\/section>/gi, "");

      // B. 处理图片 (优先使用 data-src，解决 wsrv.nl 代理)
      bodyHtml = bodyHtml.replace(/<(?:img|source)[^>]+>/g, (tag) => {
        const urlMatch = tag.match(/data-src="([^">]+)"/i) || tag.match(/src="([^">]+)"/i);
        if (urlMatch) {
          const url = urlMatch[1];
          const cleanUrl = url.split("?")[0];
          const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(cleanUrl)}&output=webp`;
          return `<img src="${proxyUrl}" style="max-width:100%;height:auto;display:block;margin:10px auto;">`;
        }
        return "";
      });

      // C. 代码块清洗
      bodyHtml = bodyHtml.replace(/<pre([^>]*)>([\s\S]*?)<\/pre>/gi, (match, attrs, inner) => {
        let lang = "plaintext";
        const langMatch = attrs.match(/data-language="([\w-]+)"/i) || attrs.match(/language-([\w-]+)/i) || inner.match(/language-([\w-]+)/i);
        if (langMatch) lang = langMatch[1];

        let cleanCode = inner
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<[^>]+>/g, "")
          .replace(/&nbsp;|\xa0/g, " ")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .trim();

        const escapedCode = cleanCode
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");

        return `<pre class="wp-block-code"><code class="${lang} language-${lang}">${escapedCode}</code></pre>`;
      });

      // D. 彻底移除 script/style/iframe
      bodyHtml = bodyHtml.replace(/<(script|style|iframe)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi, "");

      // E. 移除开头多余的空行和空标签 (增强版)
      bodyHtml = bodyHtml.replace(/^(\s*<(section|p|span|div)[^>]*>\s*(<br\/?>|&nbsp;|\s)*\s*<\/\2>|\s*<br\/?>\s*)+/gi, "");

      if (target === "memos") {
        // --- Memos 专用 Markdown 转换 (修正代码块显示) ---
        finalContent = bodyHtml
          .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, "\n### $1\n")
          .replace(/<p[^>]*>/gi, "\n")
          .replace(/<\/p>/gi, "")
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**")
          // 极致还原代码块：提取 lang 和 内部文本，取消转义
          .replace(/<pre[^>]*><code class="([\w-]+) language-[\w-]+">([\s\S]*?)<\/code><\/pre>/gi, (m, l, c) => {
            const rawCode = c
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"')
              .replace(/&#039;/g, "'")
              .replace(/&amp;/g, "&");
            const langLabel = l === "plaintext" ? "" : l;
            return `\n\`\`\`${langLabel}\n${rawCode}\n\`\`\`\n`;
          })
          .replace(/<img [^>]*src="([^"]+)"[^>]*>/gi, "\n![]($1)\n")
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
