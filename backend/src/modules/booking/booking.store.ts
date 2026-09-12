import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { env } from "../../config/env";
import { logger } from "../../common/logger";
import type { Booking, Member, RecoveryRecord, Room, WalletTransaction } from "./booking.types";

export interface BookingStore {
  readonly kind: "mongo" | "file";
  listRooms(): Promise<Room[]>;
  getRoom(id: string): Promise<Room | null>;
  createRoom(input: Omit<Room, "id" | "createdAt">): Promise<Room>;
  updateRoom(id: string, patch: Partial<Omit<Room, "id">>): Promise<Room | null>;
  deleteRoom(id: string): Promise<boolean>;

  listMembers(): Promise<Member[]>;
  getMember(id: string): Promise<Member | null>;
  createMember(input: Omit<Member, "id" | "createdAt">): Promise<Member>;
  updateMember(id: string, patch: Partial<Omit<Member, "id">>): Promise<Member | null>;
  deleteMember(id: string): Promise<boolean>;

  listBookings(): Promise<Booking[]>;
  getBooking(id: string): Promise<Booking | null>;
  createBooking(input: Omit<Booking, "id" | "createdAt">): Promise<Booking>;
  updateBooking(id: string, patch: Partial<Omit<Booking, "id">>): Promise<Booking | null>;
  deleteBooking(id: string): Promise<boolean>;

  listTransactions(): Promise<WalletTransaction[]>;
  createTransaction(input: Omit<WalletTransaction, "id" | "createdAt">): Promise<WalletTransaction>;

  listRecoveryRecords(): Promise<RecoveryRecord[]>;
  getRecoveryRecord(id: string): Promise<RecoveryRecord | null>;
  createRecoveryRecord(input: Omit<RecoveryRecord, "id" | "createdAt">): Promise<RecoveryRecord>;
  updateRecoveryRecord(id: string, patch: Partial<Omit<RecoveryRecord, "id">>): Promise<RecoveryRecord | null>;
}

/* ------------------------------ JSON 文件存储 ------------------------------ */

interface FileData {
  rooms: Room[];
  members: Member[];
  bookings: Booking[];
  transactions: WalletTransaction[];
  recoveries: RecoveryRecord[];
}

export class FileStore implements BookingStore {
  readonly kind = "file" as const;
  private data: FileData;
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
    this.data = this.load();
  }

  private load(): FileData {
    try {
      const raw = fs.readFileSync(this.file, "utf-8");
      const parsed = JSON.parse(raw) as Partial<FileData>;
      return {
        rooms: parsed.rooms ?? [],
        members: parsed.members ?? [],
        bookings: parsed.bookings ?? [],
        transactions: parsed.transactions ?? [],
        recoveries: parsed.recoveries ?? [],
      };
    } catch {
      return { rooms: [], members: [], bookings: [], transactions: [], recoveries: [] };
    }
  }

  private persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  /**
   * 单步变更原子化：持久化失败时回滚内存状态并抛错，
   * 保证一次操作要么完整落盘，要么完全不发生，调用方可以安全地做补偿。
   */
  private mutate(fn: () => void): void {
    const snapshot = JSON.parse(JSON.stringify(this.data)) as FileData;
    fn();
    try {
      this.persist();
    } catch (error) {
      this.data = snapshot;
      throw error;
    }
  }

  private stamp<T extends object>(input: T, createdAt?: string | null): T & { id: string; createdAt: string } {
    return { ...input, id: randomUUID(), createdAt: createdAt ?? new Date().toISOString() };
  }

  async listRooms() {
    return [...this.data.rooms];
  }

  async getRoom(id: string) {
    return this.data.rooms.find((room) => room.id === id) ?? null;
  }

  async createRoom(input: Omit<Room, "id" | "createdAt">) {
    const room = this.stamp(input);
    this.mutate(() => {
      this.data.rooms.push(room);
    });
    return room;
  }

  async updateRoom(id: string, patch: Partial<Omit<Room, "id">>) {
    const index = this.data.rooms.findIndex((room) => room.id === id);
    if (index < 0) return null;
    const updated = { ...this.data.rooms[index], ...patch, id };
    this.mutate(() => {
      this.data.rooms[index] = updated;
    });
    return updated;
  }

  async deleteRoom(id: string) {
    if (!this.data.rooms.some((room) => room.id === id)) return false;
    this.mutate(() => {
      this.data.rooms = this.data.rooms.filter((room) => room.id !== id);
    });
    return true;
  }

  async listMembers() {
    return [...this.data.members];
  }

  async getMember(id: string) {
    return this.data.members.find((member) => member.id === id) ?? null;
  }

  async createMember(input: Omit<Member, "id" | "createdAt">) {
    const member = this.stamp(input);
    this.mutate(() => {
      this.data.members.push(member);
    });
    return member;
  }

  async updateMember(id: string, patch: Partial<Omit<Member, "id">>) {
    const index = this.data.members.findIndex((member) => member.id === id);
    if (index < 0) return null;
    const updated = { ...this.data.members[index], ...patch, id };
    this.mutate(() => {
      this.data.members[index] = updated;
    });
    return updated;
  }

  async deleteMember(id: string) {
    if (!this.data.members.some((member) => member.id === id)) return false;
    this.mutate(() => {
      this.data.members = this.data.members.filter((member) => member.id !== id);
    });
    return true;
  }

  async listBookings() {
    return [...this.data.bookings];
  }

  async getBooking(id: string) {
    return this.data.bookings.find((booking) => booking.id === id) ?? null;
  }

  async createBooking(input: Omit<Booking, "id" | "createdAt">) {
    const booking = this.stamp(input);
    this.mutate(() => {
      this.data.bookings.push(booking);
    });
    return booking;
  }

  async updateBooking(id: string, patch: Partial<Omit<Booking, "id">>) {
    const index = this.data.bookings.findIndex((booking) => booking.id === id);
    if (index < 0) return null;
    const updated = { ...this.data.bookings[index], ...patch, id };
    this.mutate(() => {
      this.data.bookings[index] = updated;
    });
    return updated;
  }

  async deleteBooking(id: string) {
    if (!this.data.bookings.some((booking) => booking.id === id)) return false;
    this.mutate(() => {
      this.data.bookings = this.data.bookings.filter((booking) => booking.id !== id);
    });
    return true;
  }

  async listTransactions() {
    return [...this.data.transactions];
  }

  async createTransaction(input: Omit<WalletTransaction, "id" | "createdAt">) {
    const txn = this.stamp(input);
    this.mutate(() => {
      this.data.transactions.push(txn);
    });
    return txn;
  }

  async listRecoveryRecords() {
    return [...this.data.recoveries];
  }

  async getRecoveryRecord(id: string) {
    return this.data.recoveries.find((record) => record.id === id) ?? null;
  }

  async createRecoveryRecord(input: Omit<RecoveryRecord, "id" | "createdAt">) {
    const record = this.stamp(input);
    this.mutate(() => {
      this.data.recoveries.push(record);
    });
    return record;
  }

  async updateRecoveryRecord(id: string, patch: Partial<Omit<RecoveryRecord, "id">>) {
    const index = this.data.recoveries.findIndex((record) => record.id === id);
    if (index < 0) return null;
    const updated = { ...this.data.recoveries[index], ...patch, id };
    this.mutate(() => {
      this.data.recoveries[index] = updated;
    });
    return updated;
  }
}

