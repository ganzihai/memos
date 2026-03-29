// 初始化数据库端点
export async function onRequest(context) {
  const { env, request } = context;
  
  try {
    // 验证D1密钥
    const authHeader = request.headers.get('Authorization');
    const d1Password = env.D1PASSWORD;
    
    if (d1Password && (!authHeader || authHeader !== `Bearer ${d1Password}`)) {
      return new Response(JSON.stringify({
        success: false,
        message: '未授权访问'
      }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
      });
    }
    
    // 创建memos表
    await env.DB.exec(`
      CREATE TABLE IF NOT EXISTS memos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memo_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(memo_id, user_id)
      )
    `);

  // 创建user_settings表
    await env.DB.exec(`
      CREATE TABLE IF NOT EXISTS user_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL UNIQUE,
        pinned_memos TEXT DEFAULT '[]',
        theme_color TEXT DEFAULT '#969696',
        dark_mode INTEGER DEFAULT 0,
        hitokoto_config TEXT DEFAULT '{"enabled":true,"types":["a","b","c","d","i","j","k"]}',
        font_config TEXT DEFAULT '{"selectedFont":"default"}',
  background_config TEXT DEFAULT '{"imageUrl":"","brightness":50,"blur":10,"useRandom":false}',
    avatar_config TEXT DEFAULT '{"imageUrl":""}',
  canvas_config TEXT DEFAULT NULL,
  music_config TEXT DEFAULT '{"enabled":true,"customSongs":[]}',
  s3_config TEXT DEFAULT '{"enabled":false,"endpoint":"","accessKeyId":"","secretAccessKey":"","bucket":"","region":"auto","publicUrl":"","provider":"r2"}',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建索引
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_memos_user_id ON memos(user_id)');
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_memos_created_at ON memos(created_at)');
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id)');

    return new Response(JSON.stringify({
      success: true,
      message: '数据库初始化成功'
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    });
  } catch (error) {
    console.error('数据库初始化失败:', error);
    return new Response(JSON.stringify({
      success: false,
      message: '数据库初始化失败',
      error: error.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    });
  }
}