// 由 backend/internal/model 下的 Go 源码逐文件迁移而来。
// DefaultUserGroupCode 是未分配分组用户的归属；该分组不能删除。

export const defaultUserGroupCode = "default";

// 计价货币：credits 表示价格直接以积分配置；USD/CNY 表示价格以货币配置，
// 下单时按用户分组的「1 单位货币 = N 积分」换算。

export const priceCurrencyCredits = "credits";
export const priceCurrencyUsd = "usd";
export const priceCurrencyCny = "cny";

// 用户端分组徽章外观；none 表示不展示徽章。

export const userGroupBadgeNone = "none";
export const userGroupBadgeVip = "vip";
export const userGroupBadgeSvip = "svip";

// UserGroup 是用户分组：统一折扣倍率、货币兑换积分比例和可见渠道范围。
// RatioBasisPoints 10000 = 1.0（不打折），8000 = 8 折。
// PointsPerUSD/PointsPerCNY 以微积分（1 积分 = 1_000_000）表示 1 单位货币可兑换的积分。

export interface UserGroup {
  id: string;
  code: string;
  name: string;
  description: string;
  badgeLabel: string;
  badgeStyle: string;
  sortOrder: number;
  ratioBasisPoints: number;
  pointsPerUsdMicrocredits: number;
  pointsPerCnyMicrocredits: number;
  allChannels: boolean;
  modelOverridesJson?: string;
  createdAt: string;
  updatedAt: string;
}

// UserGroupChannel 绑定分组可使用的系统渠道；AllChannels 为 true 时不读取本表。

export interface UserGroupChannel {
  groupId: string;
  channelId: string;
  createdAt: string;
}

// UserGroupModelOverride 是分组内单个模型的倍率与兑换比例；0 表示沿用分组默认值。
// ModelKey 匹配渠道模型标识或前台模型编码。

export interface UserGroupModelOverride {
  modelKey: string;
  ratioBasisPoints: number;
  pointsPerUsdMicrocredits: number;
  pointsPerCnyMicrocredits: number;
}
