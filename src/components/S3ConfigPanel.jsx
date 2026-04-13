import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Cloud, TestTube, Save } from 'lucide-react';
import { toast } from 'sonner';
import s3StorageService from '@/lib/s3Storage';

export default function S3ConfigPanel({ s3Config, updateS3Config }) {
  const [isConfigDialogOpen, setIsConfigDialogOpen] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [formData, setFormData] = useState(s3Config);

  // 重置表单数据
  const resetForm = () => {
    setFormData(s3Config);
  };

  // 测试连接
  const testConnection = async () => {
    if (!formData.endpoint || !formData.accessKeyId || !formData.secretAccessKey || !formData.bucket) {
      toast.error('请填写完整的S3配置信息');
      return;
    }

    setIsTestingConnection(true);
    try {
      // 初始化S3服务
      s3StorageService.init(formData);
      
      // 测试连接
      const result = await s3StorageService.testConnection();
      
      if (result.success) {
        toast.success('S3连接测试成功！');
      } else {
        toast.error(`连接测试失败: ${result.error}`);
      }
    } catch (error) {
      console.error('S3连接测试失败:', error);
      toast.error('连接测试失败，请检查配置信息');
    } finally {
      setIsTestingConnection(false);
    }
  };

  // 保存配置
  const saveConfig = () => {
    if (!formData.endpoint || !formData.accessKeyId || !formData.secretAccessKey || !formData.bucket) {
      toast.error('请填写完整的S3配置信息');
      return;
    }

    // 初始化S3服务
    s3StorageService.init(formData);
    
    // 更新配置
    updateS3Config(formData);
    setIsConfigDialogOpen(false);
    toast.success('S3配置已保存');
  };

  // 顶部卡片内的启用开关
  const toggleEnabled = (checked) => {
    updateS3Config({ ...s3Config, enabled: checked });
  };

  // 获取提供商配置模板
  const getProviderTemplate = (provider) => {
    switch (provider) {
      case 'r2':
        return {
          endpoint: 'https://your-account.r2.cloudflarestorage.com',
          region: 'auto',
          placeholder: {
            endpoint: 'https://xxx.r2.cloudflarestorage.com',
            bucket: 'your-bucket-name'
          }
        };
      case 's3':
        return {
          endpoint: 'https://s3.amazonaws.com',
          region: 'us-east-1',
          placeholder: {
            endpoint: 'https://s3.amazonaws.com',
            bucket: 'your-bucket-name'
          }
        };
      case 'minio':
        return {
          endpoint: 'http://localhost:9000',
          region: 'us-east-1',
          placeholder: {
            endpoint: 'http://localhost:9000',
            bucket: 'your-bucket-name'
          }
        };
      default:
        return {
          endpoint: '',
          region: 'auto',
          placeholder: {
            endpoint: 'https://your-storage-endpoint.com',
            bucket: 'your-bucket-name'
          }
        };
    }
  };

  // 当提供商改变时，更新配置模板
  const handleProviderChange = (provider) => {
    const template = getProviderTemplate(provider);
    setFormData(prev => ({
      ...prev,
      provider,
      endpoint: template.endpoint,
      region: template.region
    }));
  };

  return (
    <>
      <div
        className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer"
        onClick={() => setIsConfigDialogOpen(true)}
      >
        <div className="flex items-center gap-3">
          <Cloud className="h-4 w-4 text-gray-600 dark:text-gray-400" />
          <div>
            <div className="font-medium text-sm">S3存储配置</div>
            <div className={`text-xs ${s3Config.enabled ? 'text-green-600' : 'text-gray-500'}`}>
              {s3Config.enabled ? '已启用' : '未启用'}
            </div>
          </div>
        </div>
        {/* 集成启用开关，阻止冒泡以免触发打开对话框 */}
        <div onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={!!s3Config.enabled}
            onCheckedChange={toggleEnabled}
          />
        </div>
      </div>

      {/* 配置对话框 */}
      <Dialog open={isConfigDialogOpen} onOpenChange={(open) => {
        if (!open) {
          setIsConfigDialogOpen(false);
          resetForm();
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-800 shadow-xl custom-scrollbar">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Cloud className="h-5 w-5" />
              S3存储配置
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* 启用开关 */}
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">启用S3存储</div>
                <div className="text-sm text-gray-500">
                  启用后，大文件将自动上传到S3存储
                </div>
              </div>
              <Switch
                checked={formData.enabled}
                onCheckedChange={(checked) => 
                  setFormData(prev => ({ ...prev, enabled: checked }))
                }
              />
            </div>

            {/* 提供商选择 */}
            <div className="space-y-2">
              <Label htmlFor="provider">存储提供商</Label>
              <Select 
                value={formData.provider} 
                onValueChange={handleProviderChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择存储提供商" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="r2">Cloudflare R2</SelectItem>
                  <SelectItem value="s3">Amazon S3</SelectItem>
                  <SelectItem value="minio">MinIO</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                选择您的存储服务提供商
              </p>
            </div>

            {/* 端点URL */}
            <div className="space-y-2">
              <Label htmlFor="endpoint">端点URL *</Label>
              <Input
                id="endpoint"
                value={formData.endpoint}
                onChange={(e) => setFormData(prev => ({ ...prev, endpoint: e.target.value }))}
                placeholder={getProviderTemplate(formData.provider).placeholder.endpoint}
              />
              <p className="text-xs text-gray-500">
                S3服务的端点URL，例如: https://xxx.r2.cloudflarestorage.com
              </p>
            </div>

            {/* 访问密钥 */}
            <div className="space-y-2">
              <Label htmlFor="accessKeyId">访问密钥ID *</Label>
              <Input
                id="accessKeyId"
                value={formData.accessKeyId}
                onChange={(e) => setFormData(prev => ({ ...prev, accessKeyId: e.target.value }))}
                placeholder="您的访问密钥ID"
                type="password"
              />
            </div>

            {/* 秘密密钥 */}
            <div className="space-y-2">
              <Label htmlFor="secretAccessKey">秘密密钥 *</Label>
              <Input
                id="secretAccessKey"
                value={formData.secretAccessKey}
                onChange={(e) => setFormData(prev => ({ ...prev, secretAccessKey: e.target.value }))}
                placeholder="您的秘密密钥"
                type="password"
              />
            </div>

            {/* 存储桶 */}
            <div className="space-y-2">
              <Label htmlFor="bucket">存储桶名称 *</Label>
              <Input
                id="bucket"
                value={formData.bucket}
                onChange={(e) => setFormData(prev => ({ ...prev, bucket: e.target.value }))}
                placeholder={getProviderTemplate(formData.provider).placeholder.bucket}
              />
              <p className="text-xs text-gray-500">
                存储桶名称，例如: your-bucket-name
              </p>
            </div>

            {/* 区域 */}
            <div className="space-y-2">
              <Label htmlFor="region">区域</Label>
              <Input
                id="region"
                value={formData.region}
                onChange={(e) => setFormData(prev => ({ ...prev, region: e.target.value }))}
                placeholder="auto"
              />
              <p className="text-xs text-gray-500">
                存储区域，R2通常使用"auto"
              </p>
            </div>

            {/* 公共URL */}
            <div className="space-y-2">
              <Label htmlFor="publicUrl">公共URL（可选）</Label>
              <Input
                id="publicUrl"
                value={formData.publicUrl}
                onChange={(e) => setFormData(prev => ({ ...prev, publicUrl: e.target.value }))}
                placeholder="https://your-cdn-domain.com"
              />
              <p className="text-xs text-gray-500">
                可选的CDN域名，留空则使用端点URL
              </p>
            </div>

            {/* 操作按钮 */}
            <div className="flex gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => setIsConfigDialogOpen(false)}
                className="flex-1"
              >
                取消
              </Button>
              <Button
                onClick={testConnection}
                disabled={isTestingConnection}
                variant="outline"
                className="flex-1"
              >
                <TestTube className="h-4 w-4 mr-2" />
                {isTestingConnection ? '测试中...' : '测试连接'}
              </Button>
              <Button
                onClick={saveConfig}
                className="flex-1"
              >
                <Save className="h-4 w-4 mr-2" />
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}