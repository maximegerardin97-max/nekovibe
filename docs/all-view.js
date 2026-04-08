// ===== All Sources View =====

const allState = {
  currentPage: 1,
  pageSize: 50,
  filters: { source: "", clinic: "", rating: "", dateFrom: "", dateTo: "" },
  graphPeriod: "weekly",
  graphSource: "",
  initialized: false,
};

let allChart = null;

// ---- Helpers ----

function waitForSupabaseAll(cb, maxWait = 5000) {
  const start = Date.now();
  const poll = () => {
    if (window.supabaseClient) { cb(); return; }
    if (Date.now() - start > maxWait) { console.warn("[all-view] supabaseClient not available"); return; }
    setTimeout(poll, 80);
  };
  poll();
}

function allEscapeHtml(text) {
  if (typeof window.escapeHtml === "function") return window.escapeHtml(text);
  const div = document.createElement("div");
  div.textContent = String(text ?? "");
  return div.innerHTML;
}

// ---- Clinic Dropdowns ----

async function loadAllClinics() {
  const sc = window.supabaseClient;
  if (!sc) return;
  try {
    let optionsHtml;
    if (typeof window.loadClinicsForFilter === "function") {
      const clinics = await window.loadClinicsForFilter();
      optionsHtml = typeof window.buildClinicOptions === "function"
        ? window.buildClinicOptions(clinics)
        : '<option value="">All Clinics</option>' + clinics.map(c => `<option value="${allEscapeHtml(c)}">${allEscapeHtml(c)}</option>`).join("");
    } else {
      const [gRes, tRes, cRes] = await Promise.allSettled([
        sc.from("google_reviews").select("clinic_name"),
        sc.from("trustpilot_reviews").select("clinic_name"),
        sc.from("zendesk_csat").select("clinic_name"),
      ]);
      const names = [
        ...(gRes.status === "fulfilled" ? gRes.value.data || [] : []),
        ...(tRes.status === "fulfilled" ? tRes.value.data || [] : []),
        ...(cRes.status === "fulfilled" ? cRes.value.data || [] : []),
      ].map(r => r.clinic_name).filter(Boolean);
      const unique = [...new Set(names)].sort();
      optionsHtml = '<option value="">All Clinics</option>' +
        unique.map(c => `<option value="${allEscapeHtml(c)}">${allEscapeHtml(c)}</option>`).join("");
    }

    [
      document.getElementById("all-graph-clinic"),
      document.getElementById("all-filter-clinic"),
    ].forEach(sel => { if (sel) sel.innerHTML = optionsHtml; });
  } catch (e) {
    console.error("[all-view] loadAllClinics error", e);
  }
}

// ---- Graph ----

async function updateAllGraph(clinicFilter = "", sourceFilter = "") {
  const canvas = document.getElementById("all-chart");
  if (!canvas) return;

  const loadFn = window.loadReviewsForGraph;
  if (typeof loadFn !== "function") return;

  const reviews = await loadFn(clinicFilter, sourceFilter, true);

  if (!reviews || reviews.length === 0) {
    if (allChart) { allChart.destroy(); allChart = null; }
    return;
  }

  const getPeriodKey = window.getPeriodKey || ((dateStr, period) => {
    const d = new Date(dateStr);
    if (period === "monthly") return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (period === "quarterly") return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
    if (period === "yearly") return String(d.getFullYear());
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
    const key = getPeriodKey(r.published_at, allState.graphPeriod);
    if (!periodMap.has(key)) periodMap.set(key, { total: 0, count: 0 });
    const d = periodMap.get(key);
    d.total += r.rating;
    d.count += 1;
  });

  const periods = Array.from(periodMap.keys()).sort();
  const avgRatings = periods.map(k => (periodMap.get(k).total / periodMap.get(k).count).toFixed(2));
  const countData  = periods.map(k => periodMap.get(k).count);
  const labels     = periods.map(k => formatLabel(k, allState.graphPeriod));

  const ctx = canvas.getContext("2d");
  if (allChart) allChart.destroy();

  const options = typeof window.buildRatingsChartOptions === "function"
    ? window.buildRatingsChartOptions(allState.graphPeriod)
    : {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: "top" },
          tooltip: { callbacks: { label: (ctx) => {
            const count = ctx.dataset.countData?.[ctx.dataIndex];
            return `Rating: ${ctx.parsed.y} / 5.0${count != null ? `  (${count} review${count !== 1 ? "s" : ""})` : ""}`;
          } } },
        },
        scales: {
          y: { beginAtZero: false, min: 0, max: 5, ticks: { stepSize: 0.5, callback: v => v + "★" }, title: { display: true, text: "Rating (out of 5)" } },
          x: { title: { display: true, text: allState.graphPeriod === "weekly" ? "Week" : allState.graphPeriod === "monthly" ? "Month" : allState.graphPeriod === "quarterly" ? "Quarter" : "Year" } },
        },
      };

  allChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Average Rating",
        data: avgRatings,
        countData,
        borderColor: "rgb(111, 143, 195)",
        backgroundColor: "rgba(111, 143, 195, 0.1)",
        tension: 0.4,
        pointRadius: 3,
        pointHoverRadius: 5,
        fill: true,
      }],
    },
    options,
  });
}

