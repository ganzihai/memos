// Cloudflare Worker for D1 Database API
// 这个Worker提供了与前端应用交互的API接口

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // 设置CORS头
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    
    // 处理OPTIONS请求（预检请求）
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    // 只处理API请求，其他请求交给静态文件处理
    if (path.startsWith('/api/')) {
      try {
        // 路由处理
        if (path === '/api/health') {
          return handleHealthCheck(env, corsHeaders);
        } else if (path === '/api/init') {
          return handleInitDatabase(env, corsHeaders);
        } else if (path.startsWith('/api/memos')) {
          return handleMemos(request, env, corsHeaders);
        } else if (path.startsWith('/api/settings')) {
          return handleSettings(request, env, corsHeaders);
        } else {
          // 未知的API路径
          return new Response(JSON.stringify({ error: 'API endpoint not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      } catch (error) {
        console.error('Worker error:', error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }
    
    // 对于非API请求，返回null让Cloudflare Pages处理静态文件
    return null;
  }
};

// 健康检查
async function handleHealthCheck(env, headers) {
  try {
    // 检查数据库连接
    await env.DB.prepare('SELECT 1').first();
    
    return new Response(JSON.stringify({ 
      status: 'ok', 
      message: 'D1数据库连接正常',
      timestamp: new Date().toISOString()
    }), {
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      status: 'error', 
      message: 'D1数据库连接失败',
      error: error.message 
    }), {
      status: 500,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }
}

// 初始化数据库
async function handleInitDatabase(env, headers) {
  try {
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
        background_config TEXT DEFAULT '{"imageUrl":"","brightness":50,"blur":10}',
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
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ 
      success: false, 
      message: '数据库初始化失败',
      error: error.message 
    }), {
      status: 500,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }
}

// 处理memos相关的请求
async function handleMemos(request, env, headers) {
  const url = new URL(request.url);
  const method = request.method;
  const userId = url.searchParams.get('userId');
  
  if (!userId) {
    return new Response(JSON.stringify({ error: '缺少userId参数' }), {
      status: 400,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }

  try {
    if (method === 'GET') {
      // 获取用户的所有memos
      const { results } = await env.DB
        .prepare('SELECT * FROM memos WHERE user_id = ? ORDER BY created_at DESC')
        .bind(userId)
        .all();
      
      return new Response(JSON.stringify({ success: true, data: results }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    } else if (method === 'POST') {
      // 创建或更新memo
      const body = await request.json();
      const { memo_id, content, tags, created_at, updated_at } = body;
      
      if (!memo_id || !content) {
        return new Response(JSON.stringify({ error: '缺少必要参数' }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      
      // 检查memo是否已存在
      const existingMemo = await env.DB
        .prepare('SELECT * FROM memos WHERE memo_id = ? AND user_id = ?')
        .bind(memo_id, userId)
        .first();
      
      if (existingMemo) {
        // 更新现有memo
        await env.DB
          .prepare('UPDATE memos SET content = ?, tags = ?, updated_at = ? WHERE memo_id = ? AND user_id = ?')
          .bind(content, JSON.stringify(tags || []), updated_at || new Date().toISOString(), memo_id, userId)
          .run();
      } else {
        // 插入新memo
        await env.DB
          .prepare('INSERT INTO memos (memo_id, user_id, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(memo_id, userId, content, JSON.stringify(tags || []), created_at || new Date().toISOString(), updated_at || new Date().toISOString())
          .run();
      }
      
      return new Response(JSON.stringify({ success: true, message: 'Memo保存成功' }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    } else if (method === 'DELETE') {
      // 删除memo
      const memoId = url.searchParams.get('memoId');
      
      if (!memoId) {
        return new Response(JSON.stringify({ error: '缺少memoId参数' }), {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      
      await env.DB
        .prepare('DELETE FROM memos WHERE user_id = ? AND memo_id = ?')
        .bind(userId, memoId)
        .run();
      
      return new Response(JSON.stringify({ success: true, message: 'Memo删除成功' }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    } else {
      return new Response(JSON.stringify({ error: '不支持的请求方法' }), {
        status: 405,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ 
      success: false, 
      message: '处理memos请求失败',
      error: error.message 
    }), {
      status: 500,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }
}

// 处理用户设置相关的请求
async function handleSettings(request, env, headers) {
  const url = new URL(request.url);
  const method = request.method;
  const userId = url.searchParams.get('userId');
  
  if (!userId) {
    return new Response(JSON.stringify({ error: '缺少userId参数' }), {
      status: 400,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }

  try {
    if (method === 'GET') {
      // 获取用户设置
      const settings = await env.DB
        .prepare('SELECT * FROM user_settings WHERE user_id = ?')
        .bind(userId)
        .first();
      
      return new Response(JSON.stringify({ success: true, data: settings }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    } else if (method === 'POST') {
      // 创建或更新用户设置
      const body = await request.json();
      const { pinned_memos, theme_color, dark_mode, hitokoto_config, font_config, background_config } = body;
      
      // 检查用户设置是否已存在
      const existingSettings = await env.DB
        .prepare('SELECT * FROM user_settings WHERE user_id = ?')
        .bind(userId)
        .first();
      
      if (existingSettings) {
        // 更新现有设置
        await env.DB
          .prepare('UPDATE user_settings SET pinned_memos = ?, theme_color = ?, dark_mode = ?, hitokoto_config = ?, font_config = ?, background_config = ?, updated_at = ? WHERE user_id = ?')
          .bind(
            JSON.stringify(pinned_memos || []),
            theme_color || '#969696',
            dark_mode ? 1 : 0,
            JSON.stringify(hitokoto_config || { enabled: true, types: ["a", "b", "c", "d", "i", "j", "k"] }),
            JSON.stringify(font_config || { selectedFont: "default" }),
            JSON.stringify(background_config || { imageUrl: "", brightness: 50, blur: 10 }),
            new Date().toISOString(),
            userId
          )
          .run();
      } else {
        // 插入新设置
        await env.DB
          .prepare('INSERT INTO user_settings (user_id, pinned_memos, theme_color, dark_mode, hitokoto_config, font_config, background_config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(
            userId,
            JSON.stringify(pinned_memos || []),
            theme_color || '#969696',
            dark_mode ? 1 : 0,
            JSON.stringify(hitokoto_config || { enabled: true, types: ["a", "b", "c", "d", "i", "j", "k"] }),
            JSON.stringify(font_config || { selectedFont: "default" }),
            JSON.stringify(background_config || { imageUrl: "", brightness: 50, blur: 10 }),
            new Date().toISOString(),
            new Date().toISOString()
          )
          .run();
      }
      
      return new Response(JSON.stringify({ success: true, message: '用户设置保存成功' }), {
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    } else {
      return new Response(JSON.stringify({ error: '不支持的请求方法' }), {
        status: 405,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ 
      success: false, 
      message: '处理用户设置请求失败',
      error: error.message 
    }), {
      status: 500,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }
}

// S3代理功能已移除，现在直接使用AWS SDK

// 处理静态文件请求
async function handleStaticFiles(request, env, headers) {
  // 这里可以添加静态文件处理逻辑
  // 例如，返回index.html
  return new Response('Not Found', { status: 404, headers });
}