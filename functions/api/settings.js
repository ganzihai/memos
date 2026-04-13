// 处理用户设置相关的请求
export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // 1. 鉴权校验
  const password = env.PASSWORD;
  if (password && password.trim()) {
    const authHeader = request.headers.get('Authorization');
    const providedPassword = authHeader ? (authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader) : null;
    
    if (providedPassword !== password.trim()) {
      return new Response(JSON.stringify({ success: false, message: '未授权访问' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  try {
    if (method === 'GET') {
      const settings = await env.DB
        .prepare('SELECT * FROM user_settings LIMIT 1')
        .first();

      return new Response(JSON.stringify({ success: true, data: settings }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } else if (method === 'POST') {
      // 全量写入或合并写入用户设置
      const body = await request.json();

      const existingSettings = await env.DB
        .prepare('SELECT * FROM user_settings LIMIT 1')
        .first();

      const cur = existingSettings || {};

      const pinned_memos     = body.pinned_memos     !== undefined ? JSON.stringify(body.pinned_memos)     : (cur.pinned_memos     || '[]');
      const theme_color      = body.theme_color      !== undefined ? body.theme_color                      : (cur.theme_color      || '#969696');
      const dark_mode        = body.dark_mode        !== undefined ? (body.dark_mode ? 1 : 0)              : (cur.dark_mode        || 0);
      const hitokoto_config  = body.hitokoto_config  !== undefined ? JSON.stringify(body.hitokoto_config)  : (cur.hitokoto_config  || '{"enabled":true,"types":["a","b","c","d","i","j","k"]}');
      const font_config      = body.font_config      !== undefined ? JSON.stringify(body.font_config)      : (cur.font_config      || '{"selectedFont":"default"}');
      const background_config= body.background_config!== undefined ? JSON.stringify(body.background_config): (cur.background_config|| '{"imageUrl":"","brightness":50,"blur":10,"useRandom":false}');
      const avatar_config    = body.avatar_config    !== undefined ? JSON.stringify(body.avatar_config)    : (cur.avatar_config    || '{"imageUrl":""}');
      const canvas_config    = body.canvas_config    !== undefined ? (body.canvas_config ? JSON.stringify(body.canvas_config) : null) : cur.canvas_config;
      const music_config     = body.music_config     !== undefined ? JSON.stringify(body.music_config)     : (cur.music_config     || '{"enabled":true,"customSongs":[]}');
      const s3_config        = body.s3_config        !== undefined ? JSON.stringify(body.s3_config)        : (cur.s3_config        || '{"enabled":false,"endpoint":"","accessKeyId":"","secretAccessKey":"","bucket":"","region":"auto","publicUrl":"","provider":"r2"}');
      const updated_at       = body.updated_at || new Date().toISOString();

      if (existingSettings) {
        await env.DB
          .prepare(`UPDATE user_settings
             SET pinned_memos=?, theme_color=?, dark_mode=?, hitokoto_config=?,
                 font_config=?, background_config=?, avatar_config=?, canvas_config=?,
                 music_config=?, s3_config=?, updated_at=?`)
          .bind(pinned_memos, theme_color, dark_mode, hitokoto_config,
                font_config, background_config, avatar_config, canvas_config,
                music_config, s3_config, updated_at)
          .run();
      } else {
        await env.DB
          .prepare(`INSERT INTO user_settings
             (pinned_memos, theme_color, dark_mode, hitokoto_config, font_config,
              background_config, avatar_config, canvas_config, music_config, s3_config,
              created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(pinned_memos, theme_color, dark_mode, hitokoto_config,
                font_config, background_config, avatar_config, canvas_config,
                music_config, s3_config, new Date().toISOString(), updated_at)
          .run();
      }

      return new Response(JSON.stringify({ success: true, message: '用户设置保存成功' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } else if (method === 'PATCH') {
      // 轻量级局部更新：只更新 pinned_memos（置顶 ID 列表）
      // 请求体: { pinned_ids: string[] }
      const body = await request.json();

      if (!('pinned_ids' in body)) {
        return new Response(JSON.stringify({ success: false, error: '缺少 pinned_ids 字段' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const pinnedJson = JSON.stringify(body.pinned_ids || []);
      const now = new Date().toISOString();

      const existing = await env.DB
        .prepare('SELECT id FROM user_settings LIMIT 1')
        .first();

      if (existing) {
        await env.DB
          .prepare('UPDATE user_settings SET pinned_memos = ?, updated_at = ?')
          .bind(pinnedJson, now)
          .run();
      } else {
        await env.DB
          .prepare(`INSERT INTO user_settings (pinned_memos, created_at, updated_at) VALUES (?,?,?)`)
          .bind(pinnedJson, now, now)
          .run();
      }

      return new Response(JSON.stringify({ success: true, message: '置顶状态更新成功' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } else {
      return new Response(JSON.stringify({ success: false, error: '不支持的请求方法' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    console.error('处理用户设置请求失败:', error);
    return new Response(JSON.stringify({
      success: false,
      message: '处理用户设置请求失败',
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
