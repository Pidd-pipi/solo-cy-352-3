/**
 * 包厢预约与会员储值 —— 可反复执行的端到端自动化测试。
 *
 * 运行方式：cd backend && npm test
 *
 * 测试会自带一个独立的服务实例（端口 29513、独立临时数据文件），
 * 不影响 29512 的开发服务；中途会杀掉进程重启一次，验证数据持久化。
 * 每条用例绑定一条业务规则，失败时直接指出哪条规则被破坏。
 */
import { spawn, type ChildProcess } from "child_process";
import { once } from "events";
import fs from "fs";
import os from "os";
import path from "path";

const PORT = 29513;
const BASE = `http://127.0.0.1:${PORT}/api/booking`;
const HEALTH = `http://127.0.0.1:${PORT}/health`;
const DATA_FILE = path.join(os.tmpdir(), `booking-e2e-${process.pid}.json`);

/* ------------------------------ 服务进程管理 ------------------------------ */

let child: ChildProcess | null = null;

async function startServer(): Promise<void> {
  child = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT), DATA_FILE },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // 独立进程组，便于整组终止（npx 会派生多层子进程）
  });
  child.stderr?.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const res = await fetch(HEALTH);
      if (res.ok) return;
    } catch {
      // 服务还没起来，继续等
    }
    if (Date.now() > deadline) {
      throw new Error("被测服务启动超时（30 秒）");
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

async function stopServer(): Promise<void> {
  if (!child) return;
  const current = child;
  child = null;
  try {
    // 负 PID 终止整个进程组，避免 npx/tsx 派生的孙进程残留占用端口
    process.kill(-current.pid!, "SIGTERM");
  } catch {
    current.kill("SIGTERM");
  }
  await Promise.race([once(current, "exit"), new Promise((resolve) => setTimeout(resolve, 5000))]);
}

/* ------------------------------ 请求与断言 ------------------------------ */

interface ApiResult {
  status: number;
  data: Record<string, any>;
}

async function api(method: string, urlPath: string, body?: unknown): Promise<ApiResult> {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  return { status: res.status, data };
}

function assert(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error(detail);
}

function assertClose(actual: number, expected: number, label: string) {
  assert(Math.abs(actual - expected) < 0.001, `${label} 应为 ${expected}，实际为 ${actual}`);
}

/* ------------------------------ 测试用例 ------------------------------ */

interface Case {
  name: string;
  rule: string;
  run(): Promise<void>;
}

const cases: Case[] = [];
function test(name: string, rule: string, run: () => Promise<void>): void {
  cases.push({ name, rule, run });
}

// 共享夹具：独立创建的包厢与会员，不依赖种子数据
const fixture = {
  roomId: "",
  goldId: "",
  brokeId: "",
  booking2hId: "", // 黄金会员 14:00-16:00 的预约（后面用于取消/重复取消）
  leapDayId: "",
  adjacentId: "",
  room2Id: "", // 并发测试专用包厢
  concId: "", // 并发测试专用会员
  concBookingId: "", // 并发下单中唯一胜出的预约
};

const PRICE = 100; // 测试包厢每小时价格
const GOLD_DISCOUNT = 0.9;
const amount1h = Math.round(PRICE * 1 * GOLD_DISCOUNT * 100) / 100; // 90
const amount2h = Math.round(PRICE * 2 * GOLD_DISCOUNT * 100) / 100; // 180

test("零时长预约被拒绝", "预约时长必须至少为 1 小时", async () => {
  for (const hours of [0, -1, 2.5, "abc"]) {
    const res = await api("POST", "/bookings", {
      roomId: fixture.roomId,
      memberId: fixture.goldId,
      date: "2027-03-10",
      startHour: 18,
      hours,
    });
    assert(res.status === 400, `hours=${JSON.stringify(hours)} 应返回 400，实际 ${res.status}：${JSON.stringify(res.data)}`);
    assert(
      typeof res.data.message === "string" && res.data.message.includes("至少为 1 小时"),
      `hours=${JSON.stringify(hours)} 的提示应说明时长至少 1 小时，实际：${res.data.message}`,
    );
  }
});

test("虚构日期被拒绝，合法闰日可用", "不存在的日期必须被拒绝", async () => {
  for (const date of ["2027-02-30", "2026-04-31", "2026-13-01", "2026-02-29"]) {
    const res = await api("POST", "/bookings", {
      roomId: fixture.roomId,
      memberId: fixture.goldId,
      date,
      startHour: 10,
      hours: 1,
    });
    assert(res.status === 400, `日期 ${date} 应返回 400，实际 ${res.status}：${JSON.stringify(res.data)}`);
    assert(
      typeof res.data.message === "string" && res.data.message.includes("不存在"),
      `日期 ${date} 的提示应说明日期不存在，实际：${res.data.message}`,
    );
  }
  // 2028 是闰年，2 月 29 日必须能约（10:00-11:00，金额 90）
  const ok = await api("POST", "/bookings", {
    roomId: fixture.roomId,
    memberId: fixture.goldId,
    date: "2028-02-29",
    startHour: 10,
    hours: 1,
  });
  assert(ok.status === 201, `合法闰日 2028-02-29 应预约成功，实际 ${ok.status}：${JSON.stringify(ok.data)}`);
  fixture.leapDayId = ok.data.id;
});

test("会员折扣与积分", "按会员等级折扣计价并累计积分", async () => {
  // 黄金会员 9 折：100 × 2h × 0.9 = 180，积分 +180
  const res = await api("POST", "/bookings", {
    roomId: fixture.roomId,
    memberId: fixture.goldId,
    date: "2027-03-10",
    startHour: 14,
    hours: 2,
  });
  assert(res.status === 201, `预约应成功，实际 ${res.status}：${JSON.stringify(res.data)}`);
  assertClose(res.data.amount, amount2h, "折后金额");
  assert(res.data.pointsEarned === 180, `本次应累计 180 积分，实际 ${res.data.pointsEarned}`);
  fixture.booking2hId = res.data.id;

  const member = (await api("GET", "/members")).data.find((m: any) => m.id === fixture.goldId);
  // 此前已支付闰日预约 90，本次 180：余额 1000-90-180=730，积分 90+180=270
  assertClose(member.balance, 1000 - amount1h - amount2h, "扣款后余额");
  assert(member.points === 270, `累计积分应为 270，实际 ${member.points}`);
});

test("时段重叠被拦截", "同一包厢的重叠时段不能重复预约", async () => {
  for (const [startHour, hours] of [[15, 1], [13, 2], [15, 5]] as const) {
    const res = await api("POST", "/bookings", {
      roomId: fixture.roomId,
      memberId: fixture.goldId,
      date: "2027-03-10",
      startHour,
      hours,
    });
    assert(res.status === 409, `与 14:00-16:00 重叠的 ${startHour}:00+${hours}h 应返回 409，实际 ${res.status}`);
    assert(
      typeof res.data.message === "string" && res.data.message.includes("时段不能重叠"),
      `重叠提示应说明原因，实际：${res.data.message}`,
    );
  }
});

test("相邻时段允许预约", "首尾相接的相邻时段必须允许", async () => {
  // 16:00 紧接已占用的 14:00-16:00，不算重叠
  const res = await api("POST", "/bookings", {
    roomId: fixture.roomId,
    memberId: fixture.goldId,
    date: "2027-03-10",
    startHour: 16,
    hours: 2,
  });
  assert(res.status === 201, `相邻时段 16:00-18:00 应预约成功，实际 ${res.status}：${JSON.stringify(res.data)}`);
  fixture.adjacentId = res.data.id;
});

test("余额不足被拒绝且不扣款", "余额不足必须拒绝并保持余额不变", async () => {
  const before = (await api("GET", "/members")).data.find((m: any) => m.id === fixture.brokeId);
  const bookingsBefore = (await api("GET", "/bookings")).data.length;

  const res = await api("POST", "/bookings", {
    roomId: fixture.roomId,
    memberId: fixture.brokeId,
    date: "2027-03-11",
    startHour: 10,
    hours: 1,
  });
  assert(res.status === 400, `余额 50 支付 100 应返回 400，实际 ${res.status}`);
  assert(
    typeof res.data.message === "string" && res.data.message.includes("余额不足") && res.data.message.includes("还差"),
    `提示应说明余额不足及差额，实际：${res.data.message}`,
  );

  const after = (await api("GET", "/members")).data.find((m: any) => m.id === fixture.brokeId);
  assertClose(after.balance, before.balance, "被拒绝后余额");
  assert(after.points === before.points, `被拒绝后积分不应变化，${before.points} -> ${after.points}`);
  const bookingsAfter = (await api("GET", "/bookings")).data.length;
  assert(bookingsAfter === bookingsBefore, `被拒绝的请求不应产生预约记录，${bookingsBefore} -> ${bookingsAfter}`);
});

test("取消预约全额退款并扣回积分", "取消预约必须退款并扣回对应积分", async () => {
  const before = (await api("GET", "/members")).data.find((m: any) => m.id === fixture.goldId);

  const res = await api("POST", `/bookings/${fixture.booking2hId}/cancel`);
  assert(res.status === 200, `取消应成功，实际 ${res.status}：${JSON.stringify(res.data)}`);
  assert(res.data.status === "cancelled", `状态应为 cancelled，实际 ${res.data.status}`);

  const after = (await api("GET", "/members")).data.find((m: any) => m.id === fixture.goldId);
  assertClose(after.balance, before.balance + amount2h, "退款后余额");
  assert(after.points === before.points - 180, `积分应扣回 180，${before.points} -> ${after.points}`);
});

test("重复取消被拒绝", "已取消的预约不能重复取消", async () => {
  const res = await api("POST", `/bookings/${fixture.booking2hId}/cancel`);
  assert(res.status === 400, `重复取消应返回 400，实际 ${res.status}`);
  assert(
    typeof res.data.message === "string" && res.data.message.includes("已取消"),
    `提示应说明预约已取消，实际：${res.data.message}`,
  );
});

test("并发下单同一时段只成功一笔", "同一包厢同一时段并发下单只能成功一笔、只扣一次款", async () => {
  const CONCURRENT = 6;
  const before = (await api("GET", "/members")).data.find((m: any) => m.id === fixture.concId);
  const txnsBefore = (await api("GET", `/transactions?memberId=${fixture.concId}`)).data;

  // 6 个请求同时下单同一包厢同一时段（50/小时 × 3h = 150）
  const results = await Promise.all(
    Array.from({ length: CONCURRENT }, () =>
      api("POST", "/bookings", {
        roomId: fixture.room2Id,
        memberId: fixture.concId,
        date: "2027-04-01",
        startHour: 19,
        hours: 3,
      }),
    ),
  );

  const succeeded = results.filter((res) => res.status === 201);
  const rejected = results.filter((res) => res.status === 409);
  assert(
    succeeded.length === 1,
    `并发下单应只有 1 笔成功，实际成功 ${succeeded.length} 笔（状态分布：${results.map((r) => r.status).join(",")}）`,
  );
  assert(
    rejected.length === CONCURRENT - 1,
    `其余 ${CONCURRENT - 1} 笔应返回 409 重叠，实际状态分布：${results.map((r) => r.status).join(",")}`,
  );
  fixture.concBookingId = succeeded[0].data.id;

  const active = (await api("GET", `/bookings?roomId=${fixture.room2Id}&date=2027-04-01&status=active`)).data;
  assert(active.length === 1, `该时段有效预约应为 1 笔，实际 ${active.length} 笔`);

  const after = (await api("GET", "/members")).data.find((m: any) => m.id === fixture.concId);
  assertClose(after.balance, before.balance - 150, "并发后余额（只应扣一笔 150）");
  assert(after.points === before.points + 150, `积分应只增加 150，实际 ${before.points} -> ${after.points}`);

  const txnsAfter = (await api("GET", `/transactions?memberId=${fixture.concId}`)).data;
  const newPayments = txnsAfter.filter((t: any) => t.type === "payment").length - txnsBefore.filter((t: any) => t.type === "payment").length;
  assert(newPayments === 1, `支付流水应只新增 1 条，实际新增 ${newPayments} 条`);
});

test("并发取消同一预约只退款一次", "同一预约并发取消只能退款一次，余额积分不重复返还", async () => {
  const CONCURRENT = 6;
  const before = (await api("GET", "/members")).data.find((m: any) => m.id === fixture.concId);

  const results = await Promise.all(
    Array.from({ length: CONCURRENT }, () => api("POST", `/bookings/${fixture.concBookingId}/cancel`)),
  );

  const succeeded = results.filter((res) => res.status === 200);
  const rejected = results.filter((res) => res.status === 400);
  assert(
    succeeded.length === 1,
    `并发取消应只有 1 次成功，实际成功 ${succeeded.length} 次（状态分布：${results.map((r) => r.status).join(",")}）`,
  );
  assert(
    rejected.length === CONCURRENT - 1,
    `其余 ${CONCURRENT - 1} 次应返回 400 已取消，实际状态分布：${results.map((r) => r.status).join(",")}`,
  );

  const after = (await api("GET", "/members")).data.find((m: any) => m.id === fixture.concId);
  assertClose(after.balance, before.balance + 150, "并发取消后余额（只应退款一次 150）");
  assert(after.points === before.points - 150, `积分应只扣回一次 150，实际 ${before.points} -> ${after.points}`);

  const txns = (await api("GET", `/transactions?memberId=${fixture.concId}`)).data;
  const refunds = txns.filter((t: any) => t.type === "refund");
  assert(refunds.length === 1, `退款流水应只有 1 条，实际 ${refunds.length} 条`);
});

test("服务重启后数据完整保留", "重启服务后预约、余额、积分、流水都不能丢失", async () => {
  const bookingsBefore = (await api("GET", "/bookings")).data;
  const txnsBefore = (await api("GET", "/transactions")).data;

  await stopServer();
  await startServer();

  const rooms = (await api("GET", "/rooms")).data;
  assert(rooms.some((r: any) => r.id === fixture.roomId), "重启后测试包厢丢失");

  const member = (await api("GET", "/members")).data.find((m: any) => m.id === fixture.goldId);
  assert(member, "重启后测试会员丢失");
  // 流水：充值 1000 - 闰日 90 - 2h 预约 180 + 取消退款 180 - 相邻时段 180 = 730
  // 积分：90 + 180 - 180 + 180 = 270
  assertClose(member.balance, 1000 - amount1h - amount2h, "重启后会员余额");
  assert(member.points === 270, `重启后积分应为 270，实际 ${member.points}`);

  const bookingsAfter = (await api("GET", "/bookings")).data;
  assert(bookingsAfter.length === bookingsBefore.length, `重启后预约数 ${bookingsBefore.length} -> ${bookingsAfter.length}`);
  const cancelled = bookingsAfter.find((b: any) => b.id === fixture.booking2hId);
  assert(cancelled?.status === "cancelled", "重启后已取消的预约状态丢失");
  const active = bookingsAfter.find((b: any) => b.id === fixture.adjacentId);
  assert(active?.status === "active", "重启后进行中的预约状态丢失");

  const txnsAfter = (await api("GET", "/transactions")).data;
  assert(txnsAfter.length === txnsBefore.length, `重启后流水数 ${txnsBefore.length} -> ${txnsAfter.length}`);
});

/* ------------------------------ 主流程 ------------------------------ */

async function main(): Promise<number> {
  fs.rmSync(DATA_FILE, { force: true });
  await startServer();

  // 准备夹具：100/小时的包厢、黄金会员（充值 1000）、余额 50 的普通会员
  const room = await api("POST", "/rooms", { name: "自动化测试包厢", capacity: 6, facilities: ["桌游架"], pricePerHour: PRICE });
  assert(room.status === 201, `创建测试包厢失败：${JSON.stringify(room.data)}`);
  fixture.roomId = room.data.id;

  const gold = await api("POST", "/members", { name: "自动化-黄金", phone: "13700000001", level: "gold" });
  assert(gold.status === 201, `创建黄金会员失败：${JSON.stringify(gold.data)}`);
  fixture.goldId = gold.data.id;
  await api("POST", `/members/${fixture.goldId}/recharge`, { amount: 1000 });

  const broke = await api("POST", "/members", { name: "自动化-普通", phone: "13700000002", level: "normal" });
  assert(broke.status === 201, `创建普通会员失败：${JSON.stringify(broke.data)}`);
  fixture.brokeId = broke.data.id;
  await api("POST", `/members/${fixture.brokeId}/recharge`, { amount: 50 });

  // 并发测试专用：50/小时的包厢 + 余额充足的普通会员
  const room2 = await api("POST", "/rooms", { name: "并发测试包厢", capacity: 8, facilities: [], pricePerHour: 50 });
  assert(room2.status === 201, `创建并发测试包厢失败：${JSON.stringify(room2.data)}`);
  fixture.room2Id = room2.data.id;
  const conc = await api("POST", "/members", { name: "自动化-并发", phone: "13700000003", level: "normal" });
  assert(conc.status === 201, `创建并发测试会员失败：${JSON.stringify(conc.data)}`);
  fixture.concId = conc.data.id;
  await api("POST", `/members/${fixture.concId}/recharge`, { amount: 10000 });

  let failures = 0;
  for (const item of cases) {
    try {
      await item.run();
      console.log(`✅ ${item.name}`);
    } catch (error) {
      failures += 1;
      console.error(`❌ ${item.name}`);
      console.error(`   规则被破坏【${item.rule}】`);
      console.error(`   ${(error as Error).message}`);
    }
  }

  console.log(`\n${cases.length - failures}/${cases.length} 条规则验证通过`);
  return failures;
}

main()
  .then(async (failures) => {
    await stopServer();
    fs.rmSync(DATA_FILE, { force: true });
    process.exit(failures > 0 ? 1 : 0);
  })
  .catch(async (error) => {
    console.error(`测试框架自身出错：${(error as Error).message}`);
    await stopServer();
    fs.rmSync(DATA_FILE, { force: true });
    process.exit(2);
  });
