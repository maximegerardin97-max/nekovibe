// Internal Reviews Tab Functionality
// Password: nekovibe1

const INTERNAL_PASSWORD = "nekovibe1";
let internalReviewsAuthenticated = false;
let internalSupabaseClient = null;
let internalRatingsChart = null;
let internalReviewsPage = 1;
let internalReviewsPageSize = 50;
let internalReviewsFilters = {
  clinic: "",
  rating: "",
  dateFrom: "",
  dateTo: "",
  comment: "",
};

// Initialize internal reviews when authenticated
function initializeInternalReviews() {
  if (!internalSupabaseClient) {
    const supabaseUrl = document.body.dataset.supabaseUrl || "";
    const supabaseAnonKey = document.body.dataset.supabaseAnonKey || "";
    if (supabaseUrl && supabaseAnonKey) {
      internalSupabaseClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
    }
  }

  // Don't setup password protection again if already authenticated
  if (!internalReviewsAuthenticated && sessionStorage.getItem("internal_reviews_authenticated") !== "true") {
    setupInternalPasswordProtection();
  }
  
  setupInternalChat();
  setupInternalCSVUpload();
  setupInternalFilters();
  loadInternalClinics();
  loadInternalReviews();
  updateInternalRatingsGraph();
}

// Expose function for app.js to call
window.activateInternalTab = activateInternalTab;

// Password Protection
function setupInternalPasswordProtection() {
  const loginForm = document.getElementById("internal-login-form");
  const passwordInput = document.getElementById("internal-password");
  const loginError = document.getElementById("internal-login-error");
  const loginContainer = document.getElementById("internal-login");
  const contentContainer = document.getElementById("internal-content");

  if (!loginForm || !passwordInput) return;

  // Check if already authenticated (sessionStorage)
  if (sessionStorage.getItem("internal_reviews_authenticated") === "true") {
    internalReviewsAuthenticated = true;
    if (loginContainer) loginContainer.style.display = "none";
    if (contentContainer) contentContainer.style.display = "block";
    // Initialize if authenticated
    initializeInternalReviews();
    return;
  }
  
  // Auto-authenticate if password is in URL or for testing
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("internal") === "1" || urlParams.get("password") === INTERNAL_PASSWORD) {
    internalReviewsAuthenticated = true;
    sessionStorage.setItem("internal_reviews_authenticated", "true");
    if (loginContainer) loginContainer.style.display = "none";
    if (contentContainer) contentContainer.style.display = "block";
    initializeInternalReviews();
    return;
  }

  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const password = passwordInput.value.trim();
    
    console.log("Password submitted:", password, "Expected:", INTERNAL_PASSWORD);

    if (password === INTERNAL_PASSWORD) {
      internalReviewsAuthenticated = true;
      sessionStorage.setItem("internal_reviews_authenticated", "true");
      if (loginContainer) loginContainer.style.display = "none";
      if (contentContainer) contentContainer.style.display = "block";
      if (loginError) loginError.style.display = "none";
      passwordInput.value = "";
      
      // CRITICAL: Set flag IMMEDIATELY to prevent any tab switches
      window._stayOnInternalTab = true;
      
      // Ensure internal tab stays active - do this synchronously
      const tabInternal = document.getElementById("tab-internal");
      const internalView = document.getElementById("internal-view");
      const tabChat = document.getElementById("tab-chat");
      const tabReviews = document.getElementById("tab-reviews");
      const tabArticles = document.getElementById("tab-articles");
      const chatView = document.getElementById("chat-view");
      const reviewsView = document.getElementById("reviews-view");
      const articlesView = document.getElementById("articles-view");
      
      // Force tab states - keep internal tab active
      if (tabChat) tabChat.classList.remove("active");
      if (tabReviews) tabReviews.classList.remove("active");
      if (tabArticles) tabArticles.classList.remove("active");
      if (tabInternal) {
        tabInternal.classList.add("active");
      }
      
      // Force view states - keep internal view active
      if (chatView) chatView.classList.remove("active");
      if (reviewsView) reviewsView.classList.remove("active");
      if (articlesView) articlesView.classList.remove("active");
      if (internalView) {
        internalView.classList.add("active");
      }
      
      // Initialize functionality
      initializeInternalReviews();
      
      // Keep flag set permanently while on internal tab
      // Only clear it when user explicitly clicks another tab
    } else {
      if (loginError) {
        loginError.textContent = "Incorrect password";
        loginError.style.display = "block";
      }
      passwordInput.value = "";
    }
    
    return false;
  });
}

