/**
 * 这是一个安全的复制到剪贴板的工具函数。
 * 在 HTTP 或非安全上下文（如某些内网 IP）中，navigator.clipboard 可能未定义。
 * 此函数会退回到使用 document.execCommand('copy') 的传统方法。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    // 优先使用现代 Clipboard API
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    
    // 退回到传统的 execCommand 方法
    const textArea = document.createElement('textarea');
    textArea.value = text;
    
    // 确保 textarea 在屏幕外但可见以便执行 copy 命
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '0';
    document.body.appendChild(textArea);
    
    textArea.focus();
    textArea.select();
    
    let successful = false;
    try {
      successful = document.execCommand('copy');
    } catch (err) {
      console.error('Fallback copy failed:', err);
      successful = false;
    }
    
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error('Failed to copy text:', err);
    return false;
  }
}
