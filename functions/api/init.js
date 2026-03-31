// 初始化/迁移数据库端点
export async function onRequest(context) {
  const { env, request } = context;

  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = request.headers.get('Authorization');
    const d1Password = env.D1PASSWORD;

    if (d1Password && (!authHeader || authHeader !== `Bearer ${d1Password}`)) {
      return new Response(JSON.stringify({ success: false, message: '未授权访问' }), {
        status: 401, headers: corsHeaders
      });
    }

    // 1. 创建 memos 表（含新字段）
    await env.DB.exec(`
      CREATE TABLE IF NOT EXISTS memos (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        memo_id     TEXT    NOT NULL UNIQUE,
        content     TEXT    NOT NULL,
        tags        TEXT    DEFAULT '[]',
        backlinks   TEXT    DEFAULT '[]',
        audio_clips TEXT    DEFAULT '[]',
        is_public   INTEGER DEFAULT 0,
        is_pinned   INTEGER DEFAULT 0,
        pinned_at   TEXT,
        created_at  TEXT    NOT NULL,
        updated_at  TEXT    NOT NULL
      )
    `);

    // 2. 创建 user_settings 表
    await env.DB.exec(`
      CREATE TABLE IF NOT EXISTS user_settings (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        pinned_memos      TEXT    DEFAULT '[]',
        theme_color       TEXT    DEFAULT '#969696',
        dark_mode         INTEGER DEFAULT 0,
        hitokoto_config   TEXT    DEFAULT '{"enabled":true,"types":["a","b","c","d","i","j","k"]}',
        font_config       TEXT    DEFAULT '{"selectedFont":"default"}',
        background_config TEXT    DEFAULT '{"imageUrl":"","brightness":50,"blur":10,"useRandom":false}',
        avatar_config     TEXT    DEFAULT '{"imageUrl":""}',
        canvas_config     TEXT    DEFAULT NULL,
        music_config      TEXT    DEFAULT '{"enabled":true,"customSongs":[]}',
        s3_config         TEXT    DEFAULT '{"enabled":false,"endpoint":"","accessKeyId":"","secretAccessKey":"","bucket":"","region":"auto","publicUrl":"","provider":"r2"}',
        created_at        TEXT    DEFAULT CURRENT_TIMESTAMP,
        updated_at        TEXT    DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. 增量迁移：为已存在的旧表补充新列（忽略"已存在"错误）
    const migrations = [
      `ALTER TABLE memos ADD COLUMN is_public   INTEGER DEFAULT 0`,
      `ALTER TABLE memos ADD COLUMN is_pinned   INTEGER DEFAULT 0`,
      `ALTER TABLE memos ADD COLUMN pinned_at   TEXT`,
      `ALTER TABLE memos ADD COLUMN backlinks   TEXT DEFAULT '[]'`,
      `ALTER TABLE memos ADD COLUMN audio_clips TEXT DEFAULT '[]'`,
    ];
    for (const sql of migrations) {
      try { await env.DB.exec(sql); } catch (_) { /* 列已存在，忽略 */ }
    }

    // 4. 创建索引
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_memos_created_at ON memos(created_at)').catch(() => {});
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_memos_is_public   ON memos(is_public)').catch(() => {});
    await env.DB.exec('CREATE INDEX IF NOT EXISTS idx_memos_is_pinned   ON memos(is_pinned)').catch(() => {});

    return new Response(JSON.stringify({ success: true, message: '数据库初始化/迁移成功' }), {
      headers: corsHeaders
    });
  } catch (error) {
    console.error('数据库初始化失败:', error);
    return new Response(JSON.stringify({
      success: false,
      message: '数据库初始化失败',
      error: error.message
    }), { status: 500, headers: corsHeaders });
  }
}
