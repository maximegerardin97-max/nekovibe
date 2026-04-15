// ===== Zendesk View =====

const zdState = {
  currentPage: 1,
  pageSize: 50,
  filters: { status: "", clinic: "", dateFrom: "", dateTo: "", search: "" },
  initialized: false,
};

// ---- Helpers ----

function waitForWindow(key, cb, maxWait = 5000) {
  const start = Date.now();
  const poll = () => {
    if (window[key]) { cb(); return; }
    if (Date.now() - start > maxWait) { console.warn(`[zendesk-view] window.${key} not available after ${maxWait}ms`); return; }
    setTimeout(poll, 80);
  };
  poll();
}

function waitForSupabase(cb) {
  waitForWindow("supabaseClient", cb);
}

function zdEscapeHtml(text) {
  if (typeof window.escapeHtml === "function") return window.escapeHtml(text);
  const div = document.createElement("div");
  div.textContent = String(text ?? "");
  return div.innerHTML;
}

// ---- Ticket Insights (last 100, AI-powered) ----

const INSIGHTS_CACHE_KEY = "nekovibe_zd_insights";
const INSIGHTS_CORPUS_KEY = "nekovibe_zd_corpus";
const INSIGHTS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let _insightCorpus = ""; // shared with chat

function saveInsightsCache(themes, corpus) {
  try {
    localStorage.setItem(INSIGHTS_CACHE_KEY, JSON.stringify({ themes, ts: Date.now() }));
    localStorage.setItem(INSIGHTS_CORPUS_KEY, corpus);
  } catch (e) { /* storage full — skip */ }
}

function loadInsightsCache() {
  try {
    const raw = localStorage.getItem(INSIGHTS_CACHE_KEY);
    if (!raw) return null;
    const { themes, ts } = JSON.parse(raw);
    if (Date.now() - ts > INSIGHTS_TTL_MS) return null; // stale
    return themes;
  } catch { return null; }
}

function loadCorpusCache() {
  try { return localStorage.getItem(INSIGHTS_CORPUS_KEY) || ""; } catch { return ""; }
}

async function loadTicketInsights(force = false) {
  const sc = window.supabaseClient;
  const grid = document.getElementById("zd-insights-grid");
  if (!grid || !sc) return;

  // Serve from cache if fresh
  if (!force) {
    const cached = loadInsightsCache();
    if (cached) {
      _insightCorpus = loadCorpusCache();
      renderInsightCards(cached);
      return;
    }
  }

  grid.innerHTML = '<span class="topic-chips-loading">Analysing last 100 tickets…</span>';

  try {
    // 1. Fetch last 100 tickets
    const { data, error } = await sc.from("zendesk_tickets")
      .select("subject, description, contact_reason, category")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;

    // 2. Build a lightweight subjects-only corpus for LLM clustering
    const subjectsOnly = (data || []).map((t, i) => {
      const subj = (t.subject || "").replace(/^Message from:.*?\+\d+\s*/i, "SMS: ").trim() || "—";
      const snippet = (t.description || "").slice(0, 80).replace(/\n/g, " ").trim();
      return `${i + 1}. ${subj}${snippet ? " — " + snippet : ""}`;
    }).join("\n");

    // 3. Build full corpus for chat context
    _insightCorpus = (data || []).map((t, i) =>
      `[${i + 1}] Subject: ${t.subject || "—"}\nContent: ${(t.description || "").slice(0, 300)}`
    ).join("\n\n");

    // 4. Ask the LLM to cluster
    const functionUrl = document.body.dataset.functionUrl || "";
    const functionKey = document.body.dataset.apikey || "";
    const prompt =
      `[ANALYSIS REQUEST] These are the subjects/first lines of 100 recent customer support tickets from Neko Health (preventive health scanning company). Identify the top 5–7 distinct contact reasons. For each return a JSON object: "name" (3–5 words), "count" (integer out of 100), "description" (one sentence), "sentiment" (one of: "positive", "negative", "mixed", "neutral"). Return ONLY a JSON array, no markdown, no extra text.\n\nTickets:\n${subjectsOnly}`;

    const headers = { "Content-Type": "application/json" };
    if (functionKey) { headers.apikey = functionKey; headers.Authorization = `Bearer ${functionKey}`; }

    const resp = await fetch(functionUrl, { method: "POST", headers, body: JSON.stringify({ prompt, sources: ["zendesk"] }) });
    if (!resp.ok) throw new Error(await resp.text());
    const result = await resp.json();

    const answer = result.answer || "";
    const jsonMatch = answer.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("AI did not return a parseable JSON array");
    const themes = JSON.parse(jsonMatch[0]);

    saveInsightsCache(themes, _insightCorpus);
    renderInsightCards(themes);
  } catch (e) {
    console.error("[zendesk-view] insights error", e);
    grid.innerHTML = `<span class="topic-chips-empty" style="color:#dc2626">Could not load insights: ${zdEscapeHtml(e.message)}</span>`;
  }
}

