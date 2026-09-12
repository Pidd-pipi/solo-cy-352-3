import { Router } from "express";
import type { BookingService } from "./booking.service";
import { bookingController } from "./booking.controller";

export function createBookingRouter(service: BookingService): Router {
  const router = Router();
  const controller = bookingController(service);

  router.get("/booking/meta", controller.meta);

  router.get("/booking/rooms", controller.listRooms);
  router.post("/booking/rooms", controller.createRoom);
  router.put("/booking/rooms/:id", controller.updateRoom);
  router.delete("/booking/rooms/:id", controller.deleteRoom);

  router.get("/booking/members", controller.listMembers);
  router.post("/booking/members", controller.createMember);
  router.put("/booking/members/:id", controller.updateMember);
  router.delete("/booking/members/:id", controller.deleteMember);
  router.post("/booking/members/:id/recharge", controller.recharge);

  router.get("/booking/bookings", controller.listBookings);
  router.post("/booking/bookings", controller.createBooking);
  router.post("/booking/bookings/:id/cancel", controller.cancelBooking);

  router.get("/booking/transactions", controller.listTransactions);

  return router;
}
