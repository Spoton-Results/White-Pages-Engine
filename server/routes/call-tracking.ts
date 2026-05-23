import { Router } from "express";
import { db, pool } from "../db"; // ✅ CHANGED: added pool for raw SQL read queries
import { callTrackingNumbers, trackedCalls } from "@shared/schema";
import { eq } from "drizzle-orm"; // 🔒 UNTOUCHED: still used for insert/webhook ops
import { requireAuth } from "../auth";
import { getPhoneProvider, getPublicBaseUrl } from "../services/phone-provider";
import crypto from "crypto";

const router = Router();

// POST /api/call-tracking/provision-number
// 🔒 UNTOUCHED: write path — Drizzle insert works fine
router.post("/provision-number", requireAuth, async (req, res) => {
  try {
    const { pageId, serviceId, locationId, websiteId, forwardToNumber } = req.body;

    if (!pageId || !websiteId || !forwardToNumber || !serviceId) {
      return res.status(400).json({
        error: "Missing required fields: pageId, serviceId, websiteId, forwardToNumber",
      });
    }

    const baseUrl = getPublicBaseUrl();
    const provider = getPhoneProvider();

    const areaCode = forwardToNumber.replace(/\D/g, "").slice(1, 4) || undefined;

    const provisioned = await provider.provisionNumber({
      areaCode,
      voiceWebhookUrl: `${baseUrl}/api/call-tracking/twilio-voice`,
      statusCallbackUrl: `${baseUrl}/api/call-tracking/twilio-status`,
    });

    const [record] = await db
      .insert(callTrackingNumbers)
      .values({
        websiteId,
        pageId,
        serviceId,
        locationId: locationId ?? null,
        dynamicNumber: provisioned.phoneNumber,
        forwardToNumber,
        isActive: true,
      })
      .returning();

    return res.json({
      success: true,
      dynamicNumber: record.dynamicNumber,
      pageId: record.pageId,
      provider: provisioned.provider,
    });
  } catch (error: any) {
    console.error("Error provisioning number:", error);
    return res.status(500).json({ error: error.message || "Failed to provision number" });
  }
});

// GET /api/call-tracking/number/:pageId
// 🔒 UNTOUCHED: callTrackingNumbers only has id/snake_case cols that Drizzle handles fine here
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

// POST /api/call-tracking/twilio-voice
// 🔒 UNTOUCHED: webhook read of callTrackingNumbers — no camelCase fields in response
router.post("/twilio-voice", async (req, res) => {
  try {
    const to = req.body.To as string | undefined;
    if (!to) {
      return res.status(400).send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
    }

    const [record] = await db
      .select()
      .from(callTrackingNumbers)
      .where(eq(callTrackingNumbers.dynamicNumber, to))
      .limit(1);

    if (!record || !record.isActive) {
      return res.status(200).type("text/xml").send(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Say>This number is not in service.</Say></Response>`,
      );
    }

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${record.dynamicNumber}" record="record-from-answer-dual" recordingStatusCallback="/api/call-tracking/twilio-status">
    ${record.forwardToNumber}
  </Dial>
</Response>`;

    return res.status(200).type("text/xml").send(twiml);
  } catch (error) {
    console.error("Error in twilio-voice webhook:", error);
    return res.status(200).type("text/xml").send(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say>An error occurred. Please try again.</Say></Response>`,
    );
  }
});

// POST /api/call-tracking/twilio-status
// 🔒 UNTOUCHED: write path — Drizzle insert works fine
router.post("/twilio-status", async (req, res) => {
  try {
    const {
      To: to,
      From: from,
      CallSid,
      CallStatus,
      CallDuration,
      Timestamp,
    } = req.body as Record<string, string>;

    if (!to || !CallSid) return res.sendStatus(200);

    const callerPhoneHash = from
      ? crypto.createHash("sha256").update(from).digest("hex")
      : null;

    const [trackingRecord] = await db
      .select()
      .from(callTrackingNumbers)
      .where(eq(callTrackingNumbers.dynamicNumber, to))
      .limit(1);

    if (trackingRecord) {
      await db.insert(trackedCalls).values({
        websiteId: trackingRecord.websiteId,
        pageId: trackingRecord.pageId,
        serviceId: trackingRecord.serviceId,
        locationId: trackingRecord.locationId ?? null,
        dynamicNumber: to,
        callerPhoneHash,
        callDurationSeconds: CallDuration ? parseInt(CallDuration, 10) : null,
        callTimestamp: Timestamp ? new Date(Timestamp) : new Date(),
        callStatus: CallStatus ?? null,
        callProviderId: CallSid,
      });
      console.log(`[call-tracking] Recorded call ${CallSid} — ${CallStatus} — ${CallDuration ?? "?"}s`);
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error("Error in twilio-status webhook:", error);
    return res.sendStatus(200);
  }
});

// POST /api/call-tracking/webhook
// 🔒 UNTOUCHED: write path — Drizzle insert works fine
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

    // ✅ CHANGED: raw SQL to fix Drizzle ORM camelCase→snake_case bug in production
    let query = `SELECT page_id, service_id, call_duration_seconds FROM tracked_calls WHERE website_id = $1`;
    const params: any[] = [websiteId];
    if (month) {
      const [year, monthNum] = month.split("-").map(Number);
      params.push(new Date(year, monthNum - 1, 1));
      params.push(new Date(year, monthNum, 1));
      query += ` AND call_timestamp >= $2 AND call_timestamp < $3`;
    }

    const callsRes = await pool.query(query, params);
    const calls = callsRes.rows.map((r: any) => ({
      pageId:              r.page_id,
      serviceId:           r.service_id,
      callDurationSeconds: r.call_duration_seconds,
    }));

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
