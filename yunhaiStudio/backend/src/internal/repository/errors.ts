// 对应 repository 包内跨文件共享的错误值。

export const errNotificationLimit = new Error("通知发送次数已达上限，请稍后再试");
export const errVerificationInvalid = new Error("验证码已过期或已使用，请重新获取");
export const errChannelConflict = new Error("短信通道配置已变化，请重新获取验证码");
export const errEmailVerificationCodeInvalid = new Error("邮箱验证码已失效，请重新获取");
export const errProfileAuthorization = new Error("账号或身份验证状态已变化，请重新登录或验证");
export const errProfileAvatarUserUnavailable = new Error("avatar owner is not active");