/* ------------------------------ MongoDB 存储 ------------------------------ */

const roomSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    capacity: { type: Number, required: true },
    facilities: { type: [String], default: [] },
    pricePerHour: { type: Number, required: true },
    createdAt: { type: String, required: true },
  },
  { versionKey: false },
);

const memberSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, default: "" },
    level: { type: String, required: true },
    balance: { type: Number, required: true },
    points: { type: Number, required: true },
    createdAt: { type: String, required: true },
  },
  { versionKey: false },
);

const bookingSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true },
    roomName: { type: String, required: true },
    memberId: { type: String, required: true },
    memberName: { type: String, required: true },
    date: { type: String, required: true },
    startHour: { type: Number, required: true },
    hours: { type: Number, required: true },
    endHour: { type: Number, required: true },
    originalAmount: { type: Number, required: true },
    discount: { type: Number, required: true },
    amount: { type: Number, required: true },
    pointsEarned: { type: Number, required: true },
    status: { type: String, required: true },
    createdAt: { type: String, required: true },
    cancelledAt: { type: String, default: null },
  },
  { versionKey: false },
);

const transactionSchema = new mongoose.Schema(
  {
    memberId: { type: String, required: true },
    memberName: { type: String, required: true },
    type: { type: String, required: true },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    note: { type: String, default: "" },
    createdAt: { type: String, required: true },
  },
  { versionKey: false },
);

const recoverySchema = new mongoose.Schema(
  {
    operation: { type: String, required: true },
    status: { type: String, required: true },
    reason: { type: String, required: true },
    failures: { type: [String], default: [] },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: String, required: true },
    resolvedAt: { type: String, default: null },
  },
  { versionKey: false },
);

function withId<T extends { _id: unknown }>(doc: T): Omit<T, "_id"> & { id: string } {
  const { _id, ...rest } = doc;
  return { ...rest, id: String(_id) } as Omit<T, "_id"> & { id: string };
}

class MongoStore implements BookingStore {
  readonly kind = "mongo" as const;

  private rooms = mongoose.model("Room", roomSchema);
  private members = mongoose.model("Member", memberSchema);
  private bookings = mongoose.model("Booking", bookingSchema);
  private transactions = mongoose.model("WalletTransaction", transactionSchema);
  private recoveries = mongoose.model("RecoveryRecord", recoverySchema);

  async listRooms(): Promise<Room[]> {
    const docs = await this.rooms.find().lean();
    return docs.map((doc) => withId(doc as unknown as { _id: unknown } & Room));
  }

  async getRoom(id: string): Promise<Room | null> {
    const doc = await this.rooms.findById(id).lean();
    return doc ? withId(doc as unknown as { _id: unknown } & Room) : null;
  }

  async createRoom(input: Omit<Room, "id" | "createdAt">): Promise<Room> {
    const doc = await this.rooms.create({ ...input, createdAt: new Date().toISOString() });
    return withId(doc.toObject() as { _id: unknown } & Room);
  }

