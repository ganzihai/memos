// D1数据库API客户端，用于在Cloudflare Pages环境中访问D1数据库
export class D1ApiClient {
  static getBaseUrl() {
    return window.location.origin;
  }

  // ---------- 基础库 ----------

  static async initDatabase() {
    try {
      const res = await fetch(`${this.getBaseUrl()}/api/init`, { method: 'POST' });
      return await res.json();
    } catch (error) {
      console.error('初始化D1数据库失败:', error);
      return { success: false, message: error.message };
    }
  }

  static async getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const storedPassword = localStorage.getItem('storedPassword');
    if (storedPassword) {
      headers['Authorization'] = `Bearer ${storedPassword}`;
    }
    return headers;
  }

  // ---------- Memo CRUD ----------

  /**
   * 单个 upsert memo
   */
  static async upsertMemo(memo) {
    const now = new Date().toISOString();
    const payload = {
      memo_id:    String(memo.id || memo.memo_id || ''),
      content:    memo.content,
      tags:       memo.tags || [],
      backlinks:  Array.isArray(memo.backlinks)   ? memo.backlinks.map(String)   : [],
      audio_clips:Array.isArray(memo.audioClips)  ? memo.audioClips  : [],
      is_public:  memo.is_public  ? 1 : 0,
      is_pinned:  memo.is_pinned  ? 1 : 0,
      pinned_at:  memo.pinnedAt   || null,
      created_at: memo.createdAt  || memo.timestamp || now,
      updated_at: memo.updatedAt  || memo.lastModified || now,
    };
    const res = await fetch(`${this.getBaseUrl()}/api/memos`, {
      method: 'POST',
      headers: await this.getHeaders(),
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || '保存memo失败');
    return result;
  }

  /**
   * 轻量级元数据更新（置顶状态、公开状态），不需要传整个 memo
   * @param {string|number} memoId
   * @param {{ is_public?: boolean, is_pinned?: boolean, pinned_at?: string|null }} meta
   */
  static async updateMemoMeta(memoId, meta) {
    const payload = {
      memo_id: String(memoId),
      ...meta,
    };
    try {
      const res = await fetch(`${this.getBaseUrl()}/api/memos`, {
        method: 'PATCH',
        headers: await this.getHeaders(),
        body: JSON.stringify(payload),
      });
      return await res.json();
    } catch (error) {
      console.error('updateMemoMeta 失败:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * 删除 memo
   */
  static async deleteMemo(memoId) {
    const res = await fetch(`${this.getBaseUrl()}/api/memos?memoId=${String(memoId)}`, {
      method: 'DELETE',
      headers: await this.getHeaders(),
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || '删除memo失败');
    return result;
  }

  // ---------- 批量同步 ----------

  /**
   * 全量同步所有 memo + 设置
   */
  static async syncUserData(data) {
    try {
      const now = new Date().toISOString();

      // 合并普通 memos 和 pinned memos（去重）
      const allMemos = [...(data.memos || [])];
      if (Array.isArray(data.pinnedMemos)) {
        for (const pm of data.pinnedMemos) {
          if (!allMemos.some(m => String(m.id) === String(pm.id))) allMemos.push(pm);
        }
      }

      if (allMemos.length > 0) {
        const pinnedIds = new Set((data.pinnedMemos || []).map(m => String(m.id)));
        const payload = allMemos.map(memo => ({
          memo_id:    String(memo.id),
          content:    memo.content,
          tags:       memo.tags || [],
          backlinks:  Array.isArray(memo.backlinks)  ? memo.backlinks.map(String)  : [],
          audio_clips:Array.isArray(memo.audioClips) ? memo.audioClips : [],
          is_public:  memo.is_public  ? 1 : 0,
          is_pinned:  (pinnedIds.has(String(memo.id)) || memo.is_pinned) ? 1 : 0,
          pinned_at:  memo.pinnedAt   || null,
          created_at: memo.createdAt  || memo.timestamp || now,
          updated_at: memo.updatedAt  || memo.lastModified || now,
        }));

        const res = await fetch(`${this.getBaseUrl()}/api/memos`, {
          method: 'POST',
          headers: await this.getHeaders(),
          body: JSON.stringify(payload),
        });
        const r = await res.json();
        if (!r.success) {
          // 【修复】仅在后端逻辑错误时降级逐个同步；网络错误（fetch 抛异常）直接向上 throw，不做无谓重试
          console.warn('批量同步失败，降级逐个同步:', r.error);
          for (const memo of allMemos) {
            try { await this.upsertMemo(memo); } catch (e) {
              console.error('逐个同步memo失败:', memo.id, e);
            }
          }
        }
      }

      // 同步用户设置
      await this.upsertUserSettings({
        pinnedMemos:      data.pinnedMemos,
        themeColor:       data.themeColor,
        darkMode:         data.darkMode,
        hitokotoConfig:   data.hitokotoConfig,
        fontConfig:       data.fontConfig,
        backgroundConfig: data.backgroundConfig,
        avatarConfig:     data.avatarConfig,
        canvasConfig:     data.canvasConfig,
        musicConfig:      data.musicConfig,
        s3Config:         data.s3Config,
        updated_at:       now,
      });

      return { success: true, message: '数据同步到D1成功' };
    } catch (error) {
      // 网络错误或 upsertUserSettings 失败时直接抛出，不再尝试降级
      console.error('D1数据同步失败:', error);
      return { success: false, message: error.message };
    }
  }

  // ---------- 设置 ----------

  /**
   * 全量写入用户设置
   */
  static async upsertUserSettings(settings) {
    const payload = {};
    if (settings.pinnedMemos      !== undefined) payload.pinned_memos      = settings.pinnedMemos;
    if (settings.themeColor       !== undefined) payload.theme_color       = settings.themeColor;
    if (settings.darkMode         !== undefined) payload.dark_mode         = settings.darkMode === 'true' || settings.darkMode === true;
    if (settings.hitokotoConfig   !== undefined) payload.hitokoto_config   = settings.hitokotoConfig;
    if (settings.fontConfig       !== undefined) payload.font_config       = settings.fontConfig;
    if (settings.backgroundConfig !== undefined) payload.background_config = settings.backgroundConfig;
    if (settings.avatarConfig     !== undefined) payload.avatar_config     = settings.avatarConfig;
    if (settings.canvasConfig     !== undefined) payload.canvas_config     = settings.canvasConfig;
    if (settings.musicConfig      !== undefined) payload.music_config      = settings.musicConfig;
    if (settings.s3Config         !== undefined) payload.s3_config         = settings.s3Config;
    payload.updated_at = settings.updated_at || new Date().toISOString();

    const res = await fetch(`${this.getBaseUrl()}/api/settings`, {
      method: 'POST',
      headers: await this.getHeaders(),
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || '保存用户设置失败');
    return result;
  }

  // ---------- 数据恢复 ----------

  /**
   * 获取公开数据（游客模式）
   */
  static async getPublicData() {
    try {
      const res = await fetch(`${this.getBaseUrl()}/api/memos?public_only=true`, {
        headers: await this.getHeaders()
      });
      const r   = await res.json();
      if (!r.success) throw new Error(r.error || '获取公开数据失败');
      return {
        success: true,
        data: { memos: r.data || [], settings: null },
        message: '获取公开数据成功',
      };
    } catch (error) {
      console.error('获取公开数据失败:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * 从 D1 恢复用户数据
   */
  static async restoreUserData() {
    try {
      const base = this.getBaseUrl();
      const headers = await this.getHeaders();
      const [memosRes, settingsRes] = await Promise.all([
        fetch(`${base}/api/memos`, { headers }),
        fetch(`${base}/api/settings`, { headers }),
      ]);
      const [memosResult, settingsResult] = await Promise.all([
        memosRes.json(),
        settingsRes.json(),
      ]);
      if (!memosResult.success || !settingsResult.success) {
        throw new Error(memosResult.error || settingsResult.error || '获取数据失败');
      }
      return {
        success: true,
        data: { memos: memosResult.data || [], settings: settingsResult.data },
        message: '从D1恢复数据成功',
      };
    } catch (error) {
      console.error('从D1恢复数据失败:', error);
      return { success: false, message: error.message };
    }
  }

  // ---------- 其他 ----------

  static async checkAvailability() {
    try {
      const res = await fetch(`${this.getBaseUrl()}/api/health`);
      if (!res.ok) return { available: false };
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return { available: false };
      const result = await res.json();
      return { available: result.status === 'ok' };
    } catch {
      return { available: false };
    }
  }

  /**
   * 使用 sendBeacon 在页面卸载时尝试上传单个 memo（不阻塞）
   * @param {object} memo
   */
  static beaconUpsertMemo(memo) {
    try {
      const now = new Date().toISOString();
      const payload = JSON.stringify({
        memo_id:    String(memo.id),
        content:    memo.content,
        tags:       memo.tags || [],
        backlinks:  Array.isArray(memo.backlinks)  ? memo.backlinks.map(String)  : [],
        audio_clips:Array.isArray(memo.audioClips) ? memo.audioClips : [],
        is_public:  memo.is_public  ? 1 : 0,
        is_pinned:  memo.is_pinned  ? 1 : 0,
        pinned_at:  memo.pinnedAt   || null,
        created_at: memo.createdAt  || memo.timestamp || now,
        updated_at: memo.updatedAt  || memo.lastModified || now,
      });
      const blob = new Blob([payload], { type: 'application/json' });
      return navigator.sendBeacon(`${this.getBaseUrl()}/api/memos`, blob);
    } catch (e) {
      console.warn('beaconUpsertMemo 失败:', e);
      return false;
    }
  }
}
