// ===== Zendesk View =====

const zdState = {
  currentPage: 1,
  pageSize: 50,
  filters: { status: "", clinic: "", dateFrom: "", dateTo: "", search: "" },
  initialized: false,
  graphPeriod: "monthly",
};

let zdChart = null;

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
      document.getElementById("zendesk-graph-clinic"),
      document.getElementById("zd-filter-clinic"),
    ].forEach(sel => { if (sel) sel.innerHTML = optionsHtml; });
  } catch (e) {
    console.error("[zendesk-view] loadZendeskClinics error", e);
  }
}

// ---- CSAT Graph ----

async function loadCsatForGraph(clinicFilter = "") {
  const sc = window.supabaseClient;
  if (!sc) return [];
  try {
    let q = sc.from("zendesk_csat")
      .select("created_at, rating, clinic_name")
      .order("created_at", { ascending: true });
    if (typeof window.applyClinicFilter === "function") {
      q = window.applyClinicFilter(q, clinicFilter);
    } else if (clinicFilter) {
      q = q.eq("clinic_name", clinicFilter);
    }
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map(r => ({ ...r, published_at: r.created_at }));
  } catch (e) {
    console.error("[zendesk-view] loadCsatForGraph error", e);
    return [];
  }
}

async function updateZendeskGraph(clinicFilter = "") {
  const canvas = document.getElementById("zendesk-chart");
  if (!canvas) return;

  const reviews = await loadCsatForGraph(clinicFilter);

  if (!reviews || reviews.length === 0) {
    if (zdChart) { zdChart.destroy(); zdChart = null; }
    return;
  }

  const getPeriodKey = window.getPeriodKey || ((dateStr, period) => {
    const d = new Date(dateStr);
    if (period === "monthly") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (period === "quarterly") return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
    if (period === "yearly") return String(d.getFullYear());
    // weekly — Monday
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d); monday.setDate(diff);
    return monday.toISOString().split("T")[0];
  });

  const formatLabel = window.formatPeriodLabel || ((key, period) => {
    if (period === "monthly") {
      const [year, month] = key.split("-");
      return new Date(parseInt(year), parseInt(month) - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
    }
    if (period === "quarterly" || period === "yearly") return key;
    return new Date(key + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  });

  const periodMap = new Map();
  reviews.forEach(r => {
    if (!r.published_at || r.rating == null) return;
    const key = getPeriodKey(r.published_at, zdState.graphPeriod);
    if (!periodMap.has(key)) periodMap.set(key, { total: 0, count: 0 });
    const d = periodMap.get(key);
    d.total += r.rating;
    d.count += 1;
  });

  const periods = Array.from(periodMap.keys()).sort();
  const avgRatings = periods.map(k => (periodMap.get(k).total / periodMap.get(k).count).toFixed(2));
  const countData = periods.map(k => periodMap.get(k).count);
  const labels = periods.map(k => formatLabel(k, zdState.graphPeriod));

  const ctx = canvas.getContext("2d");
  if (zdChart) zdChart.destroy();

  const options = typeof window.buildRatingsChartOptions === "function"
    ? window.buildRatingsChartOptions(zdState.graphPeriod)
    : {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: "top" },
          tooltip: { callbacks: { label: (ctx) => {
            const count = ctx.dataset.countData?.[ctx.dataIndex];
            return `CSAT: ${ctx.parsed.y} / 5.0${count != null ? `  (${count} response${count !== 1 ? "s" : ""})` : ""}`;
          } } },
        },
        scales: {
          y: { beginAtZero: false, min: 0, max: 5, ticks: { stepSize: 0.5, callback: v => v + "★" }, title: { display: true, text: "CSAT Rating (out of 5)" } },
          x: { title: { display: true, text: zdState.graphPeriod === "weekly" ? "Week" : zdState.graphPeriod === "monthly" ? "Month" : zdState.graphPeriod === "quarterly" ? "Quarter" : "Year" } },
        },
      };

  zdChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "CSAT Average Rating",
        data: avgRatings,
        countData,
        borderColor: "rgb(22, 163, 74)",
        backgroundColor: "rgba(22, 163, 74, 0.1)",
        tension: 0.4,
        pointRadius: 3,
        pointHoverRadius: 5,
        fill: true,
      }],
    },
    options,
  });
}

