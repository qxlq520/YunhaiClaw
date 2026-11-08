// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
// ReferralProfile 保存用户的推广码；首次打开推广中心时生成，之后不变。

export interface ReferralProfile {
  userId: string;
  code: string;
  createdAt: string;
}

// ReferralBinding 记录被邀请人归属；一个账号只能绑定一次，注册时写入。

export interface ReferralBinding {
  inviteeUserId: string;
  inviterUserId: string;
  code: string;
  createdAt: string;
}

// ReferralCommission 是一笔充值订单产生的推广返佣；PaymentOrderID 唯一，保证同一订单只返佣一次。

export interface ReferralCommission {
  id: string;
  inviterUserId: string;
  inviteeUserId: string;
  paymentOrderId: string;
  orderAmountFen: number;
  orderCreditsMicrocredits: number;
  rateBasisPoints: number;
  commissionMicrocredits: number;
  ledgerEntryId: string;
  createdAt: string;
}
