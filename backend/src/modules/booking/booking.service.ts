import { AppError } from "../../common/errors";
import type { BookingStore } from "./booking.store";
import {
  BUSINESS_CLOSE_HOUR,
  BUSINESS_OPEN_HOUR,
  FACILITY_OPTIONS,
  MEMBER_LEVELS,
  POINTS_PER_YUAN,
  levelInfo,
  round2,
} from "./booking.types";
import type { Booking, MemberLevel } from "./booking.types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function todayString(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError(400, `${field}不能为空`);
  }
  return value.trim();
}

function requireAmount(value: unknown, field: string, max = 100000): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError(400, `${field}必须大于 0`);
  }
  if (amount > max) {
    throw new AppError(400, `${field}不能超过 ${max}`);
  }
  return round2(amount);
}

export class BookingService {
  constructor(private readonly store: BookingStore) {}

  getMeta() {
    return {
      levels: MEMBER_LEVELS,
      facilities: FACILITY_OPTIONS,
      openHour: BUSINESS_OPEN_HOUR,
      closeHour: BUSINESS_CLOSE_HOUR,
      pointsPerYuan: POINTS_PER_YUAN,
      storeKind: this.store.kind,
    };
  }

  /* -------------------------------- 包厢 -------------------------------- */

  listRooms() {
    return this.store.listRooms();
  }

  async createRoom(input: { name?: unknown; capacity?: unknown; facilities?: unknown; pricePerHour?: unknown }) {
    const name = requireText(input.name, "包厢名称");
    const rooms = await this.store.listRooms();
    if (rooms.some((room) => room.name === name)) {
      throw new AppError(409, `包厢「${name}」已存在，请换一个名称`);
    }
    return this.store.createRoom({
      name,
      capacity: this.parseCapacity(input.capacity),
      facilities: this.parseFacilities(input.facilities),
      pricePerHour: requireAmount(input.pricePerHour, "每小时价格", 10000),
    });
  }

  async updateRoom(id: string, input: { name?: unknown; capacity?: unknown; facilities?: unknown; pricePerHour?: unknown }) {
    const room = await this.store.getRoom(id);
    if (!room) throw new AppError(404, "包厢不存在或已被删除");
    const name = requireText(input.name, "包厢名称");
    const rooms = await this.store.listRooms();
    if (rooms.some((item) => item.id !== id && item.name === name)) {
      throw new AppError(409, `包厢「${name}」已存在，请换一个名称`);
    }
    return this.store.updateRoom(id, {
      name,
      capacity: this.parseCapacity(input.capacity),
      facilities: this.parseFacilities(input.facilities),
      pricePerHour: requireAmount(input.pricePerHour, "每小时价格", 10000),
    });
  }

  async deleteRoom(id: string) {
    const room = await this.store.getRoom(id);
    if (!room) throw new AppError(404, "包厢不存在或已被删除");
    const bookings = await this.store.listBookings();
    if (bookings.some((booking) => booking.roomId === id && booking.status === "active")) {
      throw new AppError(409, `包厢「${room.name}」还有进行中的预约，请先取消相关预约`);
    }
    await this.store.deleteRoom(id);
    return { deleted: true };
  }

