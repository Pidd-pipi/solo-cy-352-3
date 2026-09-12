/**
 * 并发竞态专项测试：用带 I/O 延迟的存储（每个操作让出事件循环，模拟 MongoDB）
 * 直接驱动 BookingService，确定性暴露"检查-扣款-写入"交错执行的竞态。
 * 如果移除服务层的写锁，本测试会失败。
 *
 * 运行方式：cd backend && npx tsx test/concurrency.race.ts
 */
import { BookingService } from "../src/modules/booking/booking.service";
import type { BookingStore } from "../src/modules/booking/booking.store";
import type { Booking, Member, Room, WalletTransaction } from "../src/modules/booking/booking.types";

function assert(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error(detail);
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** 每个操作都先让出事件循环，模拟真实数据库的 I/O 延迟 */
class SlowStore implements BookingStore {
  readonly kind = "file" as const;
  private rooms: Room[] = [];
  private members: Member[] = [];
  private bookings: Booking[] = [];
  private transactions: WalletTransaction[] = [];
  private seq = 0;

  private stamp<T extends object>(input: T): T & { id: string; createdAt: string } {
    this.seq += 1;
    return { ...input, id: `slow-${this.seq}`, createdAt: new Date().toISOString() };
  }

  async listRooms() { await tick(); return [...this.rooms]; }
  async getRoom(id: string) { await tick(); return this.rooms.find((r) => r.id === id) ?? null; }
  async createRoom(input: Omit<Room, "id" | "createdAt">) {
    await tick();
    const room = this.stamp(input);
    this.rooms.push(room);
    return room;
  }
  async updateRoom(id: string, patch: Partial<Omit<Room, "id">>) {
    await tick();
    const i = this.rooms.findIndex((r) => r.id === id);
    if (i < 0) return null;
    this.rooms[i] = { ...this.rooms[i], ...patch, id };
    return this.rooms[i];
  }
  async deleteRoom(id: string) {
    await tick();
    const before = this.rooms.length;
    this.rooms = this.rooms.filter((r) => r.id !== id);
    return this.rooms.length < before;
  }

  async listMembers() { await tick(); return [...this.members]; }
  async getMember(id: string) { await tick(); return this.members.find((m) => m.id === id) ?? null; }
  async createMember(input: Omit<Member, "id" | "createdAt">) {
    await tick();
    const member = this.stamp(input);
    this.members.push(member);
    return member;
  }
  async updateMember(id: string, patch: Partial<Omit<Member, "id">>) {
    await tick();
    const i = this.members.findIndex((m) => m.id === id);
    if (i < 0) return null;
    this.members[i] = { ...this.members[i], ...patch, id };
    return this.members[i];
  }
  async deleteMember(id: string) {
    await tick();
    const before = this.members.length;
    this.members = this.members.filter((m) => m.id !== id);
    return this.members.length < before;
  }

  async listBookings() { await tick(); return [...this.bookings]; }
  async getBooking(id: string) { await tick(); return this.bookings.find((b) => b.id === id) ?? null; }
  async createBooking(input: Omit<Booking, "id" | "createdAt">) {
    await tick();
    const booking = this.stamp(input);
    this.bookings.push(booking);
    return booking;
  }
  async updateBooking(id: string, patch: Partial<Omit<Booking, "id">>) {
    await tick();
    const i = this.bookings.findIndex((b) => b.id === id);
    if (i < 0) return null;
    this.bookings[i] = { ...this.bookings[i], ...patch, id };
    return this.bookings[i];
  }
  async deleteBooking(id: string) {
    await tick();
    const before = this.bookings.length;
    this.bookings = this.bookings.filter((b) => b.id !== id);
    return this.bookings.length < before;
  }

  async listTransactions() { await tick(); return [...this.transactions]; }
  async createTransaction(input: Omit<WalletTransaction, "id" | "createdAt">) {
    await tick();
    const txn = this.stamp(input);
    this.transactions.push(txn);
    return txn;
  }
}

async function main(): Promise<void> {
  const store = new SlowStore();
  const service = new BookingService(store);

  const room = await service.createRoom({ name: "竞态包厢", capacity: 6, facilities: [], pricePerHour: 100 });
  const member = await service.createMember({ name: "竞态会员", phone: "", level: "normal" });
  await service.recharge(member.id, 1000);

  // 场景 1：8 个请求并发抢同一时段（100/小时 × 2h = 200）
  const CONCURRENT = 8;
  const created = await Promise.all(
    Array.from({ length: CONCURRENT }, () =>
      service
        .createBooking({ roomId: room.id, memberId: member.id, date: "2027-05-01", startHour: 19, hours: 2 })
        .then((booking) => ({ ok: true as const, booking }))
        .catch((error: Error) => ({ ok: false as const, error })),
    ),
  );
  const winners = created.filter((r) => r.ok);
  const losers = created.filter((r) => !r.ok);
  assert(winners.length === 1, `并发下单应只有 1 笔成功，实际 ${winners.length} 笔`);
  assert(
    losers.length === CONCURRENT - 1 && losers.every((r) => !r.ok && r.error.message.includes("时段不能重叠")),
    `其余 ${CONCURRENT - 1} 笔应因重叠被拒绝，实际：${losers.map((r) => (!r.ok ? r.error.message : "?")).join(" | ")}`,
  );

  const bookings = await service.listBookings({});
  const activeCount = bookings.filter((b) => b.status === "active").length;
  assert(activeCount === 1, `有效预约应为 1 笔，实际 ${activeCount} 笔`);

  const afterPay = (await service.listMembers()).find((m) => m.id === member.id)!;
  assert(afterPay.balance === 800, `只应扣款一次（1000-200=800），实际余额 ${afterPay.balance}`);
  assert(afterPay.points === 200, `积分应只累计一次 200，实际 ${afterPay.points}`);
  const payments = (await service.listTransactions()).filter((t) => t.type === "payment");
  assert(payments.length === 1, `支付流水应只有 1 条，实际 ${payments.length} 条`);
  console.log("✅ 并发下单：同一时段只成功一笔、只扣款一次（带 I/O 延迟的存储）");

  // 场景 2：8 个请求并发取消同一预约
  const winnerId = winners[0].ok ? winners[0].booking.id : "";
  const cancelled = await Promise.all(
    Array.from({ length: CONCURRENT }, () =>
      service
        .cancelBooking(winnerId)
        .then(() => ({ ok: true as const }))
        .catch((error: Error) => ({ ok: false as const, error })),
    ),
  );
  const cancelWins = cancelled.filter((r) => r.ok);
  assert(cancelWins.length === 1, `并发取消应只有 1 次成功，实际 ${cancelWins.length} 次`);

  const afterRefund = (await service.listMembers()).find((m) => m.id === member.id)!;
  assert(afterRefund.balance === 1000, `只应退款一次（回到 1000），实际余额 ${afterRefund.balance}`);
  assert(afterRefund.points === 0, `积分应只扣回一次（回到 0），实际 ${afterRefund.points}`);
  const refunds = (await service.listTransactions()).filter((t) => t.type === "refund");
  assert(refunds.length === 1, `退款流水应只有 1 条，实际 ${refunds.length} 条`);
  console.log("✅ 并发取消：同一预约只退款一次，余额积分不重复返还");

  console.log("\n2/2 并发竞态测试通过");
}

main().catch((error) => {
  console.error(`❌ 并发竞态测试失败：${(error as Error).message}`);
  process.exit(1);
});