// Called when internal tab is activated
function activateInternalTab() {
  const tabInternal = document.getElementById("tab-internal");
  const internalView = document.getElementById("internal-view");
  const loginContainer = document.getElementById("internal-login");
  const contentContainer = document.getElementById("internal-content");

  if (!tabInternal || !internalView) return;

  // Check authentication and show appropriate view
  if (sessionStorage.getItem("internal_reviews_authenticated") !== "true") {
    // Show login
    if (loginContainer) loginContainer.style.display = "block";
    if (contentContainer) contentContainer.style.display = "none";
  } else {
    // Show content
    if (loginContainer) loginContainer.style.display = "none";
    if (contentContainer) contentContainer.style.display = "block";
    
    // Load data if authenticated
    if (internalReviewsAuthenticated || sessionStorage.getItem("internal_reviews_authenticated") === "true") {
      loadInternalClinics();
      loadInternalReviews();
      updateInternalRatingsGraph();
    }
  }
}

// Internal Chat
function setupInternalChat() {
  const chatStream = document.getElementById("internal-chat-stream");
  const form = document.getElementById("internal-ask-form");
  const textarea = document.getElementById("internal-prompt");
  const analyzeAllBtn = document.getElementById("analyze-all-btn");

  if (!chatStream || !form || !textarea) return;

  const chatState = {
    messages: [],
    pending: false,
  };

  const functionUrl = document.body.dataset.functionUrl || "";
  const functionKey = document.body.dataset.apikey || "";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (chatState.pending) return;

    const prompt = textarea.value.trim();
    if (!prompt) return;

    const analyzeAll = false; // Regular query

    appendMessageToStream(chatStream, { role: "user", content: prompt });
    textarea.value = "";

    const loadingId = appendMessageToStream(chatStream, { role: "assistant", content: "Thinking…" }, true);
    chatState.pending = true;

    try {
      const internalChatUrl = functionUrl.replace("/nekovibe-chat", "/internal-reviews-chat");
      const headers = { "Content-Type": "application/json" };
      if (functionKey) {
        headers.apikey = functionKey;
        headers.Authorization = `Bearer ${functionKey}`;
      }

      const response = await fetch(internalChatUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt, analyzeAll }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = await response.json();
      replaceMessageInStream(chatStream, loadingId, {
        role: "assistant",
        content: data.answer || "No answer returned.",
      });
    } catch (error) {
      console.error("Internal chat error:", error);
      replaceMessageInStream(chatStream, loadingId, {
        role: "assistant",
        content: "I couldn't reach the chat service. Please try again.",
      });
    } finally {
      chatState.pending = false;
      textarea.focus();
    }
  });

  // Analyze All button
  if (analyzeAllBtn) {
    analyzeAllBtn.addEventListener("click", async () => {
      if (chatState.pending) return;

      const prompt = "Analyze all reviews comprehensively";
      appendMessageToStream(chatStream, { role: "user", content: prompt });

      const loadingId = appendMessageToStream(chatStream, { role: "assistant", content: "Analyzing all reviews…" }, true);
      chatState.pending = true;

      try {
        const internalChatUrl = functionUrl.replace("/nekovibe-chat", "/internal-reviews-chat");
        const headers = { "Content-Type": "application/json" };
        if (functionKey) {
          headers.apikey = functionKey;
          headers.Authorization = `Bearer ${functionKey}`;
        }

        const response = await fetch(internalChatUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({ prompt, analyzeAll: true }),
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const data = await response.json();
        replaceMessageInStream(chatStream, loadingId, {
          role: "assistant",
          content: data.answer || "No answer returned.",
        });
      } catch (error) {
        console.error("Analyze all error:", error);
        replaceMessageInStream(chatStream, loadingId, {
          role: "assistant",
          content: "I couldn't analyze all reviews. Please try again.",
        });
      } finally {
        chatState.pending = false;
      }
    });
  }
}