function renderInsightCards(themes) {
  const grid = document.getElementById("zd-insights-grid");
  if (!grid) return;
  const validSentiments = new Set(["positive", "negative", "mixed", "neutral"]);
  grid.innerHTML = themes.map(t => {
    const sentiment = validSentiments.has(t.sentiment) ? t.sentiment : "neutral";
    return `<button class="topic-chip sentiment-${sentiment}" title="${zdEscapeHtml(t.description)}" type="button">
      ${zdEscapeHtml(t.name)}<span class="topic-count">${t.count}</span>
    </button>`;
  }).join("");
}

function setupInsights() {
  document.getElementById("zd-refresh-insights")?.addEventListener("click", () => {
    waitForSupabase(() => loadTicketInsights(true)); // force = true bypasses cache
  });
}

// ---- Clinic Dropdowns ----

async function loadZendeskClinics() {
  const sc = window.supabaseClient;
  if (!sc) return;
  try {
    const [tRes, cRes] = await Promise.allSettled([
      sc.from("zendesk_tickets").select("clinic_name"),
      sc.from("zendesk_csat").select("clinic_name"),
    ]);
    const names = [
      ...(tRes.status === "fulfilled" ? (tRes.value.data || []) : []),
      ...(cRes.status === "fulfilled" ? (cRes.value.data || []) : []),
    ].map(r => r.clinic_name).filter(Boolean);

    let optionsHtml;
    if (typeof window.buildClinicOptions === "function") {
      const allClinics = [...new Set(names)];
      optionsHtml = window.buildClinicOptions(allClinics);
    } else {
      const unique = [...new Set(names)].sort();
      optionsHtml = '<option value="">All Clinics</option>' +
        unique.map(c => `<option value="${zdEscapeHtml(c)}">${zdEscapeHtml(c)}</option>`).join("");
    }

    [
      document.getElementById("zendesk-chat-clinic-filter"),
      document.getElementById("zd-filter-clinic"),
    ].forEach(sel => { if (sel) sel.innerHTML = optionsHtml; });
  } catch (e) {
    console.error("[zendesk-view] loadZendeskClinics error", e);
  }
}

// ---- Tickets Table ----

async function loadZendeskTickets() {
  const sc = window.supabaseClient;
  if (!sc) { updateZendeskTicketsTable([], "Supabase not initialized."); return; }

  const tbody = document.getElementById("zd-tickets-tbody");
  if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="loading-state">Loading tickets...</td></tr>';

  try {
    let q = sc.from("zendesk_tickets")
      .select("created_at, subject, description", { count: "estimated" });

    if (zdState.filters.dateFrom) q = q.gte("created_at", zdState.filters.dateFrom);
    if (zdState.filters.dateTo) {
      const end = new Date(zdState.filters.dateTo);
      end.setDate(end.getDate() + 1);
      q = q.lt("created_at", end.toISOString().split("T")[0]);
    }
    if (zdState.filters.search) {
      const s = zdState.filters.search;
      q = q.or(`subject.ilike.%${s}%,description.ilike.%${s}%`);
    }

    q = q.order("created_at", { ascending: false });
    const from = (zdState.currentPage - 1) * zdState.pageSize;
    q = q.range(from, from + zdState.pageSize - 1);

    const { data, error, count } = await q;
    if (error) throw error;

    updateZendeskTicketsPagination(count || 0, from);
    updateZendeskTicketsTable(data || [], null);
  } catch (e) {
    console.error("[zendesk-view] loadZendeskTickets error", e);
    updateZendeskTicketsTable([], `Error: ${e.message}`);
  }
}

