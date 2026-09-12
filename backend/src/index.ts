import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./common/logger";
import { createBookingStore } from "./modules/booking/booking.store";
import { BookingService } from "./modules/booking/booking.service";
import { createBookingRouter } from "./modules/booking/booking.routes";
import { seedBookingStore } from "./modules/booking/booking.seed";

async function main() {
  const store = await createBookingStore();
  await seedBookingStore(store);
  const bookingRouter = createBookingRouter(new BookingService(store));
  app.use("/", bookingRouter);
  app.use("/api", bookingRouter);

  app.listen(env.port, "0.0.0.0", () => {
    logger.info(`API listening on port ${env.port} (booking store: ${store.kind})`);
  });
}

main().catch((error) => {
  logger.error(`failed to start: ${(error as Error).message}`);
  process.exit(1);
});
