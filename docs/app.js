const functionUrl = document.body.dataset.functionUrl || "";
const functionKey = document.body.dataset.apikey || "";

// ===== Supabase Initialization =====

const supabaseUrl = document.body.dataset.supabaseUrl || "";
const supabaseKey = document.body.dataset.apikey || "";

let supabaseClient = null;
window.supabaseClient = null;

function initSupabaseClient() {
  if (supabaseUrl && supabaseKey && typeof supabase !== "undefined") {
    supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);
    window.supabaseClient = supabaseClient;
    if (typeof loadClinics === "function") loadClinics();
    return true;
  }
  return false;
}

// ===== Tab Switching =====
function setupTabSwitching() {
  const tabReviews = document.getElementById("tab-reviews");
  const tabInternal = document.getElementById("tab-internal");
  const reviewsView = document.getElementById("reviews-view");
  const internalView = document.getElementById("internal-view");

  if (!tabReviews || !tabInternal || !reviewsView || !internalView) {
    console.warn("Tab elements not found");
    return;
  }

  function switchToTab(tabName) {
    tabReviews.classList.remove("active");
    tabInternal.classList.remove("active");
    reviewsView.classList.remove("active");
    internalView.classList.remove("active");

    if (tabName === "reviews") {
      tabReviews.classList.add("active");
      reviewsView.classList.add("active");
      if (typeof loadClinics === "function") loadClinics();
      if (typeof loadReviews === "function") loadReviews();
      if (typeof updateRatingsGraph === "function") {
        const graphFilter = document.getElementById("graph-clinic-filter");
        updateRatingsGraph(graphFilter?.value || "");
      }
    } else if (tabName === "internal") {
      tabInternal.classList.add("active");
      internalView.classList.add("active");
      if (typeof activateInternalTab === "function") activateInternalTab();
    }
  }

  tabReviews.addEventListener("click", () => {
    window._stayOnInternalTab = false;
    switchToTab("reviews");
  });
  tabInternal.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    switchToTab("internal");
  });

  switchToTab("internal");
}

// ===== Chat Helpers =====

function appendMessageToStream(stream, message, isTemporary = false) {
  const bubble = document.createElement("div");
  bubble.classList.add("chat-bubble", message.role === "user" ? "user" : "assistant");
  bubble.dataset.messageId = isTemporary ? createId() : "";
  bubble.classList.add("chat-bubble--enter");

  if (isTemporary && message.role === "assistant") {
    bubble.classList.add("pending");
    bubble.innerHTML = `
      <div class="bubble-spinner" aria-hidden="true"></div>
      <span>${message.content}</span>
    `;
  } else {
    renderBubbleContent(bubble, { ...message, isTemporary });
  }

  stream.appendChild(bubble);
  stream.scrollTop = stream.scrollHeight;
  return bubble.dataset.messageId || null;
}

function replaceMessageInStream(stream, messageId, newMessage) {
  const bubble = stream.querySelector(`[data-message-id="${messageId}"]`);
  if (!bubble) {
    appendMessageToStream(stream, newMessage);
    return;
  }
  bubble.className = `chat-bubble ${newMessage.role === "user" ? "user" : "assistant"}`;
  bubble.classList.remove("pending");
  bubble.classList.add("chat-bubble--enter");
  renderBubbleContent(bubble, newMessage);
  delete bubble.dataset.messageId;
}

window.appendMessageToStream = appendMessageToStream;
window.replaceMessageInStream = replaceMessageInStream;

function renderBubbleContent(bubble, message) {
  bubble.innerHTML = "";

  if (message.role === "assistant" && message.prompt && !message.isTemporary) {
    const contentDiv = document.createElement("div");
    contentDiv.textContent = message.content;
    bubble.appendChild(contentDiv);

    const buttonContainer = document.createElement("div");
    buttonContainer.className = "button-container";

    const datasetButton = document.createElement("button");
    datasetButton.className = "query-full-dataset-btn";
    datasetButton.innerText = "Query full dataset";
    datasetButton.onclick = () => queryFullDataset(message.prompt, message.sources, bubble, message.filters);
    buttonContainer.appendChild(datasetButton);

    bubble.appendChild(buttonContainer);
    return;
  }

  const content = document.createElement("div");
  content.textContent = message.content;
  bubble.appendChild(content);
}

async function queryFullDataset(prompt, sources, bubbleElement, filters) {
  const button = bubbleElement.querySelector(".query-full-dataset-btn");
  if (button) { button.disabled = true; button.innerText = "Querying full dataset..."; }

  const reviewsChatStream = document.getElementById("reviews-chat-stream");
  const loadingId = appendMessageToStream(reviewsChatStream, {
    role: "assistant",
    content: "Computing detailed answer from all reviews… This may take 30–60 seconds.",
  }, true);

  try {
    const headers = { "Content-Type": "application/json" };
    if (functionKey) { headers.apikey = functionKey; headers.Authorization = `Bearer ${functionKey}`; }
    const payload = { prompt, sources, useFallback: true };
    if (filters && (filters.clinic || filters.dateFrom || filters.dateTo)) payload.filters = filters;

    const response = await fetch(functionUrl, { method: "POST", headers, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(await response.text());

    const data = await response.json();
    replaceMessageInStream(reviewsChatStream, loadingId, {
      role: "assistant",
      content: data.answer ?? "No answer returned.",
    });
    if (button) button.remove();
  } catch (error) {
    console.error("fallback error", error);
    replaceMessageInStream(reviewsChatStream, loadingId, {
      role: "assistant",
      content: "Couldn't compute detailed answer. Please try again.",
    });
    if (button) { button.disabled = false; button.innerText = "Query full dataset"; }
  }
}

function createId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `temp-${Math.random().toString(36).slice(2, 10)}`;
}

// ===== Reviews Chat =====
function setupReviewsChat() {
  const reviewsChatStream = document.getElementById("reviews-chat-stream");
  const reviewsForm = document.getElementById("reviews-ask-form");
  const reviewsTextarea = document.getElementById("reviews-prompt");
  const reviewsClinicFilter = document.getElementById("reviews-chat-clinic-filter");
  const reviewsDateFrom = document.getElementById("reviews-chat-date-from");
  const reviewsDateTo = document.getElementById("reviews-chat-date-to");
  const reviewsClearFilters = document.getElementById("reviews-chat-clear-filters");

  if (!reviewsChatStream || !reviewsForm || !reviewsTextarea) return;

  const state = { pending: false };

  const getFilters = () => {
    const clinic = reviewsClinicFilter?.value?.trim() || "";
    const dateFrom = reviewsDateFrom?.value || "";
    const dateTo = reviewsDateTo?.value || "";
    return (!clinic && !dateFrom && !dateTo) ? null : { clinic, dateFrom, dateTo };
  };

  reviewsClearFilters?.addEventListener("click", () => {
    if (reviewsClinicFilter) reviewsClinicFilter.value = "";
    if (reviewsDateFrom) reviewsDateFrom.value = "";
    if (reviewsDateTo) reviewsDateTo.value = "";
  });

  reviewsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.pending) return;
    const prompt = reviewsTextarea.value.trim();
    if (!prompt) { reviewsTextarea.focus(); return; }

    const sources = ["reviews"];
    const filters = getFilters();

    appendMessageToStream(reviewsChatStream, { role: "user", content: prompt });
    reviewsTextarea.value = "";
    const loadingId = appendMessageToStream(reviewsChatStream, { role: "assistant", content: "Thinking…" }, true);
    state.pending = true;

    try {
      const headers = { "Content-Type": "application/json" };
      if (functionKey) { headers.apikey = functionKey; headers.Authorization = `Bearer ${functionKey}`; }
      const payload = { prompt, sources };
      if (filters) payload.filters = filters;

      const response = await fetch(functionUrl, { method: "POST", headers, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();

      replaceMessageInStream(reviewsChatStream, loadingId, {
        role: "assistant",
        content: data.answer ?? "No answer returned.",
        prompt, sources, filters: filters || undefined,
      });
    } catch (error) {
      console.error("reviews chat error", error);
      replaceMessageInStream(reviewsChatStream, loadingId, {
        role: "assistant",
        content: "I couldn't reach Nekovibe right now. Please try again.",
      });
    } finally {
      state.pending = false;
      reviewsTextarea.focus();
    }
  });

  reviewsTextarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); reviewsForm.requestSubmit(); }
  });
}

// ===== Reviews State & Loading =====
const reviewsState = {
  currentPage: 1,
  pageSize: 50,
  filters: { source: "", clinic: "", rating: "", dateFrom: "", dateTo: "", comment: "" },
};

async function loadClinics() {
  if (!supabaseClient) {
    if (!loadClinics._retryTimer) {
      loadClinics._retryTimer = setTimeout(() => { loadClinics._retryTimer = null; loadClinics(); }, 200);
    }
    return;
  }
  try {
    const { data, error } = await supabaseClient.from("google_reviews").select("clinic_name").order("clinic_name");
    if (error) throw error;
    const uniqueClinics = [...new Set((data || []).map((r) => r.clinic_name).filter(Boolean))].sort();
    [
      document.getElementById("filter-clinic"),
      document.getElementById("reviews-chat-clinic-filter"),
    ].forEach((sel) => {
      if (!sel) return;
      sel.innerHTML = '<option value="">All Clinics</option>';
      uniqueClinics.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c; opt.textContent = c;
        sel.appendChild(opt);
      });
    });
  } catch (error) {
    console.error("Error loading clinics:", error);
  }
}

async function loadReviews() {
  if (!supabaseClient) { updateReviewsTable([], "Supabase client not initialized."); return; }

  const tbody = document.getElementById("reviews-tbody");
  if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="loading-state">Loading reviews...</td></tr>';

  const source = reviewsState.filters.source;

  try {
    if (source === "trustpilot") {
      await loadReviewsFromTable("trustpilot_reviews", "trustpilot");
    } else if (source === "google") {
      await loadReviewsFromTable("google_reviews", "google");
    } else {
      await loadAllSourceReviews();
    }
  } catch (error) {
    console.error("Error loading reviews:", error);
    updateReviewsTable([], `Error: ${error.message}`);
  }
}

async function loadReviewsFromTable(tableName, sourceLabel) {
  let query = supabaseClient.from(tableName)
    .select("published_at, rating, text, clinic_name", { count: "exact" });

  if (reviewsState.filters.clinic) query = query.eq("clinic_name", reviewsState.filters.clinic);
  if (reviewsState.filters.rating) query = query.eq("rating", parseInt(reviewsState.filters.rating));
  if (reviewsState.filters.dateFrom) query = query.gte("published_at", reviewsState.filters.dateFrom);
  if (reviewsState.filters.dateTo) {
    const end = new Date(reviewsState.filters.dateTo);
    end.setDate(end.getDate() + 1);
    query = query.lt("published_at", end.toISOString().split("T")[0]);
  }
  if (reviewsState.filters.comment) query = query.ilike("text", `%${reviewsState.filters.comment}%`);

  query = query.order("published_at", { ascending: false });
  const from = (reviewsState.currentPage - 1) * reviewsState.pageSize;
  query = query.range(from, from + reviewsState.pageSize - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  updateCountAndPagination(count || 0, from);
  updateReviewsTable((data || []).map(r => ({ ...r, source: sourceLabel })), null);
}

async function loadAllSourceReviews() {
  const from = (reviewsState.currentPage - 1) * reviewsState.pageSize;

  const buildQuery = (tableName) => {
    let q = supabaseClient.from(tableName)
      .select("published_at, rating, text, clinic_name", { count: "exact" });
    if (reviewsState.filters.clinic) q = q.eq("clinic_name", reviewsState.filters.clinic);
    if (reviewsState.filters.rating) q = q.eq("rating", parseInt(reviewsState.filters.rating));
    if (reviewsState.filters.dateFrom) q = q.gte("published_at", reviewsState.filters.dateFrom);
    if (reviewsState.filters.dateTo) {
      const end = new Date(reviewsState.filters.dateTo);
      end.setDate(end.getDate() + 1);
      q = q.lt("published_at", end.toISOString().split("T")[0]);
    }
    if (reviewsState.filters.comment) q = q.ilike("text", `%${reviewsState.filters.comment}%`);
    return q.order("published_at", { ascending: false }).range(0, reviewsState.pageSize - 1);
  };

  const [gRes, tRes] = await Promise.allSettled([
    buildQuery("google_reviews"),
    buildQuery("trustpilot_reviews"),
  ]);

  const googleReviews = gRes.status === "fulfilled" ? (gRes.value.data || []).map(r => ({ ...r, source: "google" })) : [];
  const tpReviews = tRes.status === "fulfilled" ? (tRes.value.data || []).map(r => ({ ...r, source: "trustpilot" })) : [];
  const gCount = gRes.status === "fulfilled" ? (gRes.value.count || 0) : 0;
  const tCount = tRes.status === "fulfilled" ? (tRes.value.count || 0) : 0;

  const merged = [...googleReviews, ...tpReviews]
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))
    .slice(0, reviewsState.pageSize);

  updateCountAndPagination(gCount + tCount, from);
  updateReviewsTable(merged, null);
}

function updateCountAndPagination(total, from) {
  const countSpan = document.getElementById("reviews-count");
  const prevBtn = document.getElementById("prev-page");
  const nextBtn = document.getElementById("next-page");
  const pageInfo = document.getElementById("page-info");
  const maxPage = Math.ceil(total / reviewsState.pageSize);

  if (countSpan) {
    const start = total > 0 ? from + 1 : 0;
    const end = Math.min(from + reviewsState.pageSize, total);
    countSpan.textContent = `Showing ${start}–${end} of ${total} reviews`;
  }
  if (prevBtn) prevBtn.disabled = reviewsState.currentPage === 1;
  if (nextBtn) nextBtn.disabled = reviewsState.currentPage >= maxPage;
  if (pageInfo) pageInfo.textContent = `Page ${reviewsState.currentPage} of ${maxPage || 1}`;
}