// CSV Upload
function setupInternalCSVUpload() {
  const uploadForm = document.getElementById("csv-upload-form");
  const fileInput = document.getElementById("csv-file-input");
  const uploadStatus = document.getElementById("upload-status");

  if (!uploadForm || !fileInput || !uploadStatus) return;

  const functionUrl = document.body.dataset.functionUrl || "";
  const functionKey = document.body.dataset.apikey || "";

  uploadForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = fileInput.files[0];
    if (!file) return;

    uploadStatus.innerHTML = '<p class="upload-status-loading">Uploading and processing CSV...</p>';

    try {
      const uploadUrl = functionUrl.replace("/nekovibe-chat", "/upload-internal-reviews");
      const formData = new FormData();
      formData.append("file", file);

      const headers = {};
      if (functionKey) {
        headers.apikey = functionKey;
        headers.Authorization = `Bearer ${functionKey}`;
      }

      const response = await fetch(uploadUrl, {
        method: "POST",
        headers,
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = await response.json();
      
      if (data.success) {
        uploadStatus.innerHTML = `
          <p class="upload-status-success">
            ✅ Upload successful! Added ${data.added} new reviews, skipped ${data.skipped} duplicates.
            ${data.errors && data.errors.length > 0 ? `<br><small>Errors: ${data.errors.join(', ')}</small>` : ''}
          </p>
        `;
        
        // Reload data
        loadInternalReviews();
        updateInternalRatingsGraph();
        loadInternalClinics();
      } else {
        uploadStatus.innerHTML = `<p class="upload-status-error">❌ Upload failed: ${data.error || 'Unknown error'}</p>`;
      }
    } catch (error) {
      console.error("Upload error:", error);
      uploadStatus.innerHTML = `<p class="upload-status-error">❌ Upload failed: ${error.message}</p>`;
    } finally {
      fileInput.value = "";
    }
  });
}

// Filters
function setupInternalFilters() {
  const applyBtn = document.getElementById("apply-internal-filters");
  const clearBtn = document.getElementById("clear-internal-filters");

  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      internalReviewsFilters.clinic = document.getElementById("internal-filter-clinic")?.value || "";
      internalReviewsFilters.rating = document.getElementById("internal-filter-rating")?.value || "";
      internalReviewsFilters.dateFrom = document.getElementById("internal-filter-date-from")?.value || "";
      internalReviewsFilters.dateTo = document.getElementById("internal-filter-date-to")?.value || "";
      internalReviewsFilters.comment = document.getElementById("internal-filter-comment")?.value || "";
      internalReviewsPage = 1;
      loadInternalReviews();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      internalReviewsFilters = {
        clinic: "",
        rating: "",
        dateFrom: "",
        dateTo: "",
        comment: "",
      };
      document.getElementById("internal-filter-clinic").value = "";
      document.getElementById("internal-filter-rating").value = "";
      document.getElementById("internal-filter-date-from").value = "";
      document.getElementById("internal-filter-date-to").value = "";
      document.getElementById("internal-filter-comment").value = "";
      internalReviewsPage = 1;
      loadInternalReviews();
    });
  }

  // Pagination
  const prevBtn = document.getElementById("prev-internal-page");
  const nextBtn = document.getElementById("next-internal-page");

  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      if (internalReviewsPage > 1) {
        internalReviewsPage--;
        loadInternalReviews();
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      internalReviewsPage++;
      loadInternalReviews();
    });
  }
}

// Load Clinics
async function loadInternalClinics() {
  if (!internalSupabaseClient) return;

  const { data, error } = await internalSupabaseClient
    .from("internal_reviews")
    .select("clinic_name")
    .order("clinic_name");

  if (error) {
    console.error("Error loading clinics:", error);
    return;
  }

  const clinics = [...new Set(data.map((r) => r.clinic_name))].sort();
  const clinicSelect = document.getElementById("internal-filter-clinic");
  const graphClinicSelect = document.getElementById("internal-graph-clinic-filter");

  if (clinicSelect) {
    clinicSelect.innerHTML = '<option value="">All Clinics</option>';
    clinics.forEach((clinic) => {
      const option = document.createElement("option");
      option.value = clinic;
      option.textContent = clinic;
      clinicSelect.appendChild(option);
    });
  }

  if (graphClinicSelect) {
    graphClinicSelect.innerHTML = '<option value="">All Clinics</option>';
    clinics.forEach((clinic) => {
      const option = document.createElement("option");
      option.value = clinic;
      option.textContent = clinic;
      graphClinicSelect.appendChild(option);
    });

    graphClinicSelect.addEventListener("change", () => {
      updateInternalRatingsGraph(graphClinicSelect.value);
    });
  }
}

