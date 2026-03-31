// 处理用户设置相关的请求
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method;
  
  // 设置CORS头
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  
  // 处理OPTIONS请求（预检请求）
  if (method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    if (method === 'GET') {
      // 获取用户设置（不区分用户）
  const settings = await env.DB
        .prepare('SELECT * FROM user_settings LIMIT 1')
        .first();
      
      return new Response(JSON.stringify({ success: true, data: settings }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } else if (method === 'POST') {
      // 创建或更新用户设置
      const body = await request.json();
      
      // 检查用户设置是否已存在，支持局部更新 (PATCH 模式)
      const existingSettings = await env.DB
        .prepare('SELECT * FROM user_settings LIMIT 1')
        .first();
        
      const current = existingSettings || {};
      
      const pinned_memos = body.pinned_memos !== undefined ? JSON.stringify(body.pinned_memos) : current.pinned_memos || '[]';
      const theme_color = body.theme_color !== undefined ? body.theme_color : current.theme_color || '#969696';
      const dark_mode = body.dark_mode !== undefined ? (body.dark_mode ? 1 : 0) : current.dark_mode || 0;
      const hitokoto_config = body.hitokoto_config !== undefined ? JSON.stringify(body.hitokoto_config) : current.hitokoto_config || '{"enabled":true,"types":["a","b","c","d","i","j","k"]}';
      const font_config = body.font_config !== undefined ? JSON.stringify(body.font_config) : current.font_config || '{"selectedFont":"default"}';
      const background_config = body.background_config !== undefined ? JSON.stringify(body.background_config) : current.background_config || '{"imageUrl":"","brightness":50,"blur":10,"useRandom":false}';
      const avatar_config = body.avatar_config !== undefined ? JSON.stringify(body.avatar_config) : current.avatar_config || '{"imageUrl":""}';
      const canvas_config = body.canvas_config !== undefined ? (body.canvas_config ? JSON.stringify(body.canvas_config) : null) : current.canvas_config;
      const music_config = body.music_config !== undefined ? JSON.stringify(body.music_config) : current.music_config || '{"enabled":true,"customSongs":[]}';
      const s3_config = body.s3_config !== undefined ? JSON.stringify(body.s3_config) : current.s3_config || '{"enabled":false,"endpoint":"","accessKeyId":"","secretAccessKey":"","bucket":"","region":"auto","publicUrl":"","provider":"r2"}';
      const updated_at = body.updated_at || new Date().toISOString();
      
      if (existingSettings) {
        // 更新现有设置
        await env.DB
          .prepare('UPDATE user_settings SET pinned_memos = ?, theme_color = ?, dark_mode = ?, hitokoto_config = ?, font_config = ?, background_config = ?, avatar_config = ?, canvas_config = ?, music_config = ?, s3_config = ?, updated_at = ?')
          .bind(
            pinned_memos,
            theme_color,
            dark_mode,
            hitokoto_config,
            font_config,
            background_config,
            avatar_config,
            canvas_config,
            music_config,
            s3_config,
            updated_at
          )
          .run();
      } else {
        // 插入新设置
        await env.DB
          .prepare('INSERT INTO user_settings (pinned_memos, theme_color, dark_mode, hitokoto_config, font_config, background_config, avatar_config, canvas_config, music_config, s3_config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(
            pinned_memos,
            theme_color,
            dark_mode,
            hitokoto_config,
            font_config,
            background_config,
            avatar_config,
            canvas_config,
            music_config,
            s3_config,
            new Date().toISOString(),
            updated_at
          )
          .run();
      }
      
      return new Response(JSON.stringify({ success: true, message: '用户设置保存成功' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } else {
      return new Response(JSON.stringify({ error: '不支持的请求方法' }), {
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