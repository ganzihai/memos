/**
 * WeChat Article Relay for Cloudflare Pages (v2 - 深度清洗版)
 * 路径: /api/webhook/wp 或 /api/webhook/memos
 */

export async function onRequest(context) {
  const { request, env, params } = context;
  
  // 1. 获取路径中的 target (wp 或 memos)
  // Cloudflare Pages Functions 中 params.target 通常是一个数组
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

    if (!inputText) {
      throw new Error("未检测到有效内容");
    }

    const isWechatUrl = inputText.startsWith("http") && inputText.includes("mp.weixin.qq.com");
    
    // 环境变量配置
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
      const apiEndpoint = `${EXPORTER_URL}/api/public/v1/download?url=${encodeURIComponent(inputText)}&format=html`;

      console.log(`正在抓取数据并清洗: ${inputText}`);
      const fetchRes = await fetch(apiEndpoint);
      if (!fetchRes.ok) throw new Error(`抓取服务响应异常: ${fetchRes.status}`);
      
      const htmlRaw = await fetchRes.text();

      // --- 1. 提取标题 (参考 main.py 逻辑) ---
      const titleMatch = 
        htmlRaw.match(/<h1[^>]+id="activity-name"[^>]*>([\s\S]*?)<\/h1>/i) || 
        htmlRaw.match(/<h1[^>]+class="[^"]*rich_media_title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) ||
        htmlRaw.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i) ||
        htmlRaw.match(/<title>(.*?)<\/title>/i);
      
      if (titleMatch) {
        // titleMatch[1] 是 h1 内容，titleMatch[2] 是 meta content
        title = (titleMatch[1] || titleMatch[2] || "微信文章").replace(/<[^>]+>/g, "").trim();
      }
      title = title.replace(/[-_]微信公众号.*$/, "").trim();

      // --- 2. 提取正文 (解决开头空行问题的关键) ---
      // 仅提取 js_content 内部内容，跳过采集器附带的冗余 HTML/CSS
      let bodyHtml = "";
      const contentMatch = htmlRaw.match(/<div[^>]+id="js_content"[^>]*>([\s\S]*?)<\/div>\s*(?:<script|$)/i);
      if (contentMatch) {
        bodyHtml = contentMatch[1].trim();
      } else {
        bodyHtml = htmlRaw; // 兜底
      }

      // --- 3. 深度清洗 HTML ---
      
      // A. 处理图片反盗链 (wsrv.nl)
      bodyHtml = bodyHtml.replace(/<img[^>]+(?:data-src|src)="([^">]+)"[^>]*>/g, (match, url) => {
        const cleanUrl = url.split("?")[0];
        return `<img src="https://wsrv.nl/?url=${encodeURIComponent(cleanUrl)}&output=webp" style="max-width:100%;height:auto;">`;
      });

      // B. 处理代码块 (参考 main.py: 将 <br/> 转换为 \n，并包装为 WP 标准格式)
      bodyHtml = bodyHtml.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (match, codeInner) => {
        let cleanCode = codeInner.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim();
        const langMatch = match.match(/language-([\w-]+)/);
        const lang = langMatch ? langMatch[1] : "plaintext";
        return `<pre class="wp-block-code"><code class="${lang} language-${lang}">${cleanCode}</code></pre>`;
      });

      // C. 移除脚本、样式等干扰标签
      bodyHtml = bodyHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
      bodyHtml = bodyHtml.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
      bodyHtml = bodyHtml.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "");

      if (target === "memos") {
        // 简易 HTML 转 Markdown 用于 Memos (因为 Memos 不支持直接渲染 HTML)
        finalContent = bodyHtml
          .replace(/<p[^>]*>/gi, "\n")
          .replace(/<\/p>/gi, "")
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**")
          .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, "\n## $1\n")
          .replace(/<[^>]+>/g, "") // 移除剩余 HTML 标签
          .replace(/\n{3,}/g, "\n\n") // 合并过多换行
          .trim();
      } else {
        finalContent = bodyHtml;
      }
    }

    // --- 分发推送 ---
    if (target === "memos") {
      if (!DB) throw new Error("未绑定 D1 数据库");
      
      const memoId = "wc_" + Date.now().toString();
      const now = new Date().toISOString();
      const memosBody = title !== "无标题" ? `# ${title}\n\n${finalContent}` : finalContent;

      await DB.prepare(
        `INSERT INTO memos (memo_id, content, tags, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        memoId, memosBody, JSON.stringify(["微信采集"]), 0, now, now
      ).run();

      return new Response(JSON.stringify({ success: true, target: "memos", id: memoId, title }), {
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

      return new Response(JSON.stringify({ success: true, target: "wp", id: wpData.id, link: wpData.link, title }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    } else {
      throw new Error(`不支持的目标: ${target}`);
    }

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}
