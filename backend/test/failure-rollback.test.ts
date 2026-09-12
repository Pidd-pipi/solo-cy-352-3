/**
 * 失败回滚专项测试：用可注入故障的存储验证——创建预约/取消/充值的任一步骤
 * 失败时，会员余额和积分恢复到操作前，不留下消费流水或有效预约，
 * 且不影响其他预约。同时验证 FileStore 单步操作的原子性。
 *
 * 运行方式：cd backend && npx tsx test/failure-rollback.test.ts
 */
import fs from "fs";
import os from "os";
import path from "path";
import { BookingService } from "../src/modules/booking/booking.service";
import { FileStore } from "../src/modules/booking/booking.store";
import type { BookingStore } from "../src/modules/booking/booking.store";
import type { Booking, Member, Room, WalletTransaction } from "../src/modules/booking/booking.types";

function assert(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error(detail);
}

async function assertRejects(fn: () => Promise<unknown>, messagePart: string): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const message = (error as Error).message;
    assert(message.includes(messagePart), `错误信息应包含「${messagePart}」，实际：${message}`);
    return;
  }
  throw new Error(`应失败并回滚，但实际成功了`);
}

/** 可注入故障的内存存储：failOn 中的方法名被调用时直接抛错 */
class FaultyStore implements BookingStore {
  readonly kind = "file" as const;
  readonly failOn = new Set<string>();
  private rooms: Room[] = [];
  private members: Member[] = [];
  private bookings: Booking[] = [];
  private transactions: WalletTransaction[] = [];
  private seq = 0;

  private boom(method: string) {
    if (this.failOn.has(method)) throw new Error(`模拟存储故障: ${method}`);
  }

  private stamp<T extends object>(input: T): T & { id: string; createdAt: string } {
    this.seq += 1;
    return { ...input, id: `fault-${this.seq}`, createdAt: new Date().toISOString() };
  }

  async listRooms() { this.boom("listRooms"); return [...this.rooms]; }
  async getRoom(id: string) { this.boom("getRoom"); return this.rooms.find((r) => r.id === id) ?? null; }
  async createRoom(input: Omit<Room, "id" | "createdAt">) {
    this.boom("createRoom");
    const room = this.stamp(input);
    this.rooms.push(room);
    return room;
  }
  async updateRoom(id: string, patch: Partial<Omit<Room, "id">>) {
    this.boom("updateRoom");
    const i = this.rooms.findIndex((r) => r.id === id);
    if (i < 0) return null;
    this.rooms[i] = { ...this.rooms[i], ...patch, id };
    return this.rooms[i];
  }
  async deleteRoom(id: string) {
    this.boom("deleteRoom");
    const before = this.rooms.length;
    this.rooms = this.rooms.filter((r) => r.id !== id);
    return this.rooms.length < before;
  }

  async listMembers() { this.boom("listMembers"); return [...this.members]; }
  async getMember(id: string) { this.boom("getMember"); return this.members.find((m) => m.id === id) ?? null; }
  async createMember(input: Omit<Member, "id" | "createdAt">) {
    this.boom("createMember");
    const member = this.stamp(input);
    this.members.push(member);
    return member;
  }
  async updateMember(id: string, patch: Partial<Omit<Member, "id">>) {
    this.boom("updateMember");
    const i = this.members.findIndex((m) => m.id === id);
    if (i < 0) return null;
    this.members[i] = { ...this.members[i], ...patch, id };
    return this.members[i];
  }
  async deleteMember(id: string) {
    this.boom("deleteMember");
    const before = this.members.length;
    this.members = this.members.filter((m) => m.id !== id);
    return this.members.length < before;
  }

  async listBookings() { this.boom("listBookings"); return [...this.bookings]; }
  async getBooking(id: string) { this.boom("getBooking"); return this.bookings.find((b) => b.id === id) ?? null; }
  async createBooking(input: Omit<Booking, "id" | "createdAt">) {
    this.boom("createBooking");
    const booking = this.stamp(input);
    this.bookings.push(booking);
    return booking;
  }
  async updateBooking(id: string, patch: Partial<Omit<Booking, "id">>) {
    this.boom("updateBooking");
    const i = this.bookings.findIndex((b) => b.id === id);
    if (i < 0) return null;
    this.bookings[i] = { ...this.bookings[i], ...patch, id };
    return this.bookings[i];
  }
  async deleteBooking(id: string) {
    this.boom("deleteBooking");
    const before = this.bookings.length;
    this.bookings = this.bookings.filter((b) => b.id !== id);
    return this.bookings.length < before;
  }

