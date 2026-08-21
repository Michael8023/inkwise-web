// 错误码 → 中文可读文案（与网页端一致的错误语义，供 UI 层统一使用）。

export class AppError extends Error {
  code: string;
  status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

const MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "登录状态已失效，请重新登录",
  NETWORK_REQUEST_FAILED: "网络连接失败，请检查网络后重试",
  QUOTA_EXCEEDED: "积分不足，请升级会员或等待下月额度恢复",
  RATE_LIMITED: "操作过于频繁，请稍后再试",
  MODEL_DISABLED: "该模型暂不可用，请切换其他模型",
  MODEL_PLAN_RESTRICTED: "该模型需要会员权限",
  CONTEXT_TOO_LARGE: "文档内容过长，请缩小范围后重试",
  ENTITLEMENT_NOT_FOUND: "账户权益信息不存在，请联系客服",
  CODE_INVALID: "验证码错误或已过期",
  PASSWORD_INVALID: "密码长度需为 8-72 位",
  EMAIL_ALREADY_REGISTERED: "该邮箱已注册，请直接登录",
  USERNAME_TAKEN: "该用户名已被占用",
  EMAIL_SEND_FAILED: "验证码邮件发送失败，请稍后再试",
  INVITE_CODE_INVALID: "邀请码无效",
  INVALID_CREDENTIALS: "邮箱或密码错误",
  EMAIL_NOT_CONFIRMED: "邮箱尚未验证，请先完成邮箱验证",
  PDF_PARSE_FAILED: "PDF 解析失败，文件可能已损坏",
  TEXT_EMPTY: "该 PDF 没有可提取的文本层（可能是扫描件）",
  LIBRARY_PAPER_NOT_FOUND: "文献不存在或已被删除",
  STORAGE_UPLOAD_FAILED: "文件上传失败，请稍后再试",
  STORAGE_DOWNLOAD_FAILED: "文件下载失败，请稍后再试",
  INVALID_PDF_FILE: "请选择有效的 PDF 文件",
  FILE_TOO_LARGE: "文件超过 50MB 上限",
  DUPLICATE_PAPER: "该文献已在文献库中",
  SUMMARY_GENERATION_FAILED: "摘要生成失败，请稍后再试",
  DOI_PDF_NOT_AVAILABLE: "未能从该 DOI 获取 PDF，请确认链接是否正确",
  PDF_UPSTREAM_404: "目标站点返回 404，论文可能无法公开获取",
  PDF_URL_FETCH_FAILED: "PDF 获取失败，请稍后再试",
  URL_NOT_ALLOWED: "该链接不允许访问",
  NOT_A_PDF: "该链接返回的不是 PDF 文件",
  PDF_TOO_LARGE: "PDF 超过 50MB 上限",
  IMPORT_FAILED: "导入失败，请稍后再试",
  UNKNOWN: "出了点问题，请稍后再试",
};

export function humanError(error: unknown): string {
  let code = "";
  let isAppError = false;
  if (error instanceof AppError) {
    code = error.code;
    isAppError = true;
  } else if (error instanceof Error) {
    code = error.message;
  }
  if (!code) return MESSAGES.UNKNOWN;
  // 服务端错误码可能带附加信息（如 DOI_PDF_NOT_AVAILABLE:https://...），取冒号前部分匹配
  const bare = code.split(":")[0];
  if (MESSAGES[bare]) return MESSAGES[bare];
  if (bare.startsWith("PDF_UPSTREAM_")) return "目标站点返回错误，论文可能无法公开获取";
  // 应用内错误码未知时给通用文案；普通 Error 保留原文（通常已可读）
  return isAppError ? MESSAGES.UNKNOWN : code;
}

export function toAppError(error: unknown, fallback = "UNKNOWN"): AppError {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new AppError(MESSAGES[message] ? message : fallback);
}
