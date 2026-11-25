export function authMailConfigured() {
  return Boolean(process.env.AUTH_MAIL_API_KEY?.trim() && process.env.AUTH_MAIL_FROM?.trim());
}

export async function sendAuthMail(email: string, url: string, purpose: "verify" | "reset") {
  const subject = purpose === "verify" ? "验证邮箱" : "重设密码";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.AUTH_MAIL_API_KEY?.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.AUTH_MAIL_FROM?.trim(), to: [email],
      subject: `英语学习实验室 · ${subject}`,
      text: `请打开以下链接以${subject}：\n${url}\n\n如果你没有发起此操作，可以忽略这封邮件。`,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!response?.ok) console.error("认证邮件发送失败，请检查发信服务。");
}