function updateZendeskTicketsPagination(total, from) {
  const countSpan = document.getElementById("zd-tickets-count");
  const prevBtn   = document.getElementById("zd-prev-page");
  const nextBtn   = document.getElementById("zd-next-page");
  const pageInfo  = document.getElementById("zd-page-info");
  const maxPage   = Math.ceil(total / zdState.pageSize);

  if (countSpan) {
    const start = total > 0 ? from + 1 : 0;
    const end   = Math.min(from + zdState.pageSize, total);
    countSpan.textContent = `Showing ${start}–${end} of ${total} tickets`;
  }
  if (prevBtn) prevBtn.disabled = zdState.currentPage === 1;
  if (nextBtn) nextBtn.disabled = zdState.currentPage >= maxPage;
  if (pageInfo) pageInfo.textContent = `Page ${zdState.currentPage} of ${maxPage || 1}`;
}

function updateZendeskTicketsTable(rows, errorMessage) {
  const tbody = document.getElementById("zd-tickets-tbody");
  if (!tbody) return;

  if (errorMessage) {
    tbody.innerHTML = `<tr><td colspan="3" class="error-state">${zdEscapeHtml(errorMessage)}</td></tr>`;
    return;
  }
  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-state">No tickets found matching your filters.</td></tr>';
    return;
  }

  const toggleComment = window.toggleComment || function(commentId) {
    const textSpan = document.getElementById(`${commentId}-text`);
    const fullSpan = document.getElementById(`${commentId}-full`);
    const button   = document.querySelector(`[data-comment-id="${commentId}"]`);
    if (!textSpan || !fullSpan || !button) return;
    const isExpanded = fullSpan.style.display !== "none";
    textSpan.style.display = isExpanded ? "inline" : "none";
    fullSpan.style.display  = isExpanded ? "none"   : "inline";
    button.textContent = isExpanded ? "Show more" : "Show less";
  };
  window.toggleComment = window.toggleComment || toggleComment;

  tbody.innerHTML = rows.map((ticket, idx) => {
    const date    = ticket.created_at
      ? new Date(ticket.created_at).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" })
      : "N/A";
    const subject = ticket.subject || "—";
    const body    = (ticket.description || "").trim();
    const commentId = `zd-comment-${idx}`;
    const maxLen  = 200;
    const isTruncated = body.length > maxLen;
    const truncated = isTruncated ? body.slice(0, maxLen) + "..." : body;

    return `<tr>
      <td class="review-date" style="white-space:nowrap">${zdEscapeHtml(date)}</td>
      <td style="font-weight:500">${zdEscapeHtml(subject)}</td>
      <td class="review-comment">
        <span class="comment-text" id="${commentId}-text">${zdEscapeHtml(truncated)}</span>
        ${isTruncated ? `<span class="comment-full" id="${commentId}-full" style="display:none">${zdEscapeHtml(body)}</span><button class="comment-toggle" data-comment-id="${commentId}" onclick="toggleComment('${commentId}')">Show more</button>` : ""}
      </td>
    </tr>`;
  }).join("");
}

function setupZendeskTicketsTable() {
  document.getElementById("zd-apply-filters")?.addEventListener("click", () => {
    zdState.filters = {
      dateFrom: document.getElementById("zd-filter-date-from")?.value || "",
      dateTo:   document.getElementById("zd-filter-date-to")?.value   || "",
      search:   document.getElementById("zd-filter-search")?.value    || "",
    };
    zdState.currentPage = 1;
    loadZendeskTickets();
  });

  document.getElementById("zd-clear-filters")?.addEventListener("click", () => {
    ["zd-filter-date-from","zd-filter-date-to","zd-filter-search"]
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    zdState.filters = { dateFrom: "", dateTo: "", search: "" };
    zdState.currentPage = 1;
    loadZendeskTickets();
  });

  document.getElementById("zd-prev-page")?.addEventListener("click", () => {
    if (zdState.currentPage > 1) { zdState.currentPage--; loadZendeskTickets(); }
  });
  document.getElementById("zd-next-page")?.addEventListener("click", () => {
    zdState.currentPage++;
    loadZendeskTickets();
  });
}

