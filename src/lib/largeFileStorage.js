// 大文件存储服务 - 使用IndexedDB存储大文件数据
class LargeFileStorage {
  constructor() {
    this.dbName = 'MeowNocodeLargeFileStorage';
    this.dbVersion = 1;
    this.storeName = 'files';
    this.db = null;
    this.initPromise = this.initDB();
  }

  // 初始化IndexedDB数据库
  async initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onerror = () => {
        console.error('Failed to open IndexedDB');
        reject(request.error);
      };
      
      request.onsuccess = () => {
        this.db = request.result;
        console.log('IndexedDB initialized successfully');
        resolve(this.db);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // 创建对象存储
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('fileName', 'fileName', { unique: false });
          store.createIndex('fileSize', 'fileSize', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
    });
  }

  // 确保数据库已初始化
  async ensureDB() {
    if (!this.db) {
      await this.initPromise;
    }
  }

  // 生成唯一ID
  generateId() {
    return `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // 存储文件数据
  async storeFile(fileInfo) {
    await this.ensureDB();
    
    const fileId = this.generateId();
    const fileData = {
      id: fileId,
      fileName: fileInfo.name,
      fileSize: fileInfo.size,
      fileType: fileInfo.type,
      data: fileInfo.data, // Base64数据
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.add(fileData);

      request.onsuccess = () => {
        console.log(`File stored successfully: ${fileInfo.name} (${fileId})`);
        resolve({
          ...fileInfo,
          id: fileId,
          storageType: 'indexeddb',
          // 清理Base64数据，只保留引用
          data: null,
          base64Data: null
        });
      };

      request.onerror = () => {
        console.error('Failed to store file:', request.error);
        reject(request.error);
      };
    });
  }

  // 获取文件数据
  async getFile(fileId) {
    await this.ensureDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(fileId);

      request.onsuccess = () => {
        const fileData = request.result;
        if (fileData) {
          // 更新最后访问时间
          this.updateLastAccessed(fileId);
          resolve(fileData);
        } else {
          resolve(null);
        }
      };

      request.onerror = () => {
        console.error('Failed to get file:', request.error);
        reject(request.error);
      };
    });
  }

  // 更新最后访问时间
  async updateLastAccessed(fileId) {
    await this.ensureDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(fileId);

      request.onsuccess = () => {
        const fileData = request.result;
        if (fileData) {
          fileData.lastAccessed = new Date().toISOString();
          const updateRequest = store.put(fileData);
          
          updateRequest.onsuccess = () => resolve();
          updateRequest.onerror = () => reject(updateRequest.error);
        } else {
          resolve();
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  // 删除文件
  async deleteFile(fileId) {
    await this.ensureDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(fileId);

      request.onsuccess = () => {
        console.log(`File deleted successfully: ${fileId}`);
        resolve();
      };

      request.onerror = () => {
        console.error('Failed to delete file:', request.error);
        reject(request.error);
      };
    });
  }

  // 获取存储统计信息
  async getStorageStats() {
    await this.ensureDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        const files = request.result;
        const totalFiles = files.length;
        const totalSize = files.reduce((sum, file) => sum + file.fileSize, 0);
        const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(2);
        
        resolve({
          totalFiles,
          totalSize,
          totalSizeMB: parseFloat(totalSizeMB),
          files: files.map(file => ({
            id: file.id,
            fileName: file.fileName,
            fileSize: file.fileSize,
            fileSizeMB: (file.fileSize / (1024 * 1024)).toFixed(2),
            createdAt: file.createdAt,
            lastAccessed: file.lastAccessed
          }))
        });
      };

      request.onerror = () => {
        console.error('Failed to get storage stats:', request.error);
        reject(request.error);
      };
    });
  }

  // 清理过期文件（可选）
  async cleanupOldFiles(maxAge = 30 * 24 * 60 * 60 * 1000) { // 30天
    await this.ensureDB();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        const files = request.result;
        const now = Date.now();
        const filesToDelete = files.filter(file => {
          const lastAccessed = new Date(file.lastAccessed).getTime();
          return now - lastAccessed > maxAge;
        });

        let deletedCount = 0;
        filesToDelete.forEach(file => {
          const deleteRequest = store.delete(file.id);
          deleteRequest.onsuccess = () => {
            deletedCount++;
            console.log(`Cleaned up old file: ${file.fileName}`);
          };
        });

        transaction.oncomplete = () => {
          console.log(`Cleanup completed: ${deletedCount} files deleted`);
          resolve(deletedCount);
        };

        transaction.onerror = () => reject(transaction.error);
      };

      request.onerror = () => reject(request.error);
    });
  }

  // 检查存储空间
  async checkStorageSpace() {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      const used = estimate.usage || 0;
      const quota = estimate.quota || 0;
      const available = quota - used;
      const usedMB = (used / (1024 * 1024)).toFixed(2);
      const availableMB = (available / (1024 * 1024)).toFixed(2);
      const quotaMB = (quota / (1024 * 1024)).toFixed(2);
      
      return {
        used,
        available,
        quota,
        usedMB: parseFloat(usedMB),
        availableMB: parseFloat(availableMB),
        quotaMB: parseFloat(quotaMB),
        usagePercentage: quota > 0 ? ((used / quota) * 100).toFixed(2) : 0
      };
    }
    
    return null;
  }
}

// 创建全局实例
const largeFileStorage = new LargeFileStorage();

export default largeFileStorage;