/**
 * 回滚失败专项测试：补偿（恢复余额/删除预约/恢复预约状态）任一步失败时，
 * 接口必须明确返回回滚失败（ROLLBACK_FAILED），并留下可追踪的恢复记录，
 * 不能只记日志后按普通业务失败返回。
 *
 * 运行方式：cd backend && npx tsx test/rollback-failure.test.ts
 */
import { BookingService } from "../src/modules/booking/booking.service";
import { FaultyStore } from "./faulty-store";

function assert(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error(detail);
}

async function setup() {
  const store = new FaultyStore();
  const service = new BookingService(store);
  const room = await service.createRoom({ name: "回滚失败测试房", capacity: 6, facilities: [], pricePerHour: 100 });
  const member = await service.createMember({ name: "回滚会员", phone: "", level: "normal" });
  await service.recharge(member.id, 1000);
  return { store, service, room, member };
}

async function main(): Promise<void> {
  // 场景 1：建单失败且恢复余额也失败 → 明确回滚失败 + 恢复记录可追踪、可标记处理
  {
    const { store, service, room, member } = await setup();
    store.failOn.add("createBooking");
    // updateMember 调用序：#1 充值(setup) #2 下单扣款 #3 补偿恢复 → 只让第 3 次失败
    store.failCalls.set("updateMember", [3]);

    const error = await service
      .createBooking({ roomId: room.id, memberId: member.id, date: "2027-07-01", startHour: 14, hours: 2 })
      .catch((e: Error & { code?: string }) => e);
    assert(error instanceof Error, "应抛出错误");
    assert(error.message.includes("回滚未完成"), `应明确返回回滚失败，实际：${error.message}`);
    assert(error.code === "ROLLBACK_FAILED", `错误码应为 ROLLBACK_FAILED，实际 ${error.code}`);
    assert(!error.message.includes("已自动回滚"), "回滚失败时不得谎称已自动回滚");

    const records = await service.listRecoveries("pending");
    assert(records.length === 1, `应留下 1 条待处理恢复记录，实际 ${records.length}`);
    const record = records[0];
    assert(record.operation === "createBooking", `记录操作类型应为 createBooking，实际 ${record.operation}`);
    assert(record.payload.expectedBalance === 1000, `记录应包含恢复所需快照（期望余额 1000），实际 ${JSON.stringify(record.payload)}`);
    assert(record.failures.some((f: string) => f.includes("恢复会员余额和积分")), `记录应包含失败的补偿步骤，实际 ${record.failures}`);
    assert(error.message.includes(record.id), "错误信息应包含恢复记录 ID 便于追踪");

    // 状态如实保留（会员仍被扣款 200），等待人工按记录处理
    const dirty = (await service.listMembers()).find((m) => m.id === member.id)!;
    assert(dirty.balance === 800, `回滚失败时余额应保持现场（800），实际 ${dirty.balance}`);

    // 故障清除后可标记处理完毕；重复处理被拒绝
    store.failOn.clear();
    const resolved = await service.resolveRecovery(record.id);
    assert(resolved?.status === "resolved" && resolved.resolvedAt, "应能标记恢复记录为已处理");
    const again = await service.resolveRecovery(record.id).catch((e: Error) => e);
    assert(again instanceof Error && again.message.includes("已处理"), "重复处理应被拒绝");
    console.log("✅ 恢复余额失败：明确回滚失败 + 恢复记录可追踪可标记");
  }

  // 场景 2：流水失败且删除预约失败 → 回滚失败 + 记录，脏预约如实保留
  {
    const { store, service, room, member } = await setup();
    store.failOn.add("createTransaction");
    store.failOn.add("deleteBooking");

    const error = await service
      .createBooking({ roomId: room.id, memberId: member.id, date: "2027-07-02", startHour: 14, hours: 2 })
      .catch((e: Error & { code?: string }) => e);
    assert(error.code === "ROLLBACK_FAILED", `应明确回滚失败，实际：${error.message}`);

    const records = await service.listRecoveries("pending");
    assert(records.length === 1, "应留下恢复记录");
    assert(records[0].failures.some((f: string) => f.includes("删除已创建的预约")), "记录应注明删除预约失败");
    assert(records[0].payload.bookingId, "记录应包含待人工删除的预约 ID");

    const bookings = await service.listBookings({});
    assert(bookings.length === 1 && bookings[0].status === "active", "删除失败时脏预约应如实保留待人工处理");
    console.log("✅ 删除预约失败：明确回滚失败 + 记录含待删预约 ID");
  }

  // 场景 3：取消时标记成功但恢复预约失败 → 回滚失败 + 记录，现场保留
  {
    const { store, service, room, member } = await setup();
    const booking = await service.createBooking({ roomId: room.id, memberId: member.id, date: "2027-07-03", startHour: 14, hours: 2 });
    store.failOn.add("createTransaction");
    store.failCalls.set("updateBooking", [2]); // 第 1 次（标记取消）成功，第 2 次（恢复预约）失败

    const error = await service.cancelBooking(booking.id).catch((e: Error & { code?: string }) => e);
    assert(error.code === "ROLLBACK_FAILED", `应明确回滚失败，实际：${error.message}`);

    const records = await service.listRecoveries("pending");
    assert(records.length === 1 && records[0].operation === "cancelBooking", "应留下 cancelBooking 恢复记录");
    assert(records[0].failures.some((f: string) => f.includes("恢复预约为进行中")), "记录应注明恢复预约失败");
    assert(records[0].payload.expectedBookingStatus === "active", "记录应包含预约的期望状态");

    // 现场：预约仍是 cancelled，会员未被退款（800）——不一致状态如实保留待人工处理
    const kept = await service.listBookings({});
    assert(kept[0].status === "cancelled", `预约应保持 cancelled 现场，实际 ${kept[0].status}`);
    const after = (await service.listMembers()).find((m) => m.id === member.id)!;
    assert(after.balance === 800, `会员应保持未退款现场（800），实际 ${after.balance}`);
    console.log("✅ 恢复预约失败：明确回滚失败 + 记录含期望状态，现场如实保留");
  }

  // 场景 4：恢复记录也写不进去 → 仍明确返回回滚失败，不得崩溃或伪装成功
  {
    const { store, service, room, member } = await setup();
    store.failOn.add("createBooking");
    store.failCalls.set("updateMember", [3]); // 补偿恢复那一步失败
    store.failOn.add("createRecoveryRecord");

    const error = await service
      .createBooking({ roomId: room.id, memberId: member.id, date: "2027-07-04", startHour: 14, hours: 2 })
      .catch((e: Error & { code?: string }) => e);
    assert(error.code === "ROLLBACK_FAILED", `记录写不进去时仍应明确回滚失败，实际：${error.message}`);
    assert(error.message.includes("写入失败"), "应提示恢复记录写入失败、数据见日志");
    console.log("✅ 恢复记录写入失败：仍明确返回回滚失败");
  }

  // 场景 5：成功回滚 → 普通业务失败，不产生恢复记录、不含回滚失败字样
  {
    const { store, service, room, member } = await setup();
    store.failOn.add("createBooking");

    const error = await service
      .createBooking({ roomId: room.id, memberId: member.id, date: "2027-07-05", startHour: 14, hours: 2 })
      .catch((e: Error & { code?: string }) => e);
    assert(error.message.includes("已自动回滚"), `成功回滚应返回普通失败信息，实际：${error.message}`);
    assert(error.code !== "ROLLBACK_FAILED", "成功回滚不得带 ROLLBACK_FAILED 错误码");
    assert((await service.listRecoveries()).length === 0, "成功回滚不应产生恢复记录");
    const after = (await service.listMembers()).find((m) => m.id === member.id)!;
    assert(after.balance === 1000, `成功回滚余额应恢复（1000），实际 ${after.balance}`);
    console.log("✅ 成功回滚行为不变：普通失败返回、无恢复记录");
  }

  // 场景 6：标记不存在的恢复记录 → 404
  {
    const { service } = await setup();
    const error = await service.resolveRecovery("not-exist").catch((e: Error & { statusCode?: number }) => e);
    assert(error.statusCode === 404, `不存在的记录应返回 404，实际 ${error.statusCode}`);
    console.log("✅ 不存在的恢复记录返回 404");
  }

  console.log("\n6/6 回滚失败测试通过");
}

main().catch((error) => {
  console.error(`❌ 回滚失败测试失败：${(error as Error).message}`);
  process.exit(1);
});
