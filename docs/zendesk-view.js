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

let _insightCorpus = ""; // shared with chat

async function loadTicketInsights() {
  const sc = window.supabaseClient;
  const grid = document.getElementById("zd-insights-grid");
  if (!grid || !sc) return;

  grid.innerHTML = '<div class="zd-insights-loading">Analysing last 100 tickets with AI…</div>';

  try {
    // 1. Fetch last 100 tickets
    const { data, error } = await sc.from("zendesk_tickets")
      .select("subject, description, contact_reason, category")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;

    // 2. Build corpus (also used by chat)
    _insightCorpus = (data || []).map((t, i) =>
      `[${i + 1}] Subject: ${t.subject || "—"}\nContent: ${(t.description || "").slice(0, 250)}`
    ).join("\n\n");

    // 3. Ask the LLM to cluster into themes
    const functionUrl = document.body.dataset.functionUrl || "";
    const functionKey = document.body.dataset.apikey || "";

    const prompt =
      `[ANALYSIS REQUEST] You are analysing 100 recent customer support tickets from Neko Health, a preventive health screening company.\n\nIdentify the top 5–7 distinct reasons why customers contact us. For each reason return a JSON object with:\n- "name": short label (3–5 words max)\n- "count": estimated number of tickets matching this reason (integer, out of 100)\n- "description": one clear sentence explaining what customers ask about\n- "emoji": a single relevant emoji\n\nReturn ONLY a valid JSON array with no extra text, no markdown fences.\n\nTickets:\n${_insightCorpus}`;

    const headers = { "Content-Type": "application/json" };
    if (functionKey) { headers.apikey = functionKey; headers.Authorization = `Bearer ${functionKey}`; }

    const resp = await fetch(functionUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt, sources: ["zendesk"] }),
    });
    if (!resp.ok) throw new Error(await resp.text());
    const result = await resp.json();

    // 4. Parse JSON from answer
    const answer = result.answer || "";
    const jsonMatch = answer.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("AI did not return a parseable JSON array");
    const themes = JSON.parse(jsonMatch[0]);

    renderInsightCards(themes);
  } catch (e) {
    console.error("[zendesk-view] insights error", e);
    grid.innerHTML = `<div class="zd-insights-error">Could not load insights: ${zdEscapeHtml(e.message)}</div>`;
  }
}

function renderInsightCards(themes) {
  const grid = document.getElementById("zd-insights-grid");
  if (!grid) return;
  grid.innerHTML = themes.map(t => `
    <div class="zd-insight-card">
      <div class="zd-insight-emoji">${t.emoji || "📋"}</div>
      <div class="zd-insight-body">
        <div class="zd-insight-name">${zdEscapeHtml(t.name)}</div>
        <div class="zd-insight-desc">${zdEscapeHtml(t.description)}</div>
      </div>
      <div class="zd-insight-count">${t.count}<span class="zd-insight-pct">/ 100</span></div>
    </div>`).join("");
}

function setupInsights() {
  document.getElementById("zd-refresh-insights")?.addEventListener("click", () => {
    waitForSupabase(loadTicketInsights);
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
    if (!_insightCorpus) loadTicketInsights();
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
