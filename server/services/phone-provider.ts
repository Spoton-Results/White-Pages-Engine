/**
 * Phone Provider Service
 *
 * Returns a Mock provider in development (no credentials required).
 * Returns a Twilio provider when TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN are set.
 *
 * To activate Twilio:
 *   1. Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to environment secrets.
 *   2. Set NEXUS_PUBLIC_URL to the deployed app URL (e.g. https://myapp.replit.app)
 *      so Twilio knows where to send voice webhooks.
 */

export interface ProvisionedNumber {
  phoneNumber: string;
  providerId: string | null;
  provider: "twilio" | "mock";
}

export interface PhoneProvider {
  provisionNumber(opts: {
    areaCode?: string;
    voiceWebhookUrl: string;
    statusCallbackUrl: string;
  }): Promise<ProvisionedNumber>;
}

// ── Mock provider (development / no credentials) ─────────────────────────────

class MockPhoneProvider implements PhoneProvider {
  async provisionNumber(): Promise<ProvisionedNumber> {
    const num = `+1555${Math.floor(Math.random() * 9000000 + 1000000)}`;
    console.log(`[phone-provider:mock] Provisioned placeholder number: ${num}`);
    console.log(`[phone-provider:mock] Set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN to use real numbers.`);
    return { phoneNumber: num, providerId: null, provider: "mock" };
  }
}

// ── Twilio provider (production) ─────────────────────────────────────────────

class TwilioPhoneProvider implements PhoneProvider {
  private accountSid: string;
  private authHeader: string;

  constructor(accountSid: string, authToken: string) {
    this.accountSid = accountSid;
    this.authHeader = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
  }

  private async twilioGet(path: string): Promise<any> {
    const res = await fetch(`https://api.twilio.com${path}`, {
      headers: { Authorization: this.authHeader },
    });
    return res.json();
  }

  private async twilioPost(path: string, params: Record<string, string>): Promise<any> {
    const res = await fetch(`https://api.twilio.com${path}`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params).toString(),
    });
    return res.json();
  }

  async provisionNumber(opts: {
    areaCode?: string;
    voiceWebhookUrl: string;
    statusCallbackUrl: string;
  }): Promise<ProvisionedNumber> {
    const { areaCode, voiceWebhookUrl, statusCallbackUrl } = opts;

    // Search available US local numbers
    const searchParams = new URLSearchParams({ Limit: "1" });
    if (areaCode) searchParams.set("AreaCode", areaCode);

    const searchData = await this.twilioGet(
      `/2010-04-01/Accounts/${this.accountSid}/AvailablePhoneNumbers/US/Local.json?${searchParams}`,
    );

    const available = searchData.available_phone_numbers?.[0];
    if (!available) {
      throw new Error("No available Twilio phone numbers found. Check your account balance and permissions.");
    }

    // Purchase the number
    const purchased = await this.twilioPost(
      `/2010-04-01/Accounts/${this.accountSid}/IncomingPhoneNumbers.json`,
      {
        PhoneNumber: available.phone_number,
        VoiceUrl: voiceWebhookUrl,
        VoiceMethod: "POST",
        StatusCallback: statusCallbackUrl,
        StatusCallbackMethod: "POST",
      },
    );

    if (!purchased.phone_number) {
      throw new Error(`Twilio purchase failed: ${purchased.message ?? JSON.stringify(purchased)}`);
    }

    console.log(`[phone-provider:twilio] Provisioned ${purchased.phone_number} (SID: ${purchased.sid})`);
    return {
      phoneNumber: purchased.phone_number,
      providerId: purchased.sid,
      provider: "twilio",
    };
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

let _provider: PhoneProvider | null = null;

export function getPhoneProvider(): PhoneProvider {
  if (_provider) return _provider;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (accountSid && authToken) {
    console.log("[phone-provider] Twilio credentials detected — using Twilio provider.");
    _provider = new TwilioPhoneProvider(accountSid, authToken);
  } else {
    console.log("[phone-provider] No Twilio credentials — using mock provider (placeholder numbers).");
    _provider = new MockPhoneProvider();
  }

  return _provider;
}

/**
 * Returns the base URL Twilio should call for voice webhooks.
 * Reads NEXUS_PUBLIC_URL env var; falls back to a localhost note.
 */
export function getPublicBaseUrl(): string {
  return process.env.NEXUS_PUBLIC_URL?.replace(/\/$/, "") ?? "http://localhost:5000";
}
