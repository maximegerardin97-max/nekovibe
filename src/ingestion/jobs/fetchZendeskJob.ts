/**
 * Zendesk Ingestion Job
 * Fetches support tickets and CSAT ratings from Zendesk API
 */

import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

// ─── Clinic name inference from group/subject ─────────────────────────────────
const CLINIC_TOKENS: Array<{ name: string; tokens: string[] }> = [
  { name: "Neko Health Marylebone",    tokens: ["marylebone", "w1"] },
  { name: "Neko Health Spitalfields",  tokens: ["spitalfields", "liverpool street"] },
  { name: "Neko Health Covent Garden", tokens: ["covent garden"] },
  { name: "Neko Health Victoria",      tokens: ["victoria"] },
  { name: "Neko Health Manchester",    tokens: ["manchester", "lincoln square"] },
  { name: "Neko Health Birmingham",    tokens: ["birmingham", "livery street", "colmore"] },
  { name: "Neko Health Östermalm",     tokens: ["östermalm", "ostermalm", "ostermalmstorg", "stockholm"] },
];

function inferClinicName(text: string): string | null {
  const lower = (text || "").toLowerCase();
  for (const clinic of CLINIC_TOKENS) {
    if (clinic.tokens.some((t) => lower.includes(t))) return clinic.name;
  }
  return null;
}

// ─── Zendesk API types ────────────────────────────────────────────────────────
interface ZendeskTicket {
  id: number;
  subject: string;
  description: string;
  status: string;
  priority: string | null;
  group_id: number | null;
  created_at: string;
  updated_at: string;
  custom_fields: Array<{ id: number; value: string | null }>;
  // satisfaction may be null if not yet rated
  satisfaction_rating?: { score: string } | null;
}

interface ZendeskTicketsResponse {
  tickets: ZendeskTicket[];
  next_page: string | null;
  count: number;
}

interface ZendeskSatisfactionRating {
  id: number;
  ticket_id: number;
  group_id: number | null;
  score: string;     // "good", "bad", "offered", "unoffered"
  comment: string | null;
  created_at: string;
  updated_at: string;
}

interface ZendeskCSATResponse {
  satisfaction_ratings: ZendeskSatisfactionRating[];
  next_page: string | null;
  count: number;
}

interface ZendeskGroup {
  id: number;
  name: string;
}

// Custom field IDs
const FIELD_CLOSING_CATEGORY = 5440588879903;
const FIELD_CONTACT_REASON   = 5435523165855;

function scoreToRating(score: string): number | null {
  if (score === "good") return 5;
  if (score === "bad")  return 1;
  // numeric values passed through (future-proofing for 1-5 surveys)
  const n = parseInt(score, 10);
  if (!isNaN(n) && n >= 1 && n <= 5) return n;
  return null; // "offered" / "unoffered" = no rating yet
}

export class FetchZendeskJob {
  name = 'fetchZendesk';

  private readonly subdomain: string;
  private readonly authHeader: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly supabase: any;
  private groupCache: Map<number, string> = new Map();

  constructor() {
    const subdomain = process.env.ZENDESK_SUBDOMAIN;
    const email     = process.env.ZENDESK_EMAIL;
    const token     = process.env.ZENDESK_API_TOKEN;
    const supabaseUrl  = process.env.SUPABASE_URL;
    const supabaseKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!subdomain) throw new Error('ZENDESK_SUBDOMAIN not set');
    if (!email)     throw new Error('ZENDESK_EMAIL not set');
    if (!token)     throw new Error('ZENDESK_API_TOKEN not set');
    if (!supabaseUrl || !supabaseKey) throw new Error('Supabase credentials not set');

