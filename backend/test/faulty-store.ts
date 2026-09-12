/**
 * 可注入故障的内存存储，供各测试文件共用。
 * - failOn：方法名加入集合后，该方法每次调用都抛错
 * - failCalls：Map<方法名, [第N次调用...]>，只在指定调用序号（1 起）抛错，
 *   用于"第一次成功、第二次失败"这类场景（如取消时标记成功但恢复失败）
 */
import type { BookingStore } from "../src/modules/booking/booking.store";
import type { Booking, Member, RecoveryRecord, Room, WalletTransaction } from "../src/modules/booking/booking.types";

export class FaultyStore implements BookingStore {
  readonly kind = "file" as const;
  readonly failOn = new Set<string>();
  readonly failCalls = new Map<string, number[]>();
  private callCounts = new Map<string, number>();
  private rooms: Room[] = [];
  private members: Member[] = [];
  private bookings: Booking[] = [];
  private transactions: WalletTransaction[] = [];
  private recoveries: RecoveryRecord[] = [];
  private seq = 0;

  private boom(method: string) {
    const count = (this.callCounts.get(method) ?? 0) + 1;
    this.callCounts.set(method, count);
    if (this.failOn.has(method)) throw new Error(`模拟存储故障: ${method}`);
    if (this.failCalls.get(method)?.includes(count)) {
      throw new Error(`模拟存储故障: ${method} 第${count}次调用`);
    }
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

  async listRecoveryRecords() { this.boom("listRecoveryRecords"); return [...this.recoveries]; }
  async getRecoveryRecord(id: string) { this.boom("getRecoveryRecord"); return this.recoveries.find((r) => r.id === id) ?? null; }
  async createRecoveryRecord(input: Omit<RecoveryRecord, "id" | "createdAt">) {
    this.boom("createRecoveryRecord");
    const record = this.stamp(input);
    this.recoveries.push(record);
    return record;
  }
  async updateRecoveryRecord(id: string, patch: Partial<Omit<RecoveryRecord, "id">>) {
    this.boom("updateRecoveryRecord");
    const i = this.recoveries.findIndex((r) => r.id === id);
    if (i < 0) return null;
    this.recoveries[i] = { ...this.recoveries[i], ...patch, id };
    return this.recoveries[i];
  }
}
