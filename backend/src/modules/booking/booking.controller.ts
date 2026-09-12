import type { Request, Response } from "express";
import type { BookingService } from "./booking.service";

type Handler = (request: Request, response: Response) => Promise<void>;

function paramId(request: Request): string {
  const id = request.params.id;
  return Array.isArray(id) ? id[0] : id;
}

function wrap(handler: Handler): Handler {
  return async (request, response) => {
    try {
      await handler(request, response);
    } catch (error) {
      const status = typeof (error as { statusCode?: number }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 500;
      const message = error instanceof Error ? error.message : "服务器内部错误";
      response.status(status).json({ message });
    }
  };
}

export function bookingController(service: BookingService) {
  return {
    meta: wrap(async (_request, response) => {
      response.json(service.getMeta());
    }),

    listRooms: wrap(async (_request, response) => {
      response.json(await service.listRooms());
    }),
    createRoom: wrap(async (request, response) => {
      response.status(201).json(await service.createRoom(request.body ?? {}));
    }),
    updateRoom: wrap(async (request, response) => {
      response.json(await service.updateRoom(paramId(request), request.body ?? {}));
    }),
    deleteRoom: wrap(async (request, response) => {
      response.json(await service.deleteRoom(paramId(request)));
    }),

    listMembers: wrap(async (_request, response) => {
      response.json(await service.listMembers());
    }),
    createMember: wrap(async (request, response) => {
      response.status(201).json(await service.createMember(request.body ?? {}));
    }),
    updateMember: wrap(async (request, response) => {
      response.json(await service.updateMember(paramId(request), request.body ?? {}));
    }),
    deleteMember: wrap(async (request, response) => {
      response.json(await service.deleteMember(paramId(request)));
    }),
    recharge: wrap(async (request, response) => {
      response.json(await service.recharge(paramId(request), request.body?.amount));
    }),

    listBookings: wrap(async (request, response) => {
      response.json(await service.listBookings(request.query));
    }),
    createBooking: wrap(async (request, response) => {
      response.status(201).json(await service.createBooking(request.body ?? {}));
    }),
    cancelBooking: wrap(async (request, response) => {
      response.json(await service.cancelBooking(paramId(request)));
    }),

    listTransactions: wrap(async (request, response) => {
      response.json(await service.listTransactions(request.query.memberId));
    }),
  };
}
