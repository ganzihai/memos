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
  const { pinned_memos, theme_color, dark_mode, hitokoto_config, font_config, background_config, avatar_config, canvas_config, music_config, s3_config, updated_at } = body;
      
      // 检查用户设置是否已存在
      const existingSettings = await env.DB
        .prepare('SELECT * FROM user_settings LIMIT 1')
        .first();
      
      if (existingSettings) {
        // 更新现有设置
        await env.DB
          .prepare('UPDATE user_settings SET pinned_memos = ?, theme_color = ?, dark_mode = ?, hitokoto_config = ?, font_config = ?, background_config = ?, avatar_config = ?, canvas_config = ?, music_config = ?, s3_config = ?, updated_at = ?')
          .bind(
            JSON.stringify(pinned_memos || []),
            theme_color || '#969696',
            dark_mode ? 1 : 0,
            JSON.stringify(hitokoto_config || { enabled: true, types: ["a", "b", "c", "d", "i", "j", "k"] }),
            JSON.stringify(font_config || { selectedFont: "default" }),
            JSON.stringify(background_config || { imageUrl: "", brightness: 50, blur: 10, useRandom: false }),
            JSON.stringify(avatar_config || { imageUrl: "" }),
            canvas_config ? JSON.stringify(canvas_config) : null,
            JSON.stringify(music_config || { enabled: true, customSongs: [] }),
            JSON.stringify(s3_config || { enabled: false, endpoint: '', accessKeyId: '', secretAccessKey: '', bucket: '', region: 'auto', publicUrl: '', provider: 'r2' }),
            updated_at || new Date().toISOString()
          )
          .run();
      } else {
        // 插入新设置
        await env.DB
          .prepare('INSERT INTO user_settings (pinned_memos, theme_color, dark_mode, hitokoto_config, font_config, background_config, avatar_config, canvas_config, music_config, s3_config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(
            JSON.stringify(pinned_memos || []),
            theme_color || '#969696',
            dark_mode ? 1 : 0,
            JSON.stringify(hitokoto_config || { enabled: true, types: ["a", "b", "c", "d", "i", "j", "k"] }),
            JSON.stringify(font_config || { selectedFont: "default" }),
            JSON.stringify(background_config || { imageUrl: "", brightness: 50, blur: 10, useRandom: false }),
            JSON.stringify(avatar_config || { imageUrl: "" }),
            canvas_config ? JSON.stringify(canvas_config) : null,
            JSON.stringify(music_config || { enabled: true, customSongs: [] }),
            JSON.stringify(s3_config || { enabled: false, endpoint: '', accessKeyId: '', secretAccessKey: '', bucket: '', region: 'auto', publicUrl: '', provider: 'r2' }),
            new Date().toISOString(),
            updated_at || new Date().toISOString()
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