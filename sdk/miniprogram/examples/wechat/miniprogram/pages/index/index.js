// pages/index/index.js — 示例页面
// 演示两种使用方式：patch 全局拦截 & 手动调用 proxyflow.request

const proxyflow = require('../../utils/proxyflow-mp-sdk');

Page({
  data: {
    result: '',
  },

  // 方式一：autoPatch 后，直接使用 wx.request（已被 proxyflow 接管）
  onTestPatchedRequest() {
    wx.request({
      url: 'https://httpbin.org/get',
      method: 'GET',
      header: { 'x-custom': 'hello' },
      success: (res) => {
        console.log('响应:', res.statusCode, res.data);
        console.log('是否命中 Mock:', res._proxyflow?.isMocked);
        this.setData({ result: JSON.stringify(res.data, null, 2) });
      },
      fail: (err) => {
        console.error('请求失败:', err);
      },
    });
  },

  // 方式二：手动调用 proxyflow.request（不需要 patch）
  onTestManualRequest() {
    proxyflow.request({
      url: 'https://httpbin.org/post',
      method: 'POST',
      header: { 'content-type': 'application/json' },
      data: { userId: 123, action: 'test' },
      success: (res) => {
        console.log('POST 响应:', res.statusCode);
        console.log('耗时:', res._proxyflow?.durationMs, 'ms');
        this.setData({ result: JSON.stringify(res.data, null, 2) });
      },
      fail: (err) => {
        console.error('请求失败:', err);
      },
    });
  },
});
