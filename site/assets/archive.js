// Archive filtering + full-text search, all client-side (static hosting).
// Filter state lives in the URL query string, so filtered views are
// shareable. URL parameter contract (keep in sync with shared/filters.ts):
//   q, topic, region, org, type, week

(function () {
  "use strict";

  var form = document.getElementById("filters");
  var results = document.getElementById("results");
  var countEl = document.getElementById("count");
  var noResults = document.getElementById("no-results");
  if (!form || !results) return;
  var rows = Array.prototype.slice.call(results.querySelectorAll(".archive-row"));
  var total = rows.length;
  var base = document.documentElement.getAttribute("data-base") || "/";
  if (base.charAt(base.length - 1) !== "/") base += "/";
  var indexPromise = fetch(base + "search-index.json")
    .then(function (r) { return r.ok ? r.json() : []; })
    .catch(function () { return []; });
  var textById = {};
  indexPromise.then(function (idx) {
    (idx || []).forEach(function (entry) { textById[entry.id] = (entry.body || "") + " " + entry.title; });
  });

  function params() {
    return new URLSearchParams(window.location.search);
  }

  function applyToForm(p) {
    ["q", "topic", "region", "org", "type", "week"].forEach(function (k) {
      if (form.elements[k]) form.elements[k].value = p.get(k) || "";
    });
  }

  function norm(s) {
    return (s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  }

  function rowPasses(row, p, text) {
    var topic = p.get("topic"), region = p.get("region"),
        org = p.get("org"), type = p.get("type"), week = p.get("week"),
        q = p.get("q");
    if (topic && row.getAttribute("data-topics").split(" ").indexOf(topic) === -1) return false;
    if (region && row.getAttribute("data-region") !== region) return false;
    if (type && row.getAttribute("data-type") !== type) return false;
    if (week && row.getAttribute("data-week") !== week) return false;
    if (org && row.getAttribute("data-org").indexOf(norm(org)) === -1) return false;
    if (q) {
      var terms = norm(q).split(/\s+/).filter(Boolean);
      var haystack = norm(row.textContent + " " + (text || ""));
      for (var i = 0; i < terms.length; i++) {
        if (haystack.indexOf(terms[i]) === -1) return false;
      }
    }
    return true;
  }

  function apply() {
    var p = params();
    applyToForm(p);
    indexPromise.then(function () {
      var shown = 0;
      rows.forEach(function (row) {
        var id = row.getAttribute("data-id");
        var pass = rowPasses(row, p, textById[id] || "");
        row.classList.toggle("hide", !pass);
        if (pass) shown++;
      });
      if (countEl) {
        countEl.textContent = shown + " of " + total + " item(s) shown";
      }
      if (noResults) noResults.hidden = shown !== 0 || total === 0;
    });
  }

  function toQuery(p) {
    var parts = [];
    ["q", "topic", "region", "org", "type", "week"].forEach(function (k) {
      var v = (p.get(k) || "").trim();
      if (v) parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
    });
    return parts.length ? "?" + parts.join("&") : window.location.pathname;
  }

  form.addEventListener("input", function () {
    var p = new URLSearchParams();
    ["q", "topic", "region", "org", "type", "week"].forEach(function (k) {
      if (form.elements[k] && form.elements[k].value) p.set(k, form.elements[k].value);
    });
    // Shareable URL: replace state instead of pushing, so back button stays sane.
    window.history.replaceState(null, "", toQuery(p));
    apply();
  });

  form.addEventListener("reset", function () {
    window.setTimeout(function () {
      window.history.replaceState(null, "", window.location.pathname);
      apply();
    }, 0);
  });

  apply();
})();
