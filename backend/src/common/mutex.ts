/**
 * 进程内异步互斥锁（FIFO）：同一时刻只允许一个任务进入临界区，
 * 其余任务按到达顺序排队等待。用于串行化"检查-扣款-写入"这类
 * 多步写操作，防止并发请求交错执行导致超卖或重复退款。
 */
export class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}
