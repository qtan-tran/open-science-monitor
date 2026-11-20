// Optional LLM assistance (OpenAI-compatible chat-completions API).
//
// When secrets are configured (LLM_API_KEY; optional LLM_BASE_URL,
// LLM_MODEL), the pipeline asks the model for topic classification and
// draft "What changed" / "Why it matters" text, grounded only in the feed
// text provided. Without secrets, everything still runs and items are
// simply marked "pending editorial review".
//
// LLM output is always a *suggestion*: it is stored in the event record
// (llm_suggestions) and used as draft text while editorial_status remains
// "pending". Source data is kept complete so a human can verify every claim.

import type { Event, Topic, RawFeedItem } from "../../shared/types.ts";
import { TOPICS } from "../../shared/types.ts";
import { scoreCandidate } from "./score.ts";

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export function llmConfigFromEnv(env = process.env): LlmConfig | null {
  const apiKey = env.LLM_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env.LLM_BASE_URL ?? "https://api.mistral.ai/v1").replace(/\/$/, ""),
    model: env.LLM_MODEL ?? "mistral-small-latest",
  };
}

interface LlmResponseItem {
  id?: string;
  topics?: string[];
  what_changed?: string;
  why_it_matters?: string;
}

/**
 * Ask the model to draft editorial fields for candidate events.
 * Returns a map of event id -> suggestion. Failures are non-fatal: the
 * pipeline continues with heuristic stubs.
 */
export async function draftSuggestions(
  events: Event[],
  feedItems: Map<string, RawFeedItem[]>,
  config: LlmConfig,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 90000,
): Promise<Map<string, { topics: string[]; what_changed: string; why_it_matters: string }>> {
  const out = new Map<string, { topics: string[]; what_changed: string; why_it_matters: string }>();
  if (events.length === 0) return out;

  const payload = events.map((ev) => {
    const summaries = (feedItems.get(ev.id) ?? []).map((i) => i.summary).join(" ");
    return {
      id: ev.id,
      title: ev.title,
      organization: ev.organization,
      date: ev.dates.published ?? ev.dates.discovered,
      sources: ev.sources.map((s) => s.url),
      text: summaries.slice(0, 2500),
    };
  });

  const system = [
    "You assist an editorial pipeline for an Open Access / Open Science policy newsletter.",
    `Classify each item with topics from this fixed list only: ${TOPICS.join(", ")}.`,
    "For each item write 'what_changed' and 'why_it_matters' (2 short paragraphs each).",
    "Rules: ground every statement strictly in the provided title/text/url; do not invent facts, dates, numbers or claims; do not speculate beyond the source text; write in clear neutral English; the audience is researchers, librarians, scholarly communication practitioners, funders and policy analysts.",
    "Return ONLY a JSON object: {\"items\":[{\"id\":..., \"topics\":[...], \"what_changed\":..., \"why_it_matters\":...}]}",
  ].join(" ");

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchFn(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        signal: ctl.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: JSON.stringify({ items: payload }) },
          ],
        }),
      });
      if (!res.ok) {
        console.error(`LLM assist skipped: HTTP ${res.status}`);
        return out;
      }
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = json.choices?.[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(content) as { items?: LlmResponseItem[] };
      for (const item of parsed.items ?? []) {
        if (!item.id) continue;
        const validTopics = (item.topics ?? []).filter((t): t is Topic =>
          (TOPICS as readonly string[]).includes(t),
        );
        out.set(item.id, {
          topics: validTopics,
          what_changed: (item.what_changed ?? "").trim(),
          why_it_matters: (item.why_it_matters ?? "").trim(),
        });
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.error(`LLM assist failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
  }
  return out;
}

/** Apply LLM drafts as pending-review draft text on events. */
export function applySuggestions(
  events: Event[],
  suggestions: Map<string, { topics: string[]; what_changed: string; why_it_matters: string }>,
  model: string,
): Event[] {
  return events.map((ev) => {
    const s = suggestions.get(ev.id);
    if (!s) return ev;
    const heuristic = scoreCandidate(ev.title, ev.sources.map((x) => x.label).join(" "));
    const topics = (s.topics.length > 0 ? s.topics : heuristic.topics.length > 0 ? heuristic.topics : ev.topics) as Event["topics"];
    return {
      ...ev,
      topics,
      what_changed: s.what_changed.length >= 40 ? s.what_changed : ev.what_changed,
      why_it_matters: s.why_it_matters.length >= 40 ? s.why_it_matters : ev.why_it_matters,
      editorial_status: "pending", // suggestions are drafts, never "edited"
      llm_suggestions: {
        model,
        topics: s.topics,
        what_changed: s.what_changed,
        why_it_matters: s.why_it_matters,
      },
    };
  });
}
