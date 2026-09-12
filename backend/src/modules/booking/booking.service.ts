import { AppError } from "../../common/errors";
import { AsyncMutex } from "../../common/mutex";
import { logger } from "../../common/logger";
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
import type { Booking, Member, MemberLevel, RecoveryRecord } from "./booking.types";

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
  /**
   * 所有写操作共用一把锁：下单的"查重叠-扣款-建单"、取消的"查状态-退款-标记"
   * 以及余额的读-改-写都必须串行，否则并发请求会交错执行导致超卖或重复退款。
   */
  private readonly writeLock = new AsyncMutex();

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
    return this.writeLock.run(async () => {
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
    });
  }

  async updateRoom(id: string, input: { name?: unknown; capacity?: unknown; facilities?: unknown; pricePerHour?: unknown }) {
    return this.writeLock.run(async () => {
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
    });
  }

  async deleteRoom(id: string) {
    return this.writeLock.run(async () => {
      const room = await this.store.getRoom(id);
      if (!room) throw new AppError(404, "包厢不存在或已被删除");
      const bookings = await this.store.listBookings();
      if (bookings.some((booking) => booking.roomId === id && booking.status === "active")) {
        throw new AppError(409, `包厢「${room.name}」还有进行中的预约，请先取消相关预约`);
      }
      await this.store.deleteRoom(id);
      return { deleted: true };
    });
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
    return this.writeLock.run(async () => {
      const name = requireText(input.name, "会员姓名");
      const level = this.parseLevel(input.level);
      const phone = typeof input.phone === "string" ? input.phone.trim() : "";
      const members = await this.store.listMembers();
      if (phone && members.some((member) => member.phone === phone)) {
        throw new AppError(409, `手机号 ${phone} 已注册会员`);
      }
      return this.store.createMember({ name, phone, level, balance: 0, points: 0 });
    });
  }

  async updateMember(id: string, input: { name?: unknown; phone?: unknown; level?: unknown }) {
    return this.writeLock.run(async () => {
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
    });
  }

  async deleteMember(id: string) {
    return this.writeLock.run(async () => {
      const member = await this.store.getMember(id);
      if (!member) throw new AppError(404, "会员不存在或已被删除");
      const bookings = await this.store.listBookings();
      if (bookings.some((booking) => booking.memberId === id && booking.status === "active")) {
        throw new AppError(409, `会员「${member.name}」还有进行中的预约，请先取消相关预约`);
      }
      await this.store.deleteMember(id);
      return { deleted: true };
    });
  }

  async recharge(id: string, value: unknown) {
    return this.writeLock.run(async () => {
      const member = await this.store.getMember(id);
      if (!member) throw new AppError(404, "会员不存在或已被删除");
      const amount = requireAmount(value, "充值金额");
      const balance = round2(member.balance + amount);
      const updated = await this.store.updateMember(id, { balance });
      try {
        await this.store.createTransaction({
          memberId: member.id,
          memberName: member.name,
          type: "recharge",
          amount,
          balanceAfter: balance,
          note: `充值 ¥${amount.toFixed(2)}`,
        });
      } catch (error) {
        await this.compensate({
          operation: "recharge",
          cause: `记录充值流水失败：${(error as Error).message}`,
          payload: { memberId: member.id, memberName: member.name, amount, expectedBalance: member.balance },
          steps: [{ label: "恢复会员余额", run: () => this.restoreMemberSnapshot(member) }],
        });
        throw new AppError(500, "充值失败：记录流水时出现错误，已自动回滚，余额未变化");
      }
      return updated;
    });
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
    return this.writeLock.run(async () => {
      const roomId = requireText(input.roomId, "包厢");
      const memberId = requireText(input.memberId, "会员");
      const date = this.parseDate(input.date);
      const startHour = this.parseHour(input.startHour, "开始时间");
      const hours = this.parseDuration(input.hours);
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

      // 扣款之后的任一步骤失败都必须整体回滚：删除可能已写入的预约、
      // 按操作前快照恢复会员余额和积分，保证不会留下消费流水或有效预约。
      // 存储层保证单步操作原子（见 FileStore.mutate），因此失败时的状态是确定的。
      let booking: Booking;
      try {
        booking = await this.store.createBooking({
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
      } catch (error) {
        await this.compensate({
          operation: "createBooking",
          cause: `写入预约记录失败：${(error as Error).message}`,
          payload: {
            memberId: member.id,
            memberName: member.name,
            expectedBalance: member.balance,
            expectedPoints: member.points,
            deductedAmount: amount,
            pointsEarned,
            roomId: room.id,
            roomName: room.name,
            date,
            startHour,
            endHour,
          },
          steps: [{ label: "恢复会员余额和积分", run: () => this.restoreMemberSnapshot(member) }],
        });
        throw new AppError(500, "预约失败：写入预约记录时出现错误，系统已自动回滚，未产生扣款");
      }

      try {
        await this.store.createTransaction({
          memberId: member.id,
          memberName: member.name,
          type: "payment",
          amount,
          balanceAfter: balance,
          note: `预约「${room.name}」${date} ${startHour}:00-${endHour}:00`,
        });
      } catch (error) {
        await this.compensate({
          operation: "createBooking",
          cause: `记录消费流水失败：${(error as Error).message}`,
          payload: {
            memberId: member.id,
            memberName: member.name,
            expectedBalance: member.balance,
            expectedPoints: member.points,
            deductedAmount: amount,
            pointsEarned,
            bookingId: booking.id,
            roomId: room.id,
            roomName: room.name,
            date,
            startHour,
            endHour,
          },
          steps: [
            {
              label: "删除已创建的预约",
              run: async () => {
                const removed = await this.store.deleteBooking(booking.id);
                if (!removed) throw new Error(`预约 ${booking.id} 不存在，无法删除`);
              },
            },
            { label: "恢复会员余额和积分", run: () => this.restoreMemberSnapshot(member) },
          ],
        });
        throw new AppError(500, "预约失败：记录消费流水时出现错误，系统已自动回滚，未产生扣款");
      }

      return booking;
    });
  }

  async cancelBooking(id: string) {
    return this.writeLock.run(async () => {
      const booking = await this.store.getBooking(id);
      if (!booking) throw new AppError(404, "预约记录不存在或已被删除");
      if (booking.status === "cancelled") {
        throw new AppError(400, "该预约已取消，请勿重复操作");
      }

      // 先标记取消再退款：若退款中途失败，恢复为进行中并收回已退款项，
      // 保证同一预约的退款要么完整发生一次，要么完全不发生。
      const cancelled = await this.store.updateBooking(id, {
        status: "cancelled",
        cancelledAt: new Date().toISOString(),
      });

      const member = await this.store.getMember(booking.memberId);
      if (member) {
        let refunded = false;
        try {
          const balance = round2(member.balance + booking.amount);
          const points = Math.max(0, member.points - booking.pointsEarned);
          await this.store.updateMember(member.id, { balance, points });
          refunded = true;
          await this.store.createTransaction({
            memberId: member.id,
            memberName: member.name,
            type: "refund",
            amount: booking.amount,
            balanceAfter: balance,
            note: `取消预约「${booking.roomName}」${booking.date} ${booking.startHour}:00-${booking.endHour}:00，退款 ¥${booking.amount.toFixed(2)}`,
          });
        } catch (error) {
          const steps: { label: string; run: () => Promise<unknown> }[] = [];
          if (refunded) {
            steps.push({ label: "收回已退款项并恢复积分", run: () => this.restoreMemberSnapshot(member) });
          }
          steps.push({
            label: "恢复预约为进行中",
            run: async () => {
              const restored = await this.store.updateBooking(id, { status: "active", cancelledAt: null });
              if (!restored) throw new Error(`预约 ${id} 不存在，无法恢复`);
            },
          });
          await this.compensate({
            operation: "cancelBooking",
            cause: `取消退款失败：${(error as Error).message}`,
            payload: {
              bookingId: id,
              memberId: member.id,
              memberName: member.name,
              refundAmount: booking.amount,
              pointsEarned: booking.pointsEarned,
              expectedMemberBalance: member.balance,
              expectedMemberPoints: member.points,
              expectedBookingStatus: "active",
            },
            steps,
          });
          throw new AppError(500, "取消失败：退款过程中出现错误，已自动回滚，预约仍为进行中");
        }
      }

      return cancelled;
    });
  }

  /** 把会员余额和积分恢复到操作前快照；会员不存在时抛错（视为恢复失败） */
  private async restoreMemberSnapshot(member: Member): Promise<void> {
    const restored = await this.store.updateMember(member.id, { balance: member.balance, points: member.points });
    if (!restored) throw new Error(`会员 ${member.id} 不存在，无法恢复`);
  }

  /**
   * 执行补偿：逐步尽力恢复（某步失败不中断后续步骤），全部成功则静默返回；
   * 任一步失败则写入可追踪的恢复记录，并抛出带 ROLLBACK_FAILED 错误码的
   * 明确错误——此时系统状态不确定，绝不能按普通业务失败处理。
   */
  private async compensate(options: {
    operation: RecoveryRecord["operation"];
    cause: string;
    payload: Record<string, unknown>;
    steps: { label: string; run: () => Promise<unknown> }[];
  }): Promise<void> {
    const failures: string[] = [];
    for (const step of options.steps) {
      try {
        await step.run();
      } catch (error) {
        const detail = `${step.label}失败（${(error as Error).message}）`;
        failures.push(detail);
        logger.error(`compensation step failed [${options.operation}]: ${detail}`);
      }
    }
    if (failures.length === 0) return;

    let recordId: string | null = null;
    try {
      const record = await this.store.createRecoveryRecord({
        operation: options.operation,
        status: "pending",
        reason: options.cause,
        failures,
        payload: options.payload,
        resolvedAt: null,
      });
      recordId = record.id;
    } catch (error) {
      // 恢复记录也写不进去：日志兜底保留全部快照，接口仍明确报回滚失败
      logger.error(`failed to persist recovery record: ${(error as Error).message}; payload=${JSON.stringify(options.payload)}`);
    }
    const tracking = recordId ? `恢复记录 ${recordId}` : "恢复记录写入失败（关键数据详见服务日志）";
    throw new AppError(
      500,
      `操作失败且自动回滚未完成：${failures.join("；")}。系统状态可能不一致，${tracking}，请立即联系管理员人工处理`,
      "ROLLBACK_FAILED",
    );
  }

  /* ------------------------------ 恢复记录 ------------------------------ */

  async listRecoveries(status?: unknown) {
    const records = await this.store.listRecoveryRecords();
    return records
      .filter((record) => (status === "pending" || status === "resolved" ? record.status === status : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async resolveRecovery(id: string) {
    return this.writeLock.run(async () => {
      const record = await this.store.getRecoveryRecord(id);
      if (!record) throw new AppError(404, "恢复记录不存在");
      if (record.status === "resolved") {
        throw new AppError(400, "该恢复记录已处理完毕，请勿重复操作");
      }
      return this.store.updateRecoveryRecord(id, {
        status: "resolved",
        resolvedAt: new Date().toISOString(),
      });
    });
  }

  private parseDate(value: unknown): string {
    if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
      throw new AppError(400, "预约日期格式应为 YYYY-MM-DD");
    }
    // new Date("2026-02-30") 会自动进位到 3 月 2 日而不是报错，
    // 因此按年月日分量重建并逐一比对，拒绝 2 月 30 日这类不存在的日期。
    const [year, month, day] = value.split("-").map(Number);
    const time = new Date(year, month - 1, day);
    if (time.getFullYear() !== year || time.getMonth() !== month - 1 || time.getDate() !== day) {
      throw new AppError(400, `日期 ${value} 不存在，请选择有效日期`);
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

  private parseDuration(value: unknown): number {
    const hours = Number(value);
    if (!Number.isInteger(hours) || hours < 1) {
      throw new AppError(400, "预约时长至少为 1 小时");
    }
    const maxHours = BUSINESS_CLOSE_HOUR - BUSINESS_OPEN_HOUR;
    if (hours > maxHours) {
      throw new AppError(400, `预约时长不能超过 ${maxHours} 小时`);
    }
    return hours;
  }

  /* -------------------------------- 流水 -------------------------------- */

  async listTransactions(memberId?: unknown) {
    const transactions = await this.store.listTransactions();
    return transactions
      .filter((txn) => (typeof memberId === "string" && memberId ? txn.memberId === memberId : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