// ---- Chat ----

function setupZendeskChat() {
  const chatStream   = document.getElementById("zendesk-chat-stream");
  const form         = document.getElementById("zendesk-ask-form");
  const textarea     = document.getElementById("zendesk-prompt");
  const clinicFilter = document.getElementById("zendesk-chat-clinic-filter");
  const dateFrom     = document.getElementById("zendesk-chat-date-from");
  const dateTo       = document.getElementById("zendesk-chat-date-to");
  const clearBtn     = document.getElementById("zendesk-chat-clear-filters");

  if (!chatStream || !form || !textarea) return;

  const functionUrl = document.body.dataset.functionUrl || "";
  const functionKey = document.body.dataset.apikey || "";

  const state = { pending: false };

  const getFilters = () => {
    const clinic   = clinicFilter?.value?.trim() || "";
    const dFrom    = dateFrom?.value || "";
    const dTo      = dateTo?.value || "";
    return (!clinic && !dFrom && !dTo) ? null : { clinic, dateFrom: dFrom, dateTo: dTo };
  };

  clearBtn?.addEventListener("click", () => {
    if (clinicFilter) clinicFilter.value = "";
    if (dateFrom) dateFrom.value = "";
    if (dateTo) dateTo.value = "";
  });

  const appendMsg = window.appendMessageToStream || function(stream, msg) {
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${msg.role === "user" ? "user" : "assistant"}`;
    if (msg.pending) bubble.classList.add("pending");
    bubble.textContent = msg.content;
    stream.appendChild(bubble);
    stream.scrollTop = stream.scrollHeight;
    return null;
  };

  const replaceMsg = window.replaceMessageInStream || function(stream, id, msg) {
    appendMsg(stream, msg);
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.pending) return;
    const rawPrompt = textarea.value.trim();
    if (!rawPrompt) { textarea.focus(); return; }

    const contextPrefix = _insightCorpus
      ? `[CONTEXT: Last 100 Zendesk tickets]\n${_insightCorpus}\n\n[USER QUESTION]: `
      : "[Zendesk data] ";
    const prompt = contextPrefix + rawPrompt;
    const filters = getFilters();

    appendMsg(chatStream, { role: "user", content: rawPrompt });
    textarea.value = "";
    const loadingId = appendMsg(chatStream, { role: "assistant", content: "Thinking…" }, true);
    state.pending = true;

    try {
      const headers = { "Content-Type": "application/json" };
      if (functionKey) { headers.apikey = functionKey; headers.Authorization = `Bearer ${functionKey}`; }
      const payload = { prompt, sources: ["zendesk"] };
      if (filters) payload.filters = filters;

      const response = await fetch(functionUrl, { method: "POST", headers, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();

      replaceMsg(chatStream, loadingId, {
        role: "assistant",
        content: data.answer ?? "No answer returned.",
      });
    } catch (error) {
      console.error("[zendesk-view] chat error", error);
      replaceMsg(chatStream, loadingId, {
        role: "assistant",
        content: "I couldn't reach Nekovibe right now. Please try again.",
      });
    } finally {
      state.pending = false;
      textarea.focus();
    }
  });

  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); }
  });
}

// ---- Public API ----

export function activateZendeskTab() {
  window.activateZendeskTab = activateZendeskTab;
  if (!zdState.initialized) return; // will be called again once init is done
  waitForSupabase(() => {
    loadZendeskClinics();
    loadZendeskTickets();
    loadTicketInsights(); // uses cache if fresh
  });
}
window.activateZendeskTab = activateZendeskTab;

export function setupZendeskView() {
  window.setupZendeskView = setupZendeskView;
  setupZendeskChat();
  setupInsights();
  setupZendeskTicketsTable();
  zdState.initialized = true;

  waitForSupabase(() => {
    loadZendeskClinics();
  });
}
window.setupZendeskView = setupZendeskView;

// Auto-init (module-scope self-call when loaded)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => setupZendeskView());
} else {
  setTimeout(() => setupZendeskView(), 150);
}