// Load Reviews
async function loadInternalReviews() {
  if (!internalSupabaseClient) return;

  let query = internalSupabaseClient
    .from("internal_reviews")
    .select("*", { count: "exact" });

  // Apply filters
  if (internalReviewsFilters.clinic) {
    query = query.eq("clinic_name", internalReviewsFilters.clinic);
  }
  if (internalReviewsFilters.rating) {
    query = query.eq("rating", parseInt(internalReviewsFilters.rating));
  }
  if (internalReviewsFilters.dateFrom) {
    query = query.gte("published_at", internalReviewsFilters.dateFrom);
  }
  if (internalReviewsFilters.dateTo) {
    query = query.lte("published_at", internalReviewsFilters.dateTo + "T23:59:59");
  }
  if (internalReviewsFilters.comment) {
    query = query.ilike("comment", `%${internalReviewsFilters.comment}%`);
  }

  query = query.order("published_at", { ascending: false });

  const { data, error, count } = await query.range(
    (internalReviewsPage - 1) * internalReviewsPageSize,
    internalReviewsPage * internalReviewsPageSize - 1
  );

  if (error) {
    console.error("Error loading reviews:", error);
    return;
  }

  updateInternalReviewsTable(data || []);
  updateInternalReviewsPagination(count || 0);
}

// Update Reviews Table
function updateInternalReviewsTable(reviews) {
  const tbody = document.getElementById("internal-reviews-tbody");
  if (!tbody) return;

  if (reviews.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No reviews found</td></tr>';
    return;
  }

  tbody.innerHTML = reviews
    .map((review) => {
      const date = isValidDate(review.published_at)
        ? new Date(review.published_at).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })
        : "Invalid date";

      const ratingStars = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
      const comment = escapeHtml(review.comment || "");

      return `
        <tr>
          <td>${date}</td>
          <td><span class="rating-stars">${ratingStars}</span> (${review.rating}/5)</td>
          <td>${escapeHtml(review.clinic_name || "Unknown")}</td>
          <td class="comment-cell">${comment}</td>
        </tr>
      `;
    })
    .join("");

  // Update count
  const countEl = document.getElementById("internal-reviews-count");
  if (countEl) {
    const total = document.querySelectorAll("#internal-reviews-tbody tr").length;
    countEl.textContent = `Showing ${total} review${total !== 1 ? "s" : ""}`;
  }
}

// Update Pagination
function updateInternalReviewsPagination(total) {
  const prevBtn = document.getElementById("prev-internal-page");
  const nextBtn = document.getElementById("next-internal-page");
  const pageInfo = document.getElementById("internal-page-info");

  if (prevBtn) {
    prevBtn.disabled = internalReviewsPage <= 1;
  }

  if (nextBtn) {
    nextBtn.disabled = internalReviewsPage * internalReviewsPageSize >= total;
  }

  if (pageInfo) {
    const totalPages = Math.ceil(total / internalReviewsPageSize);
    pageInfo.textContent = `Page ${internalReviewsPage} of ${totalPages || 1}`;
  }

  const countEl = document.getElementById("internal-reviews-count");
  if (countEl) {
    const start = (internalReviewsPage - 1) * internalReviewsPageSize + 1;
    const end = Math.min(internalReviewsPage * internalReviewsPageSize, total);
    countEl.textContent = `Showing ${start}-${end} of ${total} review${total !== 1 ? "s" : ""}`;
  }
}

