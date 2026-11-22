import type { SessionRowRecord } from "./db.js";

declare global {
  namespace Express {
    interface Request {
      sessionRow?: SessionRowRecord;
    }
  }
}

export {};
