const PUBLIC_LOGIN_PATTERNS = [
  /#\/outNet/i,
  /登\s*录\s*注\s*册/,
  /下载\s*Ukey/i,
  /登录凭证找回/,
  /其他用户登录/,
];

const AUTHENTICATED_PATTERNS = [
  /#\/dashboard/i,
  /pxf-[^#]+#\//i,
  /江苏省内现货/,
  /我的交易/,
  /我的计划/,
  /96点/,
  /查询/,
];

export function isLikelyLoggedIn({ url, text } = {}) {
  const haystack = `${url ?? ''}\n${text ?? ''}`;
  if (PUBLIC_LOGIN_PATTERNS.some((pattern) => pattern.test(haystack))) {
    return false;
  }

  return AUTHENTICATED_PATTERNS.some((pattern) => pattern.test(haystack));
}