// Ratings Graph
async function updateInternalRatingsGraph(clinicFilter = "") {
  if (!internalSupabaseClient) return;

  let query = internalSupabaseClient
    .from("internal_reviews")
    .select("published_at, rating, clinic_name");

  if (clinicFilter) {
    query = query.eq("clinic_name", clinicFilter);
  }

  query = query.order("published_at", { ascending: true });

  const { data, error } = await query;

  if (error) {
    console.error("Error loading reviews for graph:", error);
    return;
  }

  if (!data || data.length === 0) {
    if (internalRatingsChart) {
      internalRatingsChart.destroy();
      internalRatingsChart = null;
    }
    return;
  }

  // Aggregate by date
  const dateMap = new Map();
  data.forEach((review) => {
    if (!review.published_at || !review.rating) return;
    const date = new Date(review.published_at).toISOString().split("T")[0];
    if (!dateMap.has(date)) {
      dateMap.set(date, { total: 0, count: 0 });
    }
    const dayData = dateMap.get(date);
    dayData.total += review.rating;
    dayData.count += 1;
  });

  const dates = Array.from(dateMap.keys()).sort();
  const avgRatings = dates.map((date) => {
    const dayData = dateMap.get(date);
    return (dayData.total / dayData.count).toFixed(2);
  });

  const ctx = document.getElementById("internal-ratings-chart");
  if (!ctx) return;

  if (internalRatingsChart) {
    internalRatingsChart.data.labels = dates;
    internalRatingsChart.data.datasets[0].data = avgRatings;
    internalRatingsChart.update();
  } else {
    internalRatingsChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: dates,
        datasets: [
          {
            label: "Average Rating",
            data: avgRatings,
            borderColor: "rgb(75, 192, 192)",
            tension: 0.1,
            pointRadius: 3,
            pointHoverRadius: 5,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            min: 0,
            max: 5,
            title: {
              display: true,
              text: "Rating (out of 5)",
            },
          },
          x: {
            title: {
              display: true,
              text: "Date",
            },
          },
        },
      },
    });
  }
}

// Helper functions (reuse from main app.js if available)
function isValidDate(dateString) {
  if (!dateString) return false;
  const date = new Date(dateString);
  const now = new Date();
  const year2000 = new Date("2000-01-01");
  return !isNaN(date.getTime()) && date > year2000 && date <= now;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Use global functions from app.js
function appendMessageToStream(stream, message, isTemporary = false) {
  if (typeof window.appendMessageToStream === "function") {
    return window.appendMessageToStream(stream, message, isTemporary);
  }
  // Fallback implementation
  const bubble = document.createElement("div");
  bubble.classList.add("chat-bubble", message.role === "user" ? "user" : "assistant");
  bubble.dataset.messageId = isTemporary ? `msg_${Date.now()}_${Math.random()}` : "";
  bubble.classList.add("chat-bubble--enter");
  
  if (isTemporary && message.role === "assistant") {
    bubble.classList.add("pending");
    bubble.innerHTML = `
      <div class="bubble-spinner" aria-hidden="true"></div>
      <span>${message.content}</span>
    `;
  } else {
    const content = document.createElement("div");
    content.textContent = message.content;
    bubble.appendChild(content);
  }
  
  stream.appendChild(bubble);
  stream.scrollTop = stream.scrollHeight;
  return bubble.dataset.messageId || null;
}

function replaceMessageInStream(stream, messageId, newMessage) {
  if (typeof window.replaceMessageInStream === "function") {
    return window.replaceMessageInStream(stream, messageId, newMessage);
  }
  // Fallback implementation
  const bubble = stream.querySelector(`[data-message-id="${messageId}"]`);
  if (!bubble) {
    appendMessageToStream(stream, newMessage);
    return;
  }
  bubble.className = `chat-bubble ${newMessage.role === "user" ? "user" : "assistant"}`;
  bubble.classList.remove("pending");
  bubble.classList.add("chat-bubble--enter");
  bubble.innerHTML = "";
  const content = document.createElement("div");
  content.textContent = newMessage.content;
  bubble.appendChild(content);
  delete bubble.dataset.messageId;
}

// Initialize on page load if authenticated
function initInternalReviewsOnLoad() {
  if (sessionStorage.getItem("internal_reviews_authenticated") === "true") {
    internalReviewsAuthenticated = true;
    const loginContainer = document.getElementById("internal-login");
    const contentContainer = document.getElementById("internal-content");
    if (loginContainer) loginContainer.style.display = "none";
    if (contentContainer) contentContainer.style.display = "block";
    initializeInternalReviews();
  } else {
    // Setup password protection
    setupInternalPasswordProtection();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initInternalReviewsOnLoad();
  });
} else {
  initInternalReviewsOnLoad();
}