function setupAllGraph() {
  const clinicFilter = document.getElementById("all-graph-clinic");
  const weeklyBtn    = document.getElementById("all-period-weekly");
  const monthlyBtn   = document.getElementById("all-period-monthly");
  const quarterlyBtn = document.getElementById("all-period-quarterly");
  const yearlyBtn    = document.getElementById("all-period-yearly");
  const srcAllBtn    = document.getElementById("all-source-all");
  const srcGoogleBtn = document.getElementById("all-source-google");
  const srcTpBtn     = document.getElementById("all-source-trustpilot");
  const srcCsatBtn   = document.getElementById("all-source-csat");

  const allPeriodBtns = [weeklyBtn, monthlyBtn, quarterlyBtn, yearlyBtn];
  const allSrcBtns    = [srcAllBtn, srcGoogleBtn, srcTpBtn, srcCsatBtn];

  if (!document.getElementById("all-chart")) return;

  const refresh = () => updateAllGraph(clinicFilter?.value || "", allState.graphSource);

  clinicFilter?.addEventListener("change", refresh);

  const setPeriod = (period, btn) => {
    allState.graphPeriod = period;
    allPeriodBtns.forEach(b => b?.classList.remove("active"));
    btn?.classList.add("active");
    refresh();
  };
  weeklyBtn?.addEventListener("click",    () => setPeriod("weekly", weeklyBtn));
  monthlyBtn?.addEventListener("click",   () => setPeriod("monthly", monthlyBtn));
  quarterlyBtn?.addEventListener("click", () => setPeriod("quarterly", quarterlyBtn));
  yearlyBtn?.addEventListener("click",    () => setPeriod("yearly", yearlyBtn));

  const setSource = (src, btn) => {
    allState.graphSource = src;
    allSrcBtns.forEach(b => b?.classList.remove("active"));
    btn?.classList.add("active");
    refresh();
  };
  srcAllBtn?.addEventListener("click",    () => setSource("", srcAllBtn));
  srcGoogleBtn?.addEventListener("click", () => setSource("google", srcGoogleBtn));
  srcTpBtn?.addEventListener("click",     () => setSource("trustpilot", srcTpBtn));
  srcCsatBtn?.addEventListener("click",   () => setSource("csat", srcCsatBtn));
}

// ---- Combined Table ----

async function loadAllSourcesTable() {
  const sc = window.supabaseClient;
  if (!sc) { updateAllTable([], 0, "Supabase not initialized."); return; }

  const tbody = document.getElementById("all-reviews-tbody");
  if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="loading-state">Loading...</td></tr>';

  const { source, clinic, rating, dateFrom, dateTo } = allState.filters;
  const from = (allState.currentPage - 1) * allState.pageSize;

  try {
    const applyClinic = (q, clinicVal) => {
      if (typeof window.applyClinicFilter === "function") return window.applyClinicFilter(q, clinicVal);
      if (clinicVal) return q.eq("clinic_name", clinicVal);
      return q;
    };

    const buildReviewQ = (table) => {
      let q = sc.from(table)
        .select("published_at, rating, text, clinic_name", { count: "exact" });
      q = applyClinic(q, clinic);
      if (rating) q = q.eq("rating", parseInt(rating));
      if (dateFrom) q = q.gte("published_at", dateFrom);
      if (dateTo) {
        const end = new Date(dateTo); end.setDate(end.getDate() + 1);
        q = q.lt("published_at", end.toISOString().split("T")[0]);
      }
      return q.order("published_at", { ascending: false }).range(0, allState.pageSize - 1);
    };

    const buildCsatQ = () => {
      let q = sc.from("zendesk_csat")
        .select("created_at, rating, comment, clinic_name", { count: "exact" });
      q = applyClinic(q, clinic);
      if (rating) q = q.eq("rating", parseInt(rating));
      if (dateFrom) q = q.gte("created_at", dateFrom);
      if (dateTo) {
        const end = new Date(dateTo); end.setDate(end.getDate() + 1);
        q = q.lt("created_at", end.toISOString().split("T")[0]);
      }
      return q.order("created_at", { ascending: false }).range(0, allState.pageSize - 1);
    };

    let gRows = [], tRows = [], cRows = [];
    let gCount = 0, tCount = 0, cCount = 0;

    if (!source || source === "google") {
      const res = await buildReviewQ("google_reviews");
      if (!res.error) { gRows = (res.data || []).map(r => ({ ...r, source: "google" })); gCount = res.count || 0; }
    }
    if (!source || source === "trustpilot") {
      const res = await buildReviewQ("trustpilot_reviews");
      if (!res.error) { tRows = (res.data || []).map(r => ({ ...r, source: "trustpilot" })); tCount = res.count || 0; }
    }
    if (!source || source === "csat") {
      const res = await buildCsatQ();
      if (!res.error) {
        cRows = (res.data || []).map(r => ({
          published_at: r.created_at,
          rating: r.rating,
          text: r.comment || "",
          clinic_name: r.clinic_name || "—",
          source: "csat",
        }));
        cCount = res.count || 0;
      }
    }

    const merged = [...gRows, ...tRows, ...cRows]
      .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))
      .slice(0, allState.pageSize);

    const total = gCount + tCount + cCount;
    updateAllTablePagination(total, from);
    updateAllTable(merged, total, null);
  } catch (e) {
    console.error("[all-view] loadAllSourcesTable error", e);
    updateAllTable([], 0, `Error: ${e.message}`);
  }
}

