// Archive filter state <-> URL query serialisation tests (the shareable-link contract).
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  emptyFilterState,
  filtersToQuery,
  filterStateIsDefault,
  itemMatchesFilters,
  parseFiltersFromQuery,
} from "../shared/filters.ts";

test("default state serialises to an empty query and reparses clean", () => {
  assert.equal(filtersToQuery(emptyFilterState()), "");
  assert.equal(filterStateIsDefault(parseFiltersFromQuery("")), true);
});

test("every filter survives a query round-trip (URL shared between users)", () => {
  const state = {
    q: "diamond  OA",
    topic: "diamond-oa",
    region: "Latin America & Caribbean",
    organization: "CLACSO",
    docType: "consultation",
    week: "2026-W45",
  };
  const query = filtersToQuery(state);
  assert.equal(query.startsWith("?"), true);
  const round = parseFiltersFromQuery(query);
  assert.deepEqual(round, state);
  assert.equal(filterStateIsDefault(round), false);
});

test("query param names are the short ones documented on the Archive page (q/topic/region/org/type/week)", () => {
  const query = filtersToQuery({
    q: "x",
    topic: "t",
    region: "r",
    organization: "o",
    docType: "d",
    week: "2026-W47",
  });
  const keys = query.slice(1).split("&").map((kv) => kv.split("=")[0]).sort();
  assert.deepEqual(keys, ["org", "q", "region", "topic", "type", "week"].sort());
});

test("parseFilters ignores unknown params and trims long free text", () => {
  const st = parseFiltersFromQuery("?foo=1&q=" + "y".repeat(300));
  assert.equal(st.q.length <= 200, true);
  assert.equal(st.topic, "");
});

test("itemMatchesFilters: faceted and AND text semantics", () => {
  const item = {
    title: "Diamond OA forum for the Global South",
    organization: "CLACSO",
    region: "Latin America & Caribbean",
    topics: ["diamond-oa", "equity"],
    docType: "report",
    week: "2026-W45",
    body: "what changed and why it matters text",
  };
  assert.equal(itemMatchesFilters(item, emptyFilterState()), true);
  assert.equal(
    itemMatchesFilters(item, { q: "", topic: "diamond-oa", region: "", organization: "", docType: "", week: "" }),
    true,
  );
  assert.equal(
    itemMatchesFilters(item, { q: "", topic: "licensing", region: "", organization: "", docType: "", week: "" }),
    false,
  );
  assert.equal(
    itemMatchesFilters(item, { q: "diamond global", topic: "", region: "", organization: "", docType: "", week: "" }),
    true,
  );
  assert.equal(
    itemMatchesFilters(item, { q: "diamond nonexistent-term", topic: "", region: "", organization: "", docType: "", week: "" }),
    false,
  );
  assert.equal(
    itemMatchesFilters(item, { q: "", topic: "", region: "", organization: "clacso", docType: "", week: "" }),
    true,
  );
  assert.equal(
    itemMatchesFilters(item, { q: "", topic: "", region: "", organization: "", docType: "", week: "2026-W46" }),
    false,
  );
});
