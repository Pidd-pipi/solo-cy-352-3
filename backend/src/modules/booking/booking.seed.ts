import type { BookingStore } from "./booking.store";

export async function seedBookingStore(store: BookingStore): Promise<void> {
  const rooms = await store.listRooms();
  if (rooms.length === 0) {
    await store.createRoom({ name: "翡翠小包", capacity: 4, facilities: ["桌游架", "空调"], pricePerHour: 38 });
    await store.createRoom({ name: "琥珀中包", capacity: 8, facilities: ["桌游架", "高清投影", "迷你吧台"], pricePerHour: 68 });
    await store.createRoom({
      name: "钻石大包",
      capacity: 14,
      facilities: ["专业音响", "高清投影", "独立卫生间", "游戏机", "迷你吧台"],
      pricePerHour: 108,
    });
  }

  const members = await store.listMembers();
  if (members.length === 0) {
    await store.createMember({ name: "林小满", phone: "13800000001", level: "gold", balance: 500, points: 120 });
    await store.createMember({ name: "陈屿", phone: "13800000002", level: "normal", balance: 60, points: 0 });
  }
}
