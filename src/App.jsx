
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, Routes, Route } from "react-router-dom";
import { navItems } from "./nav-items";
import { ThemeProvider } from "@/context/ThemeContext";
import { SettingsProvider } from "@/context/SettingsContext";
import { PasswordAuthProvider, usePasswordAuth } from "@/context/PasswordAuthContext";
import Login from "@/pages/Login";
import LoginDialog from "@/components/LoginDialog";
import DesktopTitleBar from "@/components/DesktopTitleBar";
import DesktopConfigCheck from "@/components/DesktopConfigCheck";

// S3代理功能已移除，现在直接使用AWS SDK

const queryClient = new QueryClient();

// 主应用内容组件
const AppContent = () => {
  const { isAuthenticated, requiresAuth, isLoading } = usePasswordAuth();

  // 加载中显示loading
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">正在初始化...</p>
        </div>
      </div>
    );
  }

  // 🔧 修改逻辑：不管是否需要认证，都显示主应用
  // 未认证时显示公开博客模式，已认证时显示完整功能
  return (
    <div className="h-screen flex flex-col">
      {/* 桌面端标题栏 */}
      <DesktopTitleBar />

      {/* 主应用内容 */}
      <div className="flex-1 overflow-hidden">
        <HashRouter>
          <Routes>
            {navItems.map(({ to, page }) => (
              <Route key={to} path={to} element={page} />
            ))}
          </Routes>
        </HashRouter>
        <LoginDialog />
      </div>
    </div>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <PasswordAuthProvider>
      <ThemeProvider>
        <SettingsProvider>
          <TooltipProvider>
            <Toaster />
            <DesktopConfigCheck />
            <AppContent />
          </TooltipProvider>
        </SettingsProvider>
      </ThemeProvider>
    </PasswordAuthProvider>
  </QueryClientProvider>
);

export default App;

