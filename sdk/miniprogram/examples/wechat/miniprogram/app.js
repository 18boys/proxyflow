// app.js — 微信小程序示例
const proxyflow = require('./utils/proxyflow-sdk');

App({
  onLaunch() {
    // 1. 初始化 proxyflow（填入你的服务器地址和 sessionId）
    proxyflow.init({
      serverUrl: 'http://192.168.1.100:9000',  // 替换为你的 proxyflow 服务器地址
      sessionId: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',  // 从控制台扫码获取
      debug: true,      // 开发阶段打开调试日志
      autoPatch: true,  // 自动拦截所有 wx.request
    });

    console.log('proxyflow 已初始化，平台:', proxyflow.getPlatform());
  },
});
