import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Job Buddy - 求职申请自动填写',
    description:
      '使用已保存的个人资料，一键自动填写各类招聘网站的求职申请表，无需注册账号。',
    permissions: ['storage', 'identity', 'activeTab'],
    host_permissions: [
      'https://generativelanguage.googleapis.com/*',
      'https://api.deepseek.com/*',
      'https://www.googleapis.com/*',
      'https://oauth2.googleapis.com/*',
    ],
  },
});
