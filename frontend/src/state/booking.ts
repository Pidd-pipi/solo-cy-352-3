import { reactive } from "vue";
import {
  fetchBookingMeta,
  fetchBookings,
  fetchMembers,
  fetchRooms,
  fetchTransactions,
} from "../api/booking";
import type { BookingItem, BookingMeta, MemberItem, RoomItem, WalletTxn } from "../types";

export const bookingState = reactive({
  meta: null as BookingMeta | null,
  rooms: [] as RoomItem[],
  members: [] as MemberItem[],
  bookings: [] as BookingItem[],
  transactions: [] as WalletTxn[],
  loading: false,
  loadError: "",
});

export async function refreshBookingData(): Promise<boolean> {
  bookingState.loading = true;
  try {
    const [meta, rooms, members, bookings, transactions] = await Promise.all([
      fetchBookingMeta(),
      fetchRooms(),
      fetchMembers(),
      fetchBookings(),
      fetchTransactions(),
    ]);
    bookingState.meta = meta;
    bookingState.rooms = rooms;
    bookingState.members = members;
    bookingState.bookings = bookings;
    bookingState.transactions = transactions;
    bookingState.loadError = "";
    return true;
  } catch (error) {
    bookingState.loadError = error instanceof Error ? error.message : "加载失败";
    return false;
  } finally {
    bookingState.loading = false;
  }
}

export function levelName(code: string): string {
  return bookingState.meta?.levels.find((level) => level.code === code)?.name ?? code;
}

export function levelDiscount(code: string): number {
  return bookingState.meta?.levels.find((level) => level.code === code)?.discount ?? 1;
}

export function discountText(discount: number): string {
  if (discount >= 1) return "10";
  return (discount * 10).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