    this.subdomain  = subdomain;
    this.authHeader = `Basic ${Buffer.from(`${email}/token:${token}`).toString('base64')}`;
    this.supabase   = createClient(supabaseUrl, supabaseKey);
  }

  private get baseUrl() {
    return `https://${this.subdomain}.zendesk.com/api/v2`;
  }

  private async zendeskFetch<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Zendesk API ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json() as Promise<T>;
  }

  /** Fetch all Zendesk groups and cache id → name */
  private async warmGroupCache(): Promise<void> {
    try {
      const data = await this.zendeskFetch<{ groups: ZendeskGroup[] }>(
        `${this.baseUrl}/groups.json`
      );
      for (const g of data.groups) {
        this.groupCache.set(g.id, g.name);
      }
      console.log(`  Loaded ${this.groupCache.size} Zendesk groups`);
    } catch (err) {
      console.warn('  Could not load Zendesk groups:', err);
    }
  }

  // ─── Tickets ────────────────────────────────────────────────────────────────
  private async fetchAllTickets(): Promise<{ added: number; skipped: number; errors: number }> {
    let added = 0, skipped = 0, errors = 0;
    let url: string | null = `${this.baseUrl}/tickets.json?sort_by=created_at&sort_order=desc&per_page=100`;

    while (url) {
      const data: ZendeskTicketsResponse = await this.zendeskFetch<ZendeskTicketsResponse>(url);
      console.log(`  Fetched ${data.tickets.length} tickets (total: ${data.count})`);

      for (const ticket of data.tickets) {
        try {
          const customField = (id: number) =>
            ticket.custom_fields?.find((f: { id: number; value: string | null }) => f.id === id)?.value ?? null;

          const groupName = ticket.group_id ? this.groupCache.get(ticket.group_id) ?? null : null;
          const clinicName = inferClinicName([groupName, ticket.subject].filter(Boolean).join(' '));

          const row = {
            external_id:    ticket.id,
            subject:        ticket.subject,
            description:    (ticket.description || '').slice(0, 10000),
            status:         ticket.status,
            priority:       ticket.priority,
            group_name:     groupName,
            category:       customField(FIELD_CLOSING_CATEGORY),
            contact_reason: customField(FIELD_CONTACT_REASON),
            clinic_name:    clinicName,
            created_at:     ticket.created_at,
            updated_at:     ticket.updated_at,
            raw_data:       ticket,
          };

          const { error } = await this.supabase
            .from('zendesk_tickets')
            .upsert(row, { onConflict: 'external_id' });

          if (error) {
            console.error(`  Ticket ${ticket.id} error:`, error.message);
            errors++;
          } else {
            added++;
          }
        } catch (err: any) {
          console.error(`  Ticket ${ticket.id} exception:`, err.message);
          errors++;
        }
      }

      url = data.next_page;
      // Respect Zendesk rate limits
      if (url) await new Promise((r) => setTimeout(r, 300));
    }

    return { added, skipped, errors };
  }

  // ─── CSAT ───────────────────────────────────────────────────────────────────
  private async fetchAllCSAT(): Promise<{ added: number; skipped: number; errors: number }> {
    let added = 0, skipped = 0, errors = 0;
    let url: string | null = `${this.baseUrl}/satisfaction_ratings.json?per_page=100&sort_order=desc`;

    while (url) {
      const data: ZendeskCSATResponse = await this.zendeskFetch<ZendeskCSATResponse>(url);
      console.log(`  Fetched ${data.satisfaction_ratings.length} CSAT ratings`);

      for (const csat of data.satisfaction_ratings) {
        const rating = scoreToRating(csat.score);
        if (rating === null) {
          skipped++;
          continue; // Skip "offered" / "unoffered" (no response yet)
        }

        try {
          // Try to infer clinic from the associated ticket (via group cache)
          const groupName = csat.group_id ? this.groupCache.get(csat.group_id) ?? null : null;
          const clinicName = groupName ? inferClinicName(groupName) : null;

          const row = {
            external_id: csat.id,
            ticket_id:   csat.ticket_id,
            rating,
            comment:     csat.comment,
            clinic_name: clinicName,
            created_at:  csat.created_at,
            raw_data:    csat,
          };

          const { error } = await this.supabase
            .from('zendesk_csat')
            .upsert(row, { onConflict: 'external_id' });

          if (error) {
            console.error(`  CSAT ${csat.id} error:`, error.message);
            errors++;
          } else {
            added++;
          }
        } catch (err: any) {
          console.error(`  CSAT ${csat.id} exception:`, err.message);
          errors++;
        }
      }

      url = data.next_page;
      if (url) await new Promise((r) => setTimeout(r, 300));
    }

    return { added, skipped, errors };
  }

  async run(): Promise<{ added: number; skipped: number; errors: number }> {
    console.log('Starting Zendesk ingestion...');

    await this.warmGroupCache();

    console.log('\n--- Tickets ---');
    const ticketResult = await this.fetchAllTickets();
    console.log(`  Upserted: ${ticketResult.added}, Errors: ${ticketResult.errors}`);

    console.log('\n--- CSAT ---');
    const csatResult = await this.fetchAllCSAT();
    console.log(`  Upserted: ${csatResult.added}, Skipped (no score): ${csatResult.skipped}, Errors: ${csatResult.errors}`);

    const total = {
      added:   ticketResult.added + csatResult.added,
      skipped: ticketResult.skipped + csatResult.skipped,
      errors:  ticketResult.errors + csatResult.errors,
    };

    console.log(`\n✅ Zendesk ingestion complete — Added: ${total.added}, Skipped: ${total.skipped}, Errors: ${total.errors}`);
    return total;
  }
}