function setupZendeskGraph() {
  const clinicFilter = document.getElementById("zendesk-graph-clinic");
  const weeklyBtn    = document.getElementById("zendesk-period-weekly");
  const monthlyBtn   = document.getElementById("zendesk-period-monthly");
  const quarterlyBtn = document.getElementById("zendesk-period-quarterly");
  const yearlyBtn    = document.getElementById("zendesk-period-yearly");
  const allPeriodBtns = [weeklyBtn, monthlyBtn, quarterlyBtn, yearlyBtn];

  if (!document.getElementById("zendesk-chart")) return;

  const refresh = () => updateZendeskGraph(clinicFilter?.value || "");

  clinicFilter?.addEventListener("change", refresh);

  const setPeriod = (period, activeBtn) => {
    zdState.graphPeriod = period;
    allPeriodBtns.forEach(b => b?.classList.remove("active"));
    activeBtn?.classList.add("active");
    refresh();
  };
  weeklyBtn?.addEventListener("click",    () => setPeriod("weekly", weeklyBtn));
  monthlyBtn?.addEventListener("click",   () => setPeriod("monthly", monthlyBtn));
  quarterlyBtn?.addEventListener("click", () => setPeriod("quarterly", quarterlyBtn));
  yearlyBtn?.addEventListener("click",    () => setPeriod("yearly", yearlyBtn));
}

// ---- Tickets Table ----

async function loadZendeskTickets() {
  const sc = window.supabaseClient;
  if (!sc) { updateZendeskTicketsTable([], "Supabase not initialized."); return; }

  const tbody = document.getElementById("zd-tickets-tbody");
  if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="loading-state">Loading tickets...</td></tr>';

  try {
    let q = sc.from("zendesk_tickets")
      .select("created_at, status, category, clinic_name, subject", { count: "exact" });

    if (zdState.filters.status) q = q.eq("status", zdState.filters.status);
    if (zdState.filters.clinic) {
      if (typeof window.applyClinicFilter === "function") {
        q = window.applyClinicFilter(q, zdState.filters.clinic);
      } else {
        q = q.eq("clinic_name", zdState.filters.clinic);
      }
    }
    if (zdState.filters.dateFrom) q = q.gte("created_at", zdState.filters.dateFrom);
    if (zdState.filters.dateTo) {
      const end = new Date(zdState.filters.dateTo);
      end.setDate(end.getDate() + 1);
      q = q.lt("created_at", end.toISOString().split("T")[0]);
    }
    if (zdState.filters.search) q = q.ilike("subject", `%${zdState.filters.search}%`);

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
    tbody.innerHTML = `<tr><td colspan="5" class="error-state">${zdEscapeHtml(errorMessage)}</td></tr>`;
    return;
  }
  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No tickets found matching your filters.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(ticket => {
    const date   = ticket.created_at
      ? new Date(ticket.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
      : "N/A";
    const status   = ticket.status   || "—";
    const category = ticket.category || "—";
    const clinic   = ticket.clinic_name || "—";
    const subject  = ticket.subject  || "—";

    const statusClass = {
      open: "style=\"color:#dc2626;font-weight:600\"",
      pending: "style=\"color:#d97706;font-weight:600\"",
      solved: "style=\"color:#16a34a;font-weight:600\"",
      closed: "style=\"color:#6b7280;font-weight:600\"",
    }[status?.toLowerCase()] || "";

    return `<tr>
      <td class="review-date">${zdEscapeHtml(date)}</td>
      <td ${statusClass}>${zdEscapeHtml(status)}</td>
      <td>${zdEscapeHtml(category)}</td>
      <td class="review-clinic">${zdEscapeHtml(clinic)}</td>
      <td>${zdEscapeHtml(subject)}</td>
    </tr>`;
  }).join("");
}

function setupZendeskTicketsTable() {
  document.getElementById("zd-apply-filters")?.addEventListener("click", () => {
    zdState.filters = {
      status:   document.getElementById("zd-filter-status")?.value  || "",
      clinic:   document.getElementById("zd-filter-clinic")?.value  || "",
      dateFrom: document.getElementById("zd-filter-date-from")?.value || "",
      dateTo:   document.getElementById("zd-filter-date-to")?.value   || "",
      search:   document.getElementById("zd-filter-search")?.value    || "",
    };
    zdState.currentPage = 1;
    loadZendeskTickets();
  });

  document.getElementById("zd-clear-filters")?.addEventListener("click", () => {
    ["zd-filter-status","zd-filter-clinic","zd-filter-date-from","zd-filter-date-to","zd-filter-search"]
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    zdState.filters = { status: "", clinic: "", dateFrom: "", dateTo: "", search: "" };
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

    const prompt = "[Zendesk data] " + rawPrompt;
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
    updateZendeskGraph(document.getElementById("zendesk-graph-clinic")?.value || "");
    loadZendeskTickets();
  });
}
window.activateZendeskTab = activateZendeskTab;

export function setupZendeskView() {
  window.setupZendeskView = setupZendeskView;
  setupZendeskChat();
  setupZendeskGraph();
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
