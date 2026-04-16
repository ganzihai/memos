/**
 * WeChat Article Relay for Cloudflare Pages (v3 - 精确清洗版)
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
    
    // 环境变量
    const EXPORTER_URL = env.EXPORTER_URL?.replace(/\/$/, "");
    const WP_URL = env.WP_URL?.replace(/\/$/, "");
    const WP_USER = env.WP_USER;
    const WP_PASS = env.WP_PASS; 
    const DB = env.DB;

    let title = "无标题";
    let finalContent = inputText;

    if (isWechatUrl) {
      if (!EXPORTER_URL) throw new Error("未配置 EXPORTER_URL");
      
      // 统一请求 HTML 格式
      const apiEndpoint = `${EXPORTER_URL}/api/public/v1/download?url=${encodeURIComponent(inputText)}&format=html`;

      console.log(`正在抓取并精确清洗: ${inputText}`);
      const fetchRes = await fetch(apiEndpoint);
      if (!fetchRes.ok) throw new Error(`抓取服务失败: ${fetchRes.status}`);
      
      const htmlRaw = await fetchRes.text();

      // --- 1. 提取标题 ---
      // 优先从 activity-name 提取，这是微信最准确的标题 ID
      const titleMatch = htmlRaw.match(/id="activity-name"[^>]*>([\s\S]*?)<\/h1>/i) || 
                         htmlRaw.match(/class="rich_media_title"[^>]*>([\s\S]*?)<\/h1>/i) ||
                         htmlRaw.match(/property="og:title"[^>]+content="([^"]*)"/i);
      
      if (titleMatch) {
        title = (titleMatch[1] || titleMatch[2]).replace(/<[^>]+>/g, "").trim();
      }
      title = title.replace(/[-_]微信公众号.*$/, "").trim();

      // --- 2. 提取正文 (js_content) ---
      // 微信的正文始终在 id="js_content" 的 div 中
      let bodyHtml = "";
      // 改进正则：匹配到 js_content div 的开头，并截取到文章末尾常见的标志位（如留言或脚本开始处）
      const contentStartIdx = htmlRaw.indexOf('id="js_content"');
      if (contentStartIdx !== -1) {
        // 找到该 div 标签闭合的位置
        const divStart = htmlRaw.lastIndexOf('<div', contentStartIdx);
        // 微信正文通常很长，且包含大量嵌套 div。
        // 这里采用保守策略：提取从 js_content 开始到第一个 script 标签或 inner 容器结束的部分
        const segment = htmlRaw.substring(divStart);
        const match = segment.match(/<div[^>]+id="js_content"[^>]*>([\s\S]*?)<\/div>\s*(?:<script|<!--|$)/i);
        if (match) {
          bodyHtml = match[1].trim();
        } else {
          // 如果正则失效，提取一段足够长的内容
          bodyHtml = segment.split('</div>')[0].trim();
        }
      } else {
        bodyHtml = htmlRaw;
      }

      // --- 3. 深度清洗 ---
      
      // A. 移除文章开头可能存在的空标签、空白 section、多余 br
      // 循环移除开头的 <section><br/></section> 等垃圾占位符
      bodyHtml = bodyHtml.replace(/^(\s*<(section|p|span|div)[^>]*>\s*(<br\/?>|&nbsp;|\s)*\s*<\/\2>)+/gi, "");
      // 移除开头零碎的 br
      bodyHtml = bodyHtml.replace(/^(\s*<br\/?>\s*)+/gi, "");

      // B. 处理图片 (wsrv.nl 代理)
      bodyHtml = bodyHtml.replace(/<(?:img|source)[^>]+(?:data-src|src)="([^">]+)"[^>]*>/g, (match, url) => {
        const cleanUrl = url.split("?")[0];
        const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(cleanUrl)}&output=webp`;
        return `<img src="${proxyUrl}" style="max-width:100%;height:auto;display:block;margin:10px auto;">`;
      });

      // C. 代码块清洗
      bodyHtml = bodyHtml.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (match, inner) => {
        let code = inner.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim();
        return `<pre class="wp-block-code"><code>${code}</code></pre>`;
      });

      // D. 彻底移除 script, style, iframe
      bodyHtml = bodyHtml.replace(/<(script|style|iframe)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi, "");

      if (target === "memos") {
        // Memos 模式：转为极致精简的 Markdown
        finalContent = bodyHtml
          .replace(/<p[^>]*>/gi, "\n")
          .replace(/<\/p>/gi, "")
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**")
          .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, "\n## $1\n")
          .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (m, c) => `\n> ${c.replace(/<[^>]+>/g, "").trim()}\n`)
          .replace(/<[^>]+>/g, "") // 移除所有剩余标签
          .replace(/\n{3,}/g, "\n\n") // 合并换行
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
