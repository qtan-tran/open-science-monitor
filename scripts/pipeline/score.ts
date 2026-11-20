// Heuristic relevance scoring and topic suggestions (fallback when no LLM
// is configured, and input to human editorial review either way).

import type { Topic } from "../../shared/types.ts";

interface TopicLexicon {
  topic: Topic;
  patterns: RegExp[];
  weight: number;
}

const LEXICON: TopicLexicon[] = [
  {
    topic: "oa-policy",
    patterns: [/open access polic/i, /\boa polic/i, /public access/, /oa mandate/i, /open science polic/i],
    weight: 2,
  },
  {
    topic: "funder-mandates",
    patterns: [/plan s\b/i, /coalition s\b/i, /funder.{0,30}(mandate|polic|require)/i, /grant (condition|polic)/i, /research funder/i],
    weight: 2,
  },
  { topic: "consultations", patterns: [/consultation/i, /call for (input|evidence|comments)/i, /request for information/i, /public comment/i, /rfi\b/i], weight: 2 },
  { topic: "diamond-oa", patterns: [/diamond/i], weight: 2 },
  {
    topic: "apc-bpc",
    patterns: [/\bapcs?\b/i, /\bbpcs?\b/i, /article[- ]processing charge/i, /book processing charge/i, /publication (fee|cost)s?/i, /author fee/i, /\bfee\b/i],
    weight: 2,
  },
  { topic: "transformative-agreements", patterns: [/transformative (agreement|arrangement)/i, /read (and|&) publish/i, /publish (and|&) read/i], weight: 2 },
  { topic: "business-models", patterns: [/business model/i, /subscription/i, /big deal/i, /pricing/i, /journals? market/i], weight: 1 },
  { topic: "repositories", patterns: [/repositor(y|ies)/i, /zenodo/i, /green open access/i, /\boai-pmh\b/i, /institutional archive/i], weight: 1 },
  { topic: "rights-retention", patterns: [/rights retention/i, /\brrs\b/i, /secondary publication right/i, /copyright.{0,40}(retention|policy)/i], weight: 2 },
  { topic: "licensing", patterns: [/licen[cs]e/i, /licensing/i, /cc[- ]by/i, /creative commons/i, /public domain/i], weight: 1 },
  { topic: "research-data", patterns: [/research data/i, /data management plan/i, /\bfair\b.{0,20}data/i, /data sharing/i, /data polic/i, /\bfair principles/i], weight: 2 },
  {
    topic: "research-assessment",
    patterns: [/research assessment/i, /research evaluation/i, /\b(dora|coara)\b/i, /responsible (assessment|evaluation)/i, /narrative cv/i, /\bh-index\b/i, /research metrics/i, /recognition (and|&) rewards/i],
    weight: 2,
  },
  { topic: "equity", patterns: [/equity/i, /global south/i, /low[- ](?:and|&)? ?middle[- ]income/i, /\blmics?\b/i, /inequalit/i, /inclusion/i], weight: 1 },
  { topic: "multilingualism", patterns: [/multilingual/i, /language barrier/i, /non[- ]english/i, /\bhdlac\b/i, /linguistic diversity/i], weight: 1 },
  { topic: "indigenous-data", patterns: [/indigenous/i, /first nations/i, /tribal data/i, /\bcared\b/i, /\bm(ā|a)ori\b.{0,30}data/i, /local knowledge/i], weight: 2 },
  {
    topic: "infrastructure",
    patterns: [/infrastructure/i, /\beosc\b/i, /\beuropa\b/i, /open science cloud/i, /\bpersistent identifier/i, /\b(doi|handle)s?\b.{0,30}infra/i, /open research europe/i, /platform.{0,30}(launch|service)/i],
    weight: 1,
  },
  { topic: "research-evidence", patterns: [/study (of|on|finds|shows)/i, /\bsurvey of\b/i, /\bwe (analy|survey|study|find)/i, /empirical/i, /\brespondents\b/i, /working paper/i], weight: 1 },
];

export interface ScoredCandidate {
  topics: Topic[];
  score: number;
}

/** Score title+summary against the topic lexicon. */
export function scoreCandidate(title: string, summary: string): ScoredCandidate {
  const text = `${title}\n${summary}`;
  const hits = new Map<Topic, number>();
  let score = 0;
  for (const entry of LEXICON) {
    for (const re of entry.patterns) {
      if (re.test(text)) {
        hits.set(entry.topic, (hits.get(entry.topic) ?? 0) + entry.weight);
        score += entry.weight;
        break; // one hit per topic enough
      }
    }
  }
  const topics = [...hits.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  return { topics, score };
}