  private parseCapacity(value: unknown): number {
    const capacity = Number(value);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 50) {
      throw new AppError(400, "容纳人数必须是 1-50 的整数");
    }
    return capacity;
  }

  private parseFacilities(value: unknown): string[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      throw new AppError(400, "设施列表格式不正确");
    }
    const facilities = value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
    return [...new Set(facilities)];
  }

  /* -------------------------------- 会员 -------------------------------- */

  listMembers() {
    return this.store.listMembers();
  }

  async createMember(input: { name?: unknown; phone?: unknown; level?: unknown }) {
    const name = requireText(input.name, "会员姓名");
    const level = this.parseLevel(input.level);
    const phone = typeof input.phone === "string" ? input.phone.trim() : "";
    const members = await this.store.listMembers();
    if (phone && members.some((member) => member.phone === phone)) {
      throw new AppError(409, `手机号 ${phone} 已注册会员`);
    }
    return this.store.createMember({ name, phone, level, balance: 0, points: 0 });
  }

  async updateMember(id: string, input: { name?: unknown; phone?: unknown; level?: unknown }) {
    const member = await this.store.getMember(id);
    if (!member) throw new AppError(404, "会员不存在或已被删除");
    const name = requireText(input.name, "会员姓名");
    const level = this.parseLevel(input.level);
    const phone = typeof input.phone === "string" ? input.phone.trim() : "";
    const members = await this.store.listMembers();
    if (phone && members.some((item) => item.id !== id && item.phone === phone)) {
      throw new AppError(409, `手机号 ${phone} 已被其他会员使用`);
    }
    return this.store.updateMember(id, { name, phone, level });
  }

  async deleteMember(id: string) {
    const member = await this.store.getMember(id);
    if (!member) throw new AppError(404, "会员不存在或已被删除");
    const bookings = await this.store.listBookings();
    if (bookings.some((booking) => booking.memberId === id && booking.status === "active")) {
      throw new AppError(409, `会员「${member.name}」还有进行中的预约，请先取消相关预约`);
    }
    await this.store.deleteMember(id);
    return { deleted: true };
  }

  async recharge(id: string, value: unknown) {
    const member = await this.store.getMember(id);
    if (!member) throw new AppError(404, "会员不存在或已被删除");
    const amount = requireAmount(value, "充值金额");
    const balance = round2(member.balance + amount);
    const updated = await this.store.updateMember(id, { balance });
    await this.store.createTransaction({
      memberId: member.id,
      memberName: member.name,
      type: "recharge",
      amount,
      balanceAfter: balance,
      note: `充值 ¥${amount.toFixed(2)}`,
    });
    return updated;
  }

  private parseLevel(value: unknown): MemberLevel {
    const level = MEMBER_LEVELS.find((item) => item.code === value);
    if (!level) {
      throw new AppError(400, "会员等级不正确");
    }
    return level.code;
  }

  /* -------------------------------- 预约 -------------------------------- */

  async listBookings(query: { roomId?: unknown; date?: unknown; status?: unknown }) {
    const bookings = await this.store.listBookings();
    return bookings
      .filter((booking) => (typeof query.roomId === "string" && query.roomId ? booking.roomId === query.roomId : true))
      .filter((booking) => (typeof query.date === "string" && query.date ? booking.date === query.date : true))
      .filter((booking) => (query.status === "active" || query.status === "cancelled" ? booking.status === query.status : true))
      .sort((a, b) => `${a.date} ${a.startHour}`.localeCompare(`${b.date} ${b.startHour}`));
  }

  async createBooking(input: {
    roomId?: unknown;
    memberId?: unknown;
    date?: unknown;
    startHour?: unknown;
    hours?: unknown;
  }): Promise<Booking> {
    const roomId = requireText(input.roomId, "包厢");
    const memberId = requireText(input.memberId, "会员");
    const date = this.parseDate(input.date);
    const startHour = this.parseHour(input.startHour, "开始时间");
    const hours = this.parseHour(input.hours, "预约时长");
    const endHour = startHour + hours;

    if (startHour < BUSINESS_OPEN_HOUR || startHour >= BUSINESS_CLOSE_HOUR) {
      throw new AppError(400, `开始时间需在 ${BUSINESS_OPEN_HOUR}:00 - ${BUSINESS_CLOSE_HOUR - 1}:00 之间`);
    }
    if (endHour > BUSINESS_CLOSE_HOUR) {
      throw new AppError(400, `营业时间为 ${BUSINESS_OPEN_HOUR}:00 - ${BUSINESS_CLOSE_HOUR}:00，最晚可预约到 ${BUSINESS_CLOSE_HOUR}:00 结束`);
    }

    const today = todayString();
    if (date < today) {
      throw new AppError(400, "不能预约已经过去的日期");
    }
    if (date === today && endHour <= new Date().getHours()) {
      throw new AppError(400, "该时段已经结束，请选择更晚的时间");
    }

    const room = await this.store.getRoom(roomId);
    if (!room) throw new AppError(404, "包厢不存在或已被删除");
    const member = await this.store.getMember(memberId);
    if (!member) throw new AppError(404, "会员不存在或已被删除");

    const bookings = await this.store.listBookings();
    const conflict = bookings.find(
      (booking) =>
        booking.roomId === roomId &&
        booking.date === date &&
        booking.status === "active" &&
        startHour < booking.endHour &&
        endHour > booking.startHour,
    );
    if (conflict) {
      throw new AppError(
        409,
        `预约失败：「${room.name}」${date} ${conflict.startHour}:00-${conflict.endHour}:00 已被 ${conflict.memberName} 预约，同一包厢的时段不能重叠`,
      );
    }

    const { discount } = levelInfo(member.level);
    const originalAmount = round2(room.pricePerHour * hours);
    const amount = round2(originalAmount * discount);
    if (member.balance < amount) {
      const shortfall = round2(amount - member.balance);
      throw new AppError(400, `余额不足：本次需支付 ¥${amount.toFixed(2)}，当前余额 ¥${member.balance.toFixed(2)}，还差 ¥${shortfall.toFixed(2)}，请先充值`);
    }

    const pointsEarned = Math.floor(amount * POINTS_PER_YUAN);
    const balance = round2(member.balance - amount);
    await this.store.updateMember(member.id, { balance, points: member.points + pointsEarned });

    const booking = await this.store.createBooking({
      roomId: room.id,
      roomName: room.name,
      memberId: member.id,
      memberName: member.name,
      date,
      startHour,
      hours,
      endHour,
      originalAmount,
      discount,
      amount,
      pointsEarned,
      status: "active",
      cancelledAt: null,
    });

    await this.store.createTransaction({
      memberId: member.id,
      memberName: member.name,
      type: "payment",
      amount,
      balanceAfter: balance,
      note: `预约「${room.name}」${date} ${startHour}:00-${endHour}:00`,
    });

    return booking;
  }

  async cancelBooking(id: string) {
    const booking = await this.store.getBooking(id);
    if (!booking) throw new AppError(404, "预约记录不存在或已被删除");
    if (booking.status === "cancelled") {
      throw new AppError(400, "该预约已取消，请勿重复操作");
    }

    const member = await this.store.getMember(booking.memberId);
    if (member) {
      const balance = round2(member.balance + booking.amount);
      const points = Math.max(0, member.points - booking.pointsEarned);
      await this.store.updateMember(member.id, { balance, points });
      await this.store.createTransaction({
        memberId: member.id,
        memberName: member.name,
        type: "refund",
        amount: booking.amount,
        balanceAfter: balance,
        note: `取消预约「${booking.roomName}」${booking.date} ${booking.startHour}:00-${booking.endHour}:00，退款 ¥${booking.amount.toFixed(2)}`,
      });
    }

    const cancelled = await this.store.updateBooking(id, {
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
    });
    return cancelled;
  }

  private parseDate(value: unknown): string {
    if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
      throw new AppError(400, "预约日期格式应为 YYYY-MM-DD");
    }
    const time = new Date(`${value}T00:00:00`);
    if (Number.isNaN(time.getTime())) {
      throw new AppError(400, "预约日期不存在");
    }
    return value;
  }

  private parseHour(value: unknown, field: string): number {
    const hour = Number(value);
    if (!Number.isInteger(hour) || hour < 0 || hour > 24) {
      throw new AppError(400, `${field}不正确`);
    }
    return hour;
  }

  /* -------------------------------- 流水 -------------------------------- */

  async listTransactions(memberId?: unknown) {
    const transactions = await this.store.listTransactions();
    return transactions
      .filter((txn) => (typeof memberId === "string" && memberId ? txn.memberId === memberId : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
