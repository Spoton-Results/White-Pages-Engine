import { Router } from "express";
import { db } from "../db";
import {
  callTrackingNumbers,
  trackedCalls,
} from "@shared/schema";
import { eq, and, gte, lt } from "drizzle-orm";
import { requireAuth } from "../auth";
import crypto from "crypto";

const router = Router();

// POST /api/call-tracking/provision-number
router.post("/provision-number", requireAuth, async (req, res) => {
  try {
    const { pageId, serviceId, locationId, websiteId, forwardToNumber } = req.body;

    if (!pageId || !websiteId || !forwardToNumber || !serviceId) {
      return res.status(400).json({ error: "Missing required fields: pageId, serviceId, websiteId, forwardToNumber" });
    }

    // Placeholder — replace with CallRail/Twilio provisioning in production
    const dynamicNumber = `+1555${Math.floor(Math.random() * 9000000 + 1000000)}`;

    const [record] = await db
      .insert(callTrackingNumbers)
      .values({
        websiteId,
        pageId,
        serviceId,
        locationId: locationId ?? null,
        dynamicNumber,
        forwardToNumber,
        isActive: true,
      })
      .returning();

    return res.json({
      success: true,
      dynamicNumber: record.dynamicNumber,
      pageId: record.pageId,
    });
  } catch (error) {
    console.error("Error provisioning number:", error);
    return res.status(500).json({ error: "Failed to provision number" });
  }
});

// GET /api/call-tracking/number/:pageId
router.get("/number/:pageId", requireAuth, async (req, res) => {
  try {
    const { pageId } = req.params;

    const [record] = await db
      .select()
      .from(callTrackingNumbers)
      .where(eq(callTrackingNumbers.pageId, pageId))
      .limit(1);

    if (!record) {
      return res.status(404).json({ error: "No tracking number found for this page" });
    }

    return res.json({
      dynamicNumber: record.dynamicNumber,
      forwardToNumber: record.forwardToNumber,
    });
  } catch (error) {
    console.error("Error fetching number:", error);
    return res.status(500).json({ error: "Failed to fetch number" });
  }
});

// POST /api/call-tracking/webhook  (no auth — called by call provider)
router.post("/webhook", async (req, res) => {
  try {
    const { dynamic_number, caller_phone, call_duration, call_status, timestamp, call_id } = req.body;

    if (!dynamic_number) {
      return res.status(400).json({ error: "Missing dynamic_number" });
    }

    const callerPhoneHash = caller_phone
      ? crypto.createHash("sha256").update(caller_phone).digest("hex")
      : null;

    const [trackingRecord] = await db
      .select()
      .from(callTrackingNumbers)
      .where(eq(callTrackingNumbers.dynamicNumber, dynamic_number))
      .limit(1);

    if (!trackingRecord) {
      return res.status(404).json({ error: "Tracking number not found" });
    }

    await db.insert(trackedCalls).values({
      websiteId: trackingRecord.websiteId,
      pageId: trackingRecord.pageId,
      serviceId: trackingRecord.serviceId,
      locationId: trackingRecord.locationId ?? null,
      dynamicNumber: dynamic_number,
      callerPhoneHash,
      callDurationSeconds: call_duration != null ? parseInt(call_duration) : null,
      callTimestamp: timestamp ? new Date(timestamp) : new Date(),
      callStatus: call_status ?? null,
      callProviderId: call_id ?? null,
    });

    return res.json({ success: true });
  } catch (error) {
    console.error("Error recording call:", error);
    return res.status(500).json({ error: "Failed to record call" });
  }
});

// GET /api/call-tracking/metrics/:websiteId
router.get("/metrics/:websiteId", requireAuth, async (req, res) => {
  try {
    const { websiteId } = req.params;
    const { month } = req.query as { month?: string };

    const conditions = [eq(trackedCalls.websiteId, websiteId)];
    if (month) {
      const [year, monthNum] = month.split("-").map(Number);
      conditions.push(gte(trackedCalls.callTimestamp, new Date(year, monthNum - 1, 1)));
      conditions.push(lt(trackedCalls.callTimestamp, new Date(year, monthNum, 1)));
    }

    const calls = await db.select().from(trackedCalls).where(and(...conditions));

    const callsByPage: Record<string, number> = {};
    const callsByService: Record<string, number> = {};
    let totalDuration = 0;

    for (const call of calls) {
      callsByPage[call.pageId] = (callsByPage[call.pageId] ?? 0) + 1;
      callsByService[call.serviceId] = (callsByService[call.serviceId] ?? 0) + 1;
      totalDuration += call.callDurationSeconds ?? 0;
    }

    return res.json({
      totalCalls: calls.length,
      avgDuration: calls.length > 0 ? Math.round(totalDuration / calls.length) : 0,
      callsByPage,
      callsByService,
      calls: calls.slice(0, 50),
    });
  } catch (error) {
    console.error("Error fetching metrics:", error);
    return res.status(500).json({ error: "Failed to fetch metrics" });
  }
});

export default router;
