export type MemberLevel = "normal" | "silver" | "gold" | "platinum";

export interface MemberLevelInfo {
  code: MemberLevel;
  name: string;
  discount: number;
}

export const MEMBER_LEVELS: MemberLevelInfo[] = [
  { code: "normal", name: "普通会员", discount: 1 },
  { code: "silver", name: "白银会员", discount: 0.95 },
  { code: "gold", name: "黄金会员", discount: 0.9 },
  { code: "platinum", name: "铂金会员", discount: 0.85 },
];

export const FACILITY_OPTIONS = [
  "专业音响",
  "高清投影",
  "独立卫生间",
  "桌游架",
  "游戏机",
  "迷你吧台",
  "空调",
  "无线充电",
];

export const BUSINESS_OPEN_HOUR = 10;
export const BUSINESS_CLOSE_HOUR = 23;
export const POINTS_PER_YUAN = 1;

export interface Room {
  id: string;
  name: string;
  capacity: number;
  facilities: string[];
  pricePerHour: number;
  createdAt: string;
}

export interface Member {
  id: string;
  name: string;
  phone: string;
  level: MemberLevel;
  balance: number;
  points: number;
  createdAt: string;
}

export type BookingStatus = "active" | "cancelled";

export interface Booking {
  id: string;
  roomId: string;
  roomName: string;
  memberId: string;
  memberName: string;
  date: string;
  startHour: number;
  hours: number;
  endHour: number;
  originalAmount: number;
  discount: number;
  amount: number;
  pointsEarned: number;
  status: BookingStatus;
  createdAt: string;
  cancelledAt: string | null;
}

export type TransactionType = "recharge" | "payment" | "refund";

export interface WalletTransaction {
  id: string;
  memberId: string;
  memberName: string;
  type: TransactionType;
  amount: number;
  balanceAfter: number;
  note: string;
  createdAt: string;
}

export function levelInfo(level: MemberLevel): MemberLevelInfo {
  return MEMBER_LEVELS.find((item) => item.code === level) ?? MEMBER_LEVELS[0];
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