function updateReviewsTable(reviews, errorMessage) {
  const tbody = document.getElementById("reviews-tbody");
  if (!tbody) return;

  if (errorMessage) {
    tbody.innerHTML = `<tr><td colspan="5" class="error-state">${errorMessage}</td></tr>`;
    return;
  }
  if (reviews.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No reviews found matching your filters.</td></tr>';
    return;
  }

  tbody.innerHTML = reviews.map((review, index) => {
    const date = review.published_at
      ? new Date(review.published_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
      : "N/A";
    const rating = review.rating ? "★".repeat(review.rating) : "N/A";
    const clinic = review.clinic_name || "Unknown";
    const comment = review.text || "";
    const commentId = `comment-${index}`;
    const maxLength = 200;
    const isTruncated = comment.length > maxLength;
    const truncated = isTruncated ? comment.substring(0, maxLength) + "..." : comment;
    const sourceBadge = review.source === "trustpilot"
      ? '<span class="source-badge source-trustpilot">Trustpilot</span>'
      : '<span class="source-badge source-google">Google</span>';

    return `
      <tr>
        <td class="review-date">${date}</td>
        <td class="review-source">${sourceBadge}</td>
        <td class="review-rating">${rating}</td>
        <td class="review-clinic">${escapeHtml(clinic)}</td>
        <td class="review-comment">
          <span class="comment-text" id="${commentId}-text">${escapeHtml(truncated)}</span>
          ${isTruncated ? `<span class="comment-full" id="${commentId}-full" style="display:none">${escapeHtml(comment)}</span><button class="comment-toggle" data-comment-id="${commentId}" onclick="toggleComment('${commentId}')">Show more</button>` : ""}
        </td>
      </tr>`;
  }).join("");
}

function toggleComment(commentId) {
  const textSpan = document.getElementById(`${commentId}-text`);
  const fullSpan = document.getElementById(`${commentId}-full`);
  const button = document.querySelector(`[data-comment-id="${commentId}"]`);
  if (!textSpan || !fullSpan || !button) return;
  const isExpanded = fullSpan.style.display !== "none";
  textSpan.style.display = isExpanded ? "inline" : "none";
  fullSpan.style.display = isExpanded ? "none" : "inline";
  button.textContent = isExpanded ? "Show more" : "Show less";
}
window.toggleComment = toggleComment;

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ===== Reviews View Setup =====
function setupReviewsView() {
  const filterSource = document.getElementById("filter-source");
  const filterClinic = document.getElementById("filter-clinic");
  const filterRating = document.getElementById("filter-rating");
  const filterDateFrom = document.getElementById("filter-date-from");
  const filterDateTo = document.getElementById("filter-date-to");
  const filterComment = document.getElementById("filter-comment");

  document.getElementById("apply-filters")?.addEventListener("click", () => {
    reviewsState.filters = {
      source: filterSource?.value || "",
      clinic: filterClinic?.value || "",
      rating: filterRating?.value || "",
      dateFrom: filterDateFrom?.value || "",
      dateTo: filterDateTo?.value || "",
      comment: filterComment?.value || "",
    };
    reviewsState.currentPage = 1;
    loadReviews();
  });

  document.getElementById("clear-filters")?.addEventListener("click", () => {
    if (filterSource) filterSource.value = "";
    if (filterClinic) filterClinic.value = "";
    if (filterRating) filterRating.value = "";
    if (filterDateFrom) filterDateFrom.value = "";
    if (filterDateTo) filterDateTo.value = "";
    if (filterComment) filterComment.value = "";
    reviewsState.filters = { source: "", clinic: "", rating: "", dateFrom: "", dateTo: "", comment: "" };
    reviewsState.currentPage = 1;
    loadReviews();
  });

  document.getElementById("prev-page")?.addEventListener("click", () => {
    if (reviewsState.currentPage > 1) { reviewsState.currentPage--; loadReviews(); }
  });
  document.getElementById("next-page")?.addEventListener("click", () => {
    reviewsState.currentPage++; loadReviews();
  });

  window.loadClinics = loadClinics;
  window.loadReviews = loadReviews;

  setupRatingsGraph();
}

// ===== Ratings Graph =====
let ratingsChart = null;
let graphPeriod = "weekly";

function getWeekStartDate(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(d);
  monday.setDate(diff);
  return monday.toISOString().split("T")[0];
}

function getMonthKey(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function getPeriodKey(dateStr, period) {
  return period === "monthly" ? getMonthKey(dateStr) : getWeekStartDate(dateStr);
}

function formatPeriodLabel(key, period) {
  if (period === "monthly") {
    const [year, month] = key.split("-");
    return new Date(parseInt(year), parseInt(month) - 1, 1)
      .toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  return new Date(key + "T12:00:00")
    .toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

async function loadReviewsForGraph(clinicFilter = "") {
  if (!supabaseClient) return [];
  try {
    let query = supabaseClient.from("google_reviews")
      .select("published_at, rating, clinic_name")
      .order("published_at", { ascending: true });
    if (clinicFilter) query = query.eq("clinic_name", clinicFilter);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("Error loading reviews for graph:", error);
    return [];
  }
}

async function loadClinicsForFilter() {
  if (!supabaseClient) return [];
  try {
    const { data, error } = await supabaseClient.from("google_reviews").select("clinic_name").order("clinic_name");
    if (error) throw error;
    return [...new Set((data || []).map((r) => r.clinic_name).filter(Boolean))];
  } catch (error) {
    return [];
  }
}

async function setupRatingsGraph() {
  const canvas = document.getElementById("ratings-chart");
  const clinicFilter = document.getElementById("graph-clinic-filter");
  const weeklyBtn = document.getElementById("graph-period-weekly");
  const monthlyBtn = document.getElementById("graph-period-monthly");
  if (!canvas) return;

  if (clinicFilter) {
    const clinics = await loadClinicsForFilter();
    clinicFilter.innerHTML = '<option value="">All Clinics</option>' +
      clinics.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    clinicFilter.addEventListener("change", () => updateRatingsGraph(clinicFilter.value));
  }

  weeklyBtn?.addEventListener("click", () => {
    graphPeriod = "weekly";
    weeklyBtn.classList.add("active");
    monthlyBtn?.classList.remove("active");
    updateRatingsGraph(clinicFilter?.value || "");
  });

  monthlyBtn?.addEventListener("click", () => {
    graphPeriod = "monthly";
    monthlyBtn.classList.add("active");
    weeklyBtn?.classList.remove("active");
    updateRatingsGraph(clinicFilter?.value || "");
  });

  await updateRatingsGraph("");
}

async function updateRatingsGraph(clinicFilter = "") {
  const reviews = await loadReviewsForGraph(clinicFilter);

  if (!reviews || reviews.length === 0) {
    if (ratingsChart) { ratingsChart.destroy(); ratingsChart = null; }
    return;
  }

  const periodMap = new Map();
  reviews.forEach((review) => {
    if (!review.published_at || !review.rating) return;
    const key = getPeriodKey(review.published_at, graphPeriod);
    if (!periodMap.has(key)) periodMap.set(key, { total: 0, count: 0 });
    const d = periodMap.get(key);
    d.total += review.rating;
    d.count += 1;
  });

  const periods = Array.from(periodMap.keys()).sort();
  const avgRatings = periods.map(k => (periodMap.get(k).total / periodMap.get(k).count).toFixed(2));
  const labels = periods.map(k => formatPeriodLabel(k, graphPeriod));

  const ctx = document.getElementById("ratings-chart").getContext("2d");
  if (ratingsChart) { ratingsChart.destroy(); }

  ratingsChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Average Rating",
        data: avgRatings,
        borderColor: "rgb(111, 143, 195)",
        backgroundColor: "rgba(111, 143, 195, 0.1)",
        tension: 0.4,
        pointRadius: 3,
        pointHoverRadius: 5,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: "top" },
        tooltip: { callbacks: { label: (ctx) => `Rating: ${ctx.parsed.y} / 5.0` } },
      },
      scales: {
        y: {
          beginAtZero: false, min: 0, max: 5,
          ticks: { stepSize: 0.5, callback: (v) => v + "★" },
          title: { display: true, text: "Rating (out of 5)" },
        },
        x: { title: { display: true, text: graphPeriod === "weekly" ? "Week" : "Month" } },
      },
    },
  });
}
window.updateRatingsGraph = updateRatingsGraph;

// ===== Init =====
let tabSwitchingSetup = false;
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    if (!tabSwitchingSetup) { setupTabSwitching(); tabSwitchingSetup = true; }
    setupReviewsChat();
    initSupabaseClient();
    setupReviewsView();
  });
} else {
  if (!tabSwitchingSetup) { setupTabSwitching(); tabSwitchingSetup = true; }
  setupReviewsChat();
  setTimeout(() => { initSupabaseClient(); setupReviewsView(); }, 100);
}