  async updateRoom(id: string, patch: Partial<Omit<Room, "id">>): Promise<Room | null> {
    const doc = await this.rooms.findByIdAndUpdate(id, patch, { new: true }).lean();
    return doc ? withId(doc as unknown as { _id: unknown } & Room) : null;
  }

  async deleteRoom(id: string): Promise<boolean> {
    const result = await this.rooms.findByIdAndDelete(id);
    return result !== null;
  }

  async listMembers(): Promise<Member[]> {
    const docs = await this.members.find().lean();
    return docs.map((doc) => withId(doc as unknown as { _id: unknown } & Member));
  }

  async getMember(id: string): Promise<Member | null> {
    const doc = await this.members.findById(id).lean();
    return doc ? withId(doc as unknown as { _id: unknown } & Member) : null;
  }

  async createMember(input: Omit<Member, "id" | "createdAt">): Promise<Member> {
    const doc = await this.members.create({ ...input, createdAt: new Date().toISOString() });
    return withId(doc.toObject() as { _id: unknown } & Member);
  }

  async updateMember(id: string, patch: Partial<Omit<Member, "id">>): Promise<Member | null> {
    const doc = await this.members.findByIdAndUpdate(id, patch, { new: true }).lean();
    return doc ? withId(doc as unknown as { _id: unknown } & Member) : null;
  }

  async deleteMember(id: string): Promise<boolean> {
    const result = await this.members.findByIdAndDelete(id);
    return result !== null;
  }

  async listBookings(): Promise<Booking[]> {
    const docs = await this.bookings.find().lean();
    return docs.map((doc) => withId(doc as unknown as { _id: unknown } & Booking));
  }

  async getBooking(id: string): Promise<Booking | null> {
    const doc = await this.bookings.findById(id).lean();
    return doc ? withId(doc as unknown as { _id: unknown } & Booking) : null;
  }

  async createBooking(input: Omit<Booking, "id" | "createdAt">): Promise<Booking> {
    const doc = await this.bookings.create({ ...input, createdAt: new Date().toISOString() });
    return withId(doc.toObject() as { _id: unknown } & Booking);
  }

  async updateBooking(id: string, patch: Partial<Omit<Booking, "id">>): Promise<Booking | null> {
    const doc = await this.bookings.findByIdAndUpdate(id, patch, { new: true }).lean();
    return doc ? withId(doc as unknown as { _id: unknown } & Booking) : null;
  }

  async deleteBooking(id: string): Promise<boolean> {
    const result = await this.bookings.findByIdAndDelete(id);
    return result !== null;
  }

  async listTransactions(): Promise<WalletTransaction[]> {
    const docs = await this.transactions.find().lean();
    return docs.map((doc) => withId(doc as unknown as { _id: unknown } & WalletTransaction));
  }

  async createTransaction(input: Omit<WalletTransaction, "id" | "createdAt">): Promise<WalletTransaction> {
    const doc = await this.transactions.create({ ...input, createdAt: new Date().toISOString() });
    return withId(doc.toObject() as { _id: unknown } & WalletTransaction);
  }

  async listRecoveryRecords(): Promise<RecoveryRecord[]> {
    const docs = await this.recoveries.find().lean();
    return docs.map((doc) => withId(doc as unknown as { _id: unknown } & RecoveryRecord));
  }

  async getRecoveryRecord(id: string): Promise<RecoveryRecord | null> {
    const doc = await this.recoveries.findById(id).lean();
    return doc ? withId(doc as unknown as { _id: unknown } & RecoveryRecord) : null;
  }

  async createRecoveryRecord(input: Omit<RecoveryRecord, "id" | "createdAt">): Promise<RecoveryRecord> {
    const doc = await this.recoveries.create({ ...input, createdAt: new Date().toISOString() });
    return withId(doc.toObject() as { _id: unknown } & RecoveryRecord);
  }

  async updateRecoveryRecord(id: string, patch: Partial<Omit<RecoveryRecord, "id">>): Promise<RecoveryRecord | null> {
    const doc = await this.recoveries.findByIdAndUpdate(id, patch, { new: true }).lean();
    return doc ? withId(doc as unknown as { _id: unknown } & RecoveryRecord) : null;
  }
}

/* ------------------------------ 存储选择 ------------------------------ */

function buildMongoUrl(): string {
  if (env.databaseUrl) return env.databaseUrl;
  return `mongodb://${env.dbUser}:${env.dbPassword}@${env.dbHost}:${env.dbPort}/${env.dbName}?authSource=admin`;
}

export async function createBookingStore(): Promise<BookingStore> {
  try {
    await mongoose.connect(buildMongoUrl(), { serverSelectionTimeoutMS: 3000 });
    logger.info("booking store: connected to MongoDB");
    return new MongoStore();
  } catch (error) {
    logger.info(`booking store: MongoDB unavailable (${(error as Error).message}), fallback to JSON file ${env.dataFile}`);
    await mongoose.disconnect().catch(() => undefined);
    return new FileStore(env.dataFile);
  }
}
