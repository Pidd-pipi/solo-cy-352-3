import { API_BASE_URL } from "../constants/app";
import type { BookingItem, BookingMeta, MemberItem, MemberLevel, RoomItem, WalletTxn } from "../types";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/booking${path}`, {
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    ...options,
  });
  const data = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) {
    throw new Error(data.message ?? `请求失败（${response.status}）`);
  }
  return data as T;
}

export function fetchBookingMeta(): Promise<BookingMeta> {
  return request<BookingMeta>("/meta");
}

/* 包厢 */
export function fetchRooms(): Promise<RoomItem[]> {
  return request<RoomItem[]>("/rooms");
}

export function createRoom(input: { name: string; capacity: number; facilities: string[]; pricePerHour: number }) {
  return request<RoomItem>("/rooms", { method: "POST", body: JSON.stringify(input) });
}

export function updateRoom(id: string, input: { name: string; capacity: number; facilities: string[]; pricePerHour: number }) {
  return request<RoomItem>(`/rooms/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

export function deleteRoom(id: string) {
  return request<{ deleted: boolean }>(`/rooms/${id}`, { method: "DELETE" });
}

/* 会员 */
export function fetchMembers(): Promise<MemberItem[]> {
  return request<MemberItem[]>("/members");
}

export function createMember(input: { name: string; phone: string; level: MemberLevel }) {
  return request<MemberItem>("/members", { method: "POST", body: JSON.stringify(input) });
}

export function updateMember(id: string, input: { name: string; phone: string; level: MemberLevel }) {
  return request<MemberItem>(`/members/${id}`, { method: "PUT", body: JSON.stringify(input) });
}

export function deleteMember(id: string) {
  return request<{ deleted: boolean }>(`/members/${id}`, { method: "DELETE" });
}

export function rechargeMember(id: string, amount: number) {
  return request<MemberItem>(`/members/${id}/recharge`, { method: "POST", body: JSON.stringify({ amount }) });
}

/* 预约 */
export function fetchBookings(): Promise<BookingItem[]> {
  return request<BookingItem[]>("/bookings");
}

export function createBooking(input: { roomId: string; memberId: string; date: string; startHour: number; hours: number }) {
  return request<BookingItem>("/bookings", { method: "POST", body: JSON.stringify(input) });
}

export function cancelBooking(id: string) {
  return request<BookingItem>(`/bookings/${id}/cancel`, { method: "POST" });
}

/* 流水 */
export function fetchTransactions(): Promise<WalletTxn[]> {
  return request<WalletTxn[]>("/transactions");
}