  async listTransactions() { this.boom("listTransactions"); return [...this.transactions]; }
  async createTransaction(input: Omit<WalletTransaction, "id" | "createdAt">) {
    this.boom("createTransaction");
    const txn = this.stamp(input);
    this.transactions.push(txn);
    return txn;
  }
}

async function setup() {
  const store = new FaultyStore();
  const service = new BookingService(store);
  const room = await service.createRoom({ name: "故障测试房", capacity: 6, facilities: [], pricePerHour: 100 });
  const member = await service.createMember({ name: "故障会员", phone: "", level: "normal" });
  await service.recharge(member.id, 1000);
  return { store, service, room, member };
}

async function main(): Promise<void> {
  // 场景 1：扣款后 createBooking 失败 → 余额积分恢复、无预约无流水、时段仍可约
  {
    const { store, service, room, member } = await setup();
    store.failOn.add("createBooking");
    await assertRejects(
      () => service.createBooking({ roomId: room.id, memberId: member.id, date: "2027-06-01", startHour: 14, hours: 2 }),
      "自动回滚",
    );
    const after = (await service.listMembers()).find((m) => m.id === member.id)!;
    assert(after.balance === 1000, `余额应恢复为 1000，实际 ${after.balance}`);
    assert(after.points === 0, `积分应恢复为 0，实际 ${after.points}`);
    assert((await service.listBookings({})).length === 0, "不应留下预约记录");
    assert((await service.listTransactions()).filter((t) => t.type === "payment").length === 0, "不应留下消费流水");

    store.failOn.clear();
    const retry = await service.createBooking({ roomId: room.id, memberId: member.id, date: "2027-06-01", startHour: 14, hours: 2 });
    assert(retry.status === "active", "回滚后同一时段应能正常预约");
    console.log("✅ 建单步骤失败：余额积分恢复、无预约无流水、时段仍可约");
  }

  // 场景 2：预约已写入、createTransaction 失败 → 预约被清除、余额积分恢复
  {
    const { store, service, room, member } = await setup();
    store.failOn.add("createTransaction");
    await assertRejects(
      () => service.createBooking({ roomId: room.id, memberId: member.id, date: "2027-06-02", startHour: 14, hours: 2 }),
      "自动回滚",
    );
    const after = (await service.listMembers()).find((m) => m.id === member.id)!;
    assert(after.balance === 1000, `余额应恢复为 1000，实际 ${after.balance}`);
    assert(after.points === 0, `积分应恢复为 0，实际 ${after.points}`);
    assert((await service.listBookings({})).length === 0, "补偿应清除已写入的预约");
    assert((await service.listTransactions()).filter((t) => t.type === "payment").length === 0, "不应留下消费流水");

    store.failOn.clear();
    const retry = await service.createBooking({ roomId: room.id, memberId: member.id, date: "2027-06-02", startHour: 14, hours: 2 });
    assert(retry.status === "active", "回滚后同一时段应能正常预约");
    console.log("✅ 流水步骤失败：已写入的预约被清除、余额积分恢复");
  }

  // 场景 3：失败的预约不影响其他会员的既有预约
  {
    const { store, service, room, member } = await setup();
    const other = await service.createMember({ name: "其他会员", phone: "", level: "normal" });
    await service.recharge(other.id, 500);
    const existing = await service.createBooking({ roomId: room.id, memberId: other.id, date: "2027-06-03", startHour: 14, hours: 2 });

    store.failOn.add("createBooking");
    await assertRejects(
      () => service.createBooking({ roomId: room.id, memberId: member.id, date: "2027-06-03", startHour: 19, hours: 2 }),
      "自动回滚",
    );
    store.failOn.clear();

    // 既有预约的时段仍被占用（回滚没有误伤它）
    const overlap = await service
      .createBooking({ roomId: room.id, memberId: member.id, date: "2027-06-03", startHour: 15, hours: 1 })
      .catch((error: Error) => error);
    assert(overlap instanceof Error && overlap.message.includes("时段不能重叠"), "既有预约的时段仍应被占用");

    // 既有预约自身可正常取消退款
    const kept = await service.cancelBooking(existing.id).catch(() => null);
    assert(kept === null || kept.status === "cancelled", "既有预约应可正常取消");
    const otherAfter = (await service.listMembers()).find((m) => m.id === other.id)!;
    // 其他会员：充值 500 - 预约 200 + 取消退款 200 = 500
    assert(otherAfter.balance === 500, `其他会员取消退款后余额应为 500，实际 ${otherAfter.balance}`);
    console.log("✅ 失败回滚不影响其他预约（时段仍被占用、既有预约可正常取消）");
  }

  // 场景 4：取消时退款步骤失败 → 预约恢复进行中、不产生退款
  {
    const { store, service, room, member } = await setup();
    const booking = await service.createBooking({ roomId: room.id, memberId: member.id, date: "2027-06-04", startHour: 14, hours: 2 });
    store.failOn.add("updateMember");
    await assertRejects(() => service.cancelBooking(booking.id), "回滚");
    const after = (await service.listMembers()).find((m) => m.id === member.id)!;
    assert(after.balance === 800, `余额应保持 800，实际 ${after.balance}`);
    const kept = await service.listBookings({});
    assert(kept[0]?.status === "active", `预约应恢复为进行中，实际 ${kept[0]?.status}`);
    assert((await service.listTransactions()).filter((t) => t.type === "refund").length === 0, "不应留下退款流水");

    store.failOn.clear();
    const cancelled = await service.cancelBooking(booking.id);
    assert(cancelled?.status === "cancelled", "故障恢复后应能正常取消");
    const refunded = (await service.listMembers()).find((m) => m.id === member.id)!;
    assert(refunded.balance === 1000, `正常取消后余额应为 1000，实际 ${refunded.balance}`);
    console.log("✅ 取消时退款失败：预约恢复进行中、不产生退款，恢复后可正常取消");
  }

  // 场景 5：取消时流水步骤失败 → 收回已退款项、预约恢复进行中
  {
    const { store, service, room, member } = await setup();
    const booking = await service.createBooking({ roomId: room.id, memberId: member.id, date: "2027-06-05", startHour: 14, hours: 2 });
    store.failOn.add("createTransaction");
    await assertRejects(() => service.cancelBooking(booking.id), "回滚");
    const after = (await service.listMembers()).find((m) => m.id === member.id)!;
    assert(after.balance === 800, `已退款项应被收回（余额 800），实际 ${after.balance}`);
    assert(after.points === 200, `积分应保持 200，实际 ${after.points}`);
    const kept = await service.listBookings({});
    assert(kept[0]?.status === "active", `预约应恢复为进行中，实际 ${kept[0]?.status}`);
    console.log("✅ 取消时流水失败：已退款项被收回、预约恢复进行中");
  }

  // 场景 6：充值流水失败 → 余额回滚
  {
    const { store, service, member } = await setup();
    store.failOn.add("createTransaction");
    await assertRejects(() => service.recharge(member.id, 500), "回滚");
    const after = (await service.listMembers()).find((m) => m.id === member.id)!;
    assert(after.balance === 1000, `充值失败余额应保持 1000，实际 ${after.balance}`);
    store.failOn.clear();
    await service.recharge(member.id, 500);
    const recovered = (await service.listMembers()).find((m) => m.id === member.id)!;
    assert(recovered.balance === 1500, `恢复后充值应正常（1500），实际 ${recovered.balance}`);
    console.log("✅ 充值流水失败：余额回滚，恢复后充值正常");
  }

  // 场景 7：FileStore 持久化失败 → 内存状态同步回滚（单步原子）
  {
    const blocker = path.join(os.tmpdir(), `fs-blocker-${process.pid}`);
    fs.writeFileSync(blocker, "not a directory");
    // dataFile 的父路径是一个普通文件，mkdir 必然失败，persist 必抛错
    const store = new FileStore(path.join(blocker, "sub", "store.json"));
    let threw = false;
    try {
      await store.createRoom({ name: "x", capacity: 4, facilities: [], pricePerHour: 10 });
    } catch {
      threw = true;
    }
    assert(threw, "持久化失败时 createRoom 应抛错");
    assert((await store.listRooms()).length === 0, "持久化失败时内存不应残留数据");
    fs.rmSync(blocker, { force: true });
    console.log("✅ FileStore 单步原子：持久化失败内存同步回滚");
  }

  console.log("\n7/7 失败回滚测试通过");
}

main().catch((error) => {
  console.error(`❌ 失败回滚测试失败：${(error as Error).message}`);
  process.exit(1);
});
