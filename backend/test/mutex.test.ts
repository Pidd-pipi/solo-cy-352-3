/**
 * AsyncMutex 单元测试：验证临界区串行执行、读-改-写不丢更新。
 * 运行方式：cd backend && npx tsx test/mutex.test.ts
 */
import { AsyncMutex } from "../src/common/mutex";

function assert(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error(detail);
}

async function main(): Promise<void> {
  const mutex = new AsyncMutex();

  // 1. 临界区互不重叠：每个 end 必须紧跟自己的 start
  const events: string[] = [];
  await Promise.all(
    Array.from({ length: 8 }, (_, id) =>
      mutex.run(async () => {
        events.push(`start-${id}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        events.push(`end-${id}`);
      }),
    ),
  );
  for (let i = 0; i < events.length; i += 2) {
    const started = events[i].replace("start-", "");
    assert(events[i].startsWith("start-"), `事件序列异常：${events.join(",")}`);
    assert(events[i + 1] === `end-${started}`, `临界区发生重叠：${events.join(",")}`);
  }
  console.log("✅ 临界区互不重叠");

  // 2. 读-改-写不丢更新：N 个并发自增（中间让出执行权），结果必须为 N
  let counter = 0;
  const N = 50;
  await Promise.all(
    Array.from({ length: N }, () =>
      mutex.run(async () => {
        const snapshot = counter;
        await new Promise((resolve) => setTimeout(resolve, 1));
        counter = snapshot + 1;
      }),
    ),
  );
  assert(counter === N, `并发自增应为 ${N}，实际 ${counter}（发生丢更新）`);
  console.log("✅ 读-改-写不丢更新");

  // 3. 异常不阻塞后续任务
  await mutex.run(async () => {
    throw new Error("故意失败");
  }).catch(() => undefined);
  const value = await mutex.run(async () => 42);
  assert(value === 42, "前序任务异常后，后续任务应继续执行");
  console.log("✅ 前序任务异常不阻塞后续任务");

  console.log("\n3/3 互斥锁单元测试通过");
}

main().catch((error) => {
  console.error(`❌ 互斥锁测试失败：${(error as Error).message}`);
  process.exit(1);
});
