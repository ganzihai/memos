// 处理memos相关的请求
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // 1. 鉴权校验逻辑
  const password = env.PASSWORD;
  const authHeader = request.headers.get('Authorization');
  const providedPassword = authHeader ? (authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader) : null;
  const isAuthenticated = password && password.trim() ? (providedPassword === password.trim()) : true;

  // 对于写操作，必须鉴权
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !isAuthenticated) {
    return new Response(JSON.stringify({ success: false, message: '未授权访问' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    if (method === 'GET') {
      const publicOnly = url.searchParams.get('public_only') === 'true';
      const pinnedOnly = url.searchParams.get('pinned_only') === 'true';

      let query = 'SELECT * FROM memos';
      const conditions = [];
      
      // 如果未登录，强制只能看公开内容
      if (!isAuthenticated || publicOnly) {
        conditions.push('is_public = 1');
      }
      
      if (pinnedOnly) {
        conditions.push('is_pinned = 1');
      }

      if (conditions.length) {
        query += ' WHERE ' + conditions.join(' AND ');
      }
      
      query += ' ORDER BY created_at DESC';

      const { results } = await env.DB.prepare(query).all();

      return new Response(JSON.stringify({ success: true, data: results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } else if (method === 'POST') {
      // 创建或更新 memo（单个对象或数组）
      const body = await request.json();

      const processMemo = async (memoData) => {
        let {
          memo_id, content, tags, backlinks, audio_clips,
          is_public, is_pinned, pinned_at, created_at, updated_at
        } = memoData;

        // 如果没有 memo_id，自动生成一个（主要是为了 n8n 等外部推送）
        if (!memo_id) {
          memo_id = Date.now().toString() + Math.random().toString(36).substring(2, 7);
        } else {
          memo_id = String(memo_id);
        }

        if (content === undefined || content === null) {
          throw new Error('缺少必要参数 content');
        }

        const existingMemo = await env.DB
          .prepare('SELECT memo_id FROM memos WHERE memo_id = ?')
          .bind(memo_id)
          .first();

        const now = new Date().toISOString();
        const finalMemo = {
          memo_id,
          content,
          tags: JSON.stringify(tags || []),
          backlinks: JSON.stringify(backlinks || []),
          audio_clips: JSON.stringify(audio_clips || []),
          is_public: (is_public === 1 || is_public === true) ? 1 : 0,
          is_pinned: (is_pinned === 1 || is_pinned === true) ? 1 : 0,
          pinned_at: pinned_at || null,
          created_at: existingMemo ? existingMemo.created_at : (created_at || now),
          updated_at: updated_at || now
        };

        if (existingMemo) {
          await env.DB
            .prepare(`UPDATE memos
               SET content = ?, tags = ?, backlinks = ?, audio_clips = ?,
                   is_public = ?, is_pinned = ?, pinned_at = ?, updated_at = ?
             WHERE memo_id = ?`)
            .bind(
              finalMemo.content,
              finalMemo.tags,
              finalMemo.backlinks,
              finalMemo.audio_clips,
              finalMemo.is_public,
              finalMemo.is_pinned,
              finalMemo.pinned_at,
              finalMemo.updated_at,
              memo_id
            )
            .run();
        } else {
          await env.DB
            .prepare(`INSERT INTO memos
               (memo_id, content, tags, backlinks, audio_clips, is_public, is_pinned, pinned_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(
              memo_id,
              finalMemo.content,
              finalMemo.tags,
              finalMemo.backlinks,
              finalMemo.audio_clips,
              finalMemo.is_public,
              finalMemo.is_pinned,
              finalMemo.pinned_at,
              finalMemo.created_at,
              finalMemo.updated_at
            )
            .run();
        }
        return {
          ...finalMemo,
          tags: tags || [],
          backlinks: backlinks || [],
          audio_clips: audio_clips || []
        };
      };

      if (Array.isArray(body)) {
        for (const item of body) {
          try { await processMemo(item); } catch (e) {
            console.error('批量处理memo失败:', item?.memo_id, e);
          }
        }
        return new Response(JSON.stringify({ success: true, message: '批量Memo保存成功' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } else {
        try {
          const processed = await processMemo(body);
          return new Response(JSON.stringify({ success: true, message: 'Memo保存成功', data: processed }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } catch (e) {
          return new Response(JSON.stringify({ success: false, error: e.message }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
      }

    } else if (method === 'PATCH') {
      // 专门用于轻量级元数据更新（is_public / is_pinned），不需要传全量数据
      // 请求体: { memo_id, is_public?, is_pinned?, pinned_at? }
      const body = await request.json();
      const { memo_id } = body;

      if (!memo_id) {
        return new Response(JSON.stringify({ success: false, error: '缺少 memo_id' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const fields = [];
      const values = [];

      if ('is_public' in body) {
        fields.push('is_public = ?');
        values.push(body.is_public ? 1 : 0);
      }
      if ('is_pinned' in body) {
        fields.push('is_pinned = ?');
        values.push(body.is_pinned ? 1 : 0);
      }
      if ('pinned_at' in body) {
        fields.push('pinned_at = ?');
        values.push(body.pinned_at || null);
      }

      if (fields.length === 0) {
        return new Response(JSON.stringify({ success: false, error: '没有需要更新的字段' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      fields.push('updated_at = ?');
      values.push(new Date().toISOString());
      values.push(memo_id);

      await env.DB
        .prepare(`UPDATE memos SET ${fields.join(', ')} WHERE memo_id = ?`)
        .bind(...values)
        .run();

      return new Response(JSON.stringify({ success: true, message: '元数据更新成功' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } else if (method === 'DELETE') {
      const memoId = url.searchParams.get('memoId');

      if (!memoId) {
        return new Response(JSON.stringify({ success: false, error: '缺少memoId参数' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      await env.DB.prepare('DELETE FROM memos WHERE memo_id = ?').bind(memoId).run();

      return new Response(JSON.stringify({ success: true, message: 'Memo删除成功' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } else {
      return new Response(JSON.stringify({ success: false, error: '不支持的请求方法' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  } catch (error) {
    console.error('处理memos请求失败:', error);
    return new Response(JSON.stringify({
      success: false,
      message: '处理memos请求失败',
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
