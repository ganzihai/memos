export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;
  
  // 设置 CORS 头
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  
  if (method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  
  if (method !== 'POST') {
    return new Response(JSON.stringify({ error: '只支持 POST 请求' }), { status: 405, headers: corsHeaders });
  }

  try {
    // 检查 R2 是否绑定
    if (!env.R2_BUCKET) {
      return new Response(JSON.stringify({ error: 'R2 存储桶未绑定到环境变量 R2_BUCKET' }), { status: 500, headers: corsHeaders });
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
      return new Response(JSON.stringify({ error: '未找到上传的文件' }), { status: 400, headers: corsHeaders });
    }

    // 生成唯一文件名
    const originalName = file.name || 'blob';
    const extension = originalName.split('.').pop() || 'bin';
    const cleanName = originalName.split('.')[0].replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_');
    
    // 按月份分类存储
    const date = new Date();
    const monthFolder = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const fileName = `${monthFolder}/${Date.now()}_${Math.random().toString(36).substring(2, 8)}_${cleanName}.${extension}`;

    // 将文件写入绑定的 R2 存储桶
    await env.R2_BUCKET.put(fileName, file.stream(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' }
    });

    // 使用你提供的自定义域名
    const publicUrl = `https://memosr2.ganzi.fun/${fileName}`;

    return new Response(JSON.stringify({ 
      success: true, 
      url: publicUrl,
      fileName: fileName,
      storageType: 'r2_binding'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('R2上传接口错误:', error);
    return new Response(JSON.stringify({ error: error.message || '上传过程中发生未知错误' }), { status: 500, headers: corsHeaders });
  }
}