function updateAllTablePagination(total, from) {
  const countSpan = document.getElementById("all-reviews-count");
  const prevBtn   = document.getElementById("all-prev-page");
  const nextBtn   = document.getElementById("all-next-page");
  const pageInfo  = document.getElementById("all-page-info");
  const maxPage   = Math.ceil(total / allState.pageSize);

  if (countSpan) {
    const start = total > 0 ? from + 1 : 0;
    const end   = Math.min(from + allState.pageSize, total);
    countSpan.textContent = `Showing ${start}–${end} of ${total} reviews`;
  }
  if (prevBtn) prevBtn.disabled = allState.currentPage === 1;
  if (nextBtn) nextBtn.disabled = allState.currentPage >= maxPage;
  if (pageInfo) pageInfo.textContent = `Page ${allState.currentPage} of ${maxPage || 1}`;
}

function updateAllTable(rows, total, errorMessage) {
  const tbody = document.getElementById("all-reviews-tbody");
  if (!tbody) return;

  if (errorMessage) {
    tbody.innerHTML = `<tr><td colspan="5" class="error-state">${allEscapeHtml(errorMessage)}</td></tr>`;
    return;
  }
  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No reviews found matching your filters.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((review, index) => {
    const date = review.published_at
      ? new Date(review.published_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
      : "N/A";
    const ratingStars = review.rating ? "★".repeat(review.rating) : "N/A";
    const clinic  = review.clinic_name || "Unknown";
    const comment = review.text || "";
    const commentId = `all-comment-${index}`;
    const maxLength = 200;
    const isTruncated = comment.length > maxLength;
    const truncated = isTruncated ? comment.substring(0, maxLength) + "..." : comment;

    const sourceBadge = review.source === "trustpilot"
      ? '<span class="source-badge source-trustpilot">Trustpilot</span>'
      : review.source === "csat"
        ? '<span class="source-badge source-csat">CSAT</span>'
        : '<span class="source-badge source-google">Google</span>';

    return `<tr>
      <td class="review-date">${allEscapeHtml(date)}</td>
      <td class="review-source">${sourceBadge}</td>
      <td class="review-rating">${allEscapeHtml(ratingStars)}</td>
      <td class="review-clinic">${allEscapeHtml(clinic)}</td>
      <td class="review-comment">
        <span class="comment-text" id="${commentId}-text">${allEscapeHtml(truncated)}</span>
        ${isTruncated ? `<span class="comment-full" id="${commentId}-full" style="display:none">${allEscapeHtml(comment)}</span><button class="comment-toggle" data-comment-id="${commentId}" onclick="toggleComment('${commentId}')">Show more</button>` : ""}
      </td>
    </tr>`;
  }).join("");
}

function setupAllTable() {
  document.getElementById("all-apply-filters")?.addEventListener("click", () => {
    allState.filters = {
      source:   document.getElementById("all-filter-source")?.value    || "",
      clinic:   document.getElementById("all-filter-clinic")?.value    || "",
      rating:   document.getElementById("all-filter-rating")?.value    || "",
      dateFrom: document.getElementById("all-filter-date-from")?.value || "",
      dateTo:   document.getElementById("all-filter-date-to")?.value   || "",
    };
    allState.currentPage = 1;
    loadAllSourcesTable();
  });

  document.getElementById("all-clear-filters")?.addEventListener("click", () => {
    ["all-filter-source","all-filter-clinic","all-filter-rating","all-filter-date-from","all-filter-date-to"]
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    allState.filters = { source: "", clinic: "", rating: "", dateFrom: "", dateTo: "" };
    allState.currentPage = 1;
    loadAllSourcesTable();
  });

  document.getElementById("all-prev-page")?.addEventListener("click", () => {
    if (allState.currentPage > 1) { allState.currentPage--; loadAllSourcesTable(); }
  });
  document.getElementById("all-next-page")?.addEventListener("click", () => {
    allState.currentPage++;
    loadAllSourcesTable();
  });
}

// ---- Public API ----

export function activateAllTab() {
  window.activateAllTab = activateAllTab;
  if (!allState.initialized) return;
  waitForSupabaseAll(() => {
    loadAllClinics();
    updateAllGraph(document.getElementById("all-graph-clinic")?.value || "", allState.graphSource);
    loadAllSourcesTable();
  });
}
window.activateAllTab = activateAllTab;

export function setupAllView() {
  window.setupAllView = setupAllView;
  setupAllGraph();
  setupAllTable();
  allState.initialized = true;

  waitForSupabaseAll(() => {
    loadAllClinics();
  });
}
window.setupAllView = setupAllView;

// Auto-init
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => setupAllView());
} else {
  setTimeout(() => setupAllView(), 150);
}
