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

  // 确保数据库表结构是最新的（自动迁移）
  try {
    await env.DB.exec(`ALTER TABLE memos ADD COLUMN is_public INTEGER DEFAULT 0`).catch(() => {});
    await env.DB.exec(`ALTER TABLE memos ADD COLUMN is_pinned INTEGER DEFAULT 0`).catch(() => {});
    await env.DB.exec(`ALTER TABLE memos ADD COLUMN pinned_at TEXT`).catch(() => {});
    await env.DB.exec(`ALTER TABLE memos ADD COLUMN backlinks TEXT DEFAULT '[]'`).catch(() => {});
    await env.DB.exec(`ALTER TABLE memos ADD COLUMN audio_clips TEXT DEFAULT '[]'`).catch(() => {});
  } catch (_) {}

  try {
    if (method === 'GET') {
      const publicOnly = url.searchParams.get('public_only') === 'true';
      const pinnedOnly = url.searchParams.get('pinned_only') === 'true';

      let query = 'SELECT * FROM memos';
      const conditions = [];
      if (publicOnly) conditions.push('is_public = 1');
      if (pinnedOnly) conditions.push('is_pinned = 1');
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY created_at DESC';

      const { results } = await env.DB.prepare(query).all();

      return new Response(JSON.stringify({ success: true, data: results }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } else if (method === 'POST') {
      // 创建或更新 memo（单个对象或数组）
      const body = await request.json();

      const processMemo = async (memoData) => {
        const {
          memo_id, content, tags, backlinks, audio_clips,
          is_public, is_pinned, pinned_at, created_at, updated_at
        } = memoData;

        if (!memo_id || content === undefined || content === null) {
          throw new Error('缺少必要参数 memo_id 或 content');
        }

        const existingMemo = await env.DB
          .prepare('SELECT memo_id FROM memos WHERE memo_id = ?')
          .bind(memo_id)
          .first();

        if (existingMemo) {
          await env.DB
            .prepare(`UPDATE memos
               SET content = ?, tags = ?, backlinks = ?, audio_clips = ?,
                   is_public = ?, is_pinned = ?, pinned_at = ?, updated_at = ?
             WHERE memo_id = ?`)
            .bind(
              content,
              JSON.stringify(tags || []),
              JSON.stringify(backlinks || []),
              JSON.stringify(audio_clips || []),
              is_public ? 1 : 0,
              is_pinned ? 1 : 0,
              pinned_at || null,
              updated_at || new Date().toISOString(),
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
              content,
              JSON.stringify(tags || []),
              JSON.stringify(backlinks || []),
              JSON.stringify(audio_clips || []),
              is_public ? 1 : 0,
              is_pinned ? 1 : 0,
              pinned_at || null,
              created_at || new Date().toISOString(),
              updated_at || new Date().toISOString()
            )
            .run();
        }
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
          await processMemo(body);
          return new Response(JSON.stringify({ success: true, message: 'Memo保存成功' }), {
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
