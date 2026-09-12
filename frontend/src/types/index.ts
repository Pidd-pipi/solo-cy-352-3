export interface FeatureItem {
  id: number;
  title: string;
  description: string;
  status: string;
  metric: string;
}

export interface KpiItem {
  label: string;
  value: string;
  trend: string;
  tone: string;
}

export interface OperationRecord {
  key: string;
  name: string;
  owner: string;
  status: string;
  metric: string;
  priority: string;
}

export interface OverviewResponse {
  appName: string;
  appCode: string;
  description: string;
  features: FeatureItem[];
  kpis: KpiItem[];
  records: OperationRecord[];
}

/* ------------------------- 包厢预约与会员储值 ------------------------- */

export interface RoomItem {
  id: string;
  name: string;
  capacity: number;
  facilities: string[];
  pricePerHour: number;
  createdAt: string;
}

export type MemberLevel = "normal" | "silver" | "gold" | "platinum";

export interface MemberItem {
  id: string;
  name: string;
  phone: string;
  level: MemberLevel;
  balance: number;
  points: number;
  createdAt: string;
}

export interface BookingItem {
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
  status: "active" | "cancelled";
  createdAt: string;
  cancelledAt: string | null;
}

export interface WalletTxn {
  id: string;
  memberId: string;
  memberName: string;
  type: "recharge" | "payment" | "refund";
  amount: number;
  balanceAfter: number;
  note: string;
  createdAt: string;
}

export interface MemberLevelInfo {
  code: MemberLevel;
  name: string;
  discount: number;
}

export interface BookingMeta {
  levels: MemberLevelInfo[];
  facilities: string[];
  openHour: number;
  closeHour: number;
  pointsPerYuan: number;
  storeKind: "mongo" | "file";
}
