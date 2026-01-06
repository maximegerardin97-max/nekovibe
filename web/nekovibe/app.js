const chatStream = document.getElementById("chat-stream");
const form = document.getElementById("ask-form");
const textarea = document.getElementById("prompt");
const sourceInputs = Array.from(document.querySelectorAll('input[name="sources"]'));
const functionUrl = document.body.dataset.functionUrl || "";
const functionKey = document.body.dataset.apikey || "";

const state = {
  messages: [],
  pending: false,
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.pending) return;

  const prompt = textarea.value.trim();
  if (!prompt) {
    textarea.focus();
    return;
  }

  const sources = sourceInputs.filter((input) => input.checked && !input.disabled).map((input) => input.value);

  appendMessage({ role: "user", content: prompt });
  textarea.value = "";

  const loadingId = appendMessage({ role: "assistant", content: "Thinking…" }, true);
  state.pending = true;

  try {
    const headers = { "Content-Type": "application/json" };
    if (functionKey) {
      headers.apikey = functionKey;
      headers.Authorization = `Bearer ${functionKey}`;
    }

    const response = await fetch(functionUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt, sources }),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const data = await response.json();
    
    // Always show answer with "Query full dataset" button
    replaceMessage(loadingId, { 
      role: "assistant", 
      content: data.answer ?? "No answer returned.",
      prompt: prompt, // Store prompt for fallback button
      sources: sources
    });
  } catch (error) {
    console.error("nekovibe chat error", error);
    replaceMessage(loadingId, {
      role: "assistant",
      content: "I couldn't reach Nekovibe right now. Double-check the edge function URL and try again.",
    });
  } finally {
    state.pending = false;
    textarea.focus();
  }
});

textarea.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

function appendMessage(message, isTemporary = false) {
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
  
  chatStream.appendChild(bubble);
  chatStream.scrollTop = chatStream.scrollHeight;
  return bubble.dataset.messageId || null;
}

function replaceMessage(messageId, newMessage) {
  const bubble = chatStream.querySelector(`[data-message-id="${messageId}"]`);
  if (!bubble) {
    appendMessage(newMessage);
    return;
  }
  bubble.className = `chat-bubble ${newMessage.role === "user" ? "user" : "assistant"}`;
  bubble.classList.remove("pending");
  bubble.classList.add("chat-bubble--enter");
  renderBubbleContent(bubble, newMessage);
  delete bubble.dataset.messageId;
}

function renderBubbleContent(bubble, message) {
  bubble.innerHTML = "";
  
  if (message.role === "assistant" && message.prompt && !message.isTemporary) {
    const contentDiv = document.createElement("div");
    contentDiv.textContent = message.content;
    bubble.appendChild(contentDiv);
    
    const buttonContainer = document.createElement("div");
    buttonContainer.className = "button-container";
    
            // Only show Tavily button if "articles" source is selected
            const hasArticlesSource = message.sources && message.sources.includes("articles");
            if (hasArticlesSource) {
              const tavilyButton = document.createElement("button");
              tavilyButton.className = "query-perplexity-btn";
              tavilyButton.innerText = "Run another web search";
              tavilyButton.onclick = () => queryTavily(message.prompt, bubble);
              buttonContainer.appendChild(tavilyButton);
            }
    
    const datasetButton = document.createElement("button");
    datasetButton.className = "query-full-dataset-btn";
    datasetButton.innerText = "Query full dataset";
    datasetButton.onclick = () => queryFullDataset(message.prompt, message.sources, bubble);
    buttonContainer.appendChild(datasetButton);
    
    bubble.appendChild(buttonContainer);
    return;
  }
  
  const content = document.createElement("div");
  content.textContent = message.content;
  bubble.appendChild(content);
}

async function queryTavily(prompt, bubbleElement) {
  // Find and disable button
  const button = bubbleElement.querySelector(".query-perplexity-btn");
  if (button) {
    button.disabled = true;
    button.innerText = "Searching web...";
  }
  
  // Add loading message
  const loadingId = appendMessage({ 
    role: "assistant", 
    content: "Searching the web for latest news and articles... This may take 10-20 seconds." 
  }, true);
  
  try {
    const headers = { "Content-Type": "application/json" };
    if (functionKey) {
      headers.apikey = functionKey;
      headers.Authorization = `Bearer ${functionKey}`;
    }
    
    // Construct Tavily function URL (same base as chat function)
    const tavilyUrl = functionUrl.replace('/nekovibe-chat', '/tavily-query');
    
    const response = await fetch(tavilyUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt }),
    });
    
    if (!response.ok) {
      throw new Error(await response.text());
    }
    
    const data = await response.json();
    replaceMessage(loadingId, { 
      role: "assistant", 
      content: data.answer ?? "No answer returned." 
    });
    
    // Remove button from original message
    if (button) {
      button.remove();
    }
  } catch (error) {
    console.error("tavily query error", error);
    replaceMessage(loadingId, {
      role: "assistant",
      content: "Couldn't search the web. Please try again.",
    });
    
    // Re-enable button
    if (button) {
      button.disabled = false;
      button.innerText = "Run another web search";
    }
  }
}

async function queryFullDataset(prompt, sources, bubbleElement) {
  // Disable button
  const button = bubbleElement.querySelector(".query-full-dataset-btn");
  if (button) {
    button.disabled = true;
    button.innerText = "Querying full dataset...";
  }
  
  // Add loading message
  const loadingId = appendMessage({ 
    role: "assistant", 
    content: "Computing detailed answer from all reviews... This may take 30-60 seconds." 
  }, true);
  
  try {
    const headers = { "Content-Type": "application/json" };
    if (functionKey) {
      headers.apikey = functionKey;
      headers.Authorization = `Bearer ${functionKey}`;
    }
    
    const response = await fetch(functionUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt, sources, useFallback: true }),
    });
    
    if (!response.ok) {
      throw new Error(await response.text());
    }
    
    const data = await response.json();
    replaceMessage(loadingId, { 
      role: "assistant", 
      content: data.answer ?? "No answer returned." 
    });
    
    // Remove button from original message
    if (button) {
      button.remove();
    }
  } catch (error) {
    console.error("fallback error", error);
    replaceMessage(loadingId, {
      role: "assistant",
      content: "Couldn't compute detailed answer. Please try again.",
    });
    
    // Re-enable button
    if (button) {
      button.disabled = false;
      button.innerText = "Query full dataset";
    }
  }
}

function createId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `temp-${Math.random().toString(36).slice(2, 10)}`;
}

// ===== Reviews View Functionality =====

const supabaseUrl = document.body.dataset.supabaseUrl || "";
const supabaseKey = document.body.dataset.apikey || "";

let supabaseClient = null;

// Initialize Supabase client when library is loaded
function initSupabaseClient() {
  if (supabaseUrl && supabaseKey && typeof supabase !== "undefined") {
    supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);
    return true;
  }
  return false;
}

// Try to initialize immediately, or wait for DOMContentLoaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initSupabaseClient();
    setupReviewsView();
  });
} else {
  // DOM already loaded, wait a bit for supabase script to load
  setTimeout(() => {
    initSupabaseClient();
    setupReviewsView();
  }, 100);
}

// View switching - button next to Social
const viewAllReviewsBtn = document.getElementById("view-all-reviews-btn");
const chatView = document.getElementById("chat-view");
const reviewsView = document.getElementById("reviews-view");

let showingReviews = false;

viewAllReviewsBtn?.addEventListener("click", () => {
  showingReviews = !showingReviews;
  
  if (showingReviews) {
    // Show reviews view
    chatView.style.display = "none";
    reviewsView.style.display = "block";
    viewAllReviewsBtn.classList.add("active");
    viewAllReviewsBtn.querySelector("span").textContent = "Back to Chat";
    
    // Load reviews data
    if (typeof loadClinics === "function") loadClinics();
    if (typeof loadReviews === "function") loadReviews();
  } else {
    // Show chat view
    chatView.style.display = "block";
    reviewsView.style.display = "none";
    viewAllReviewsBtn.classList.remove("active");
    viewAllReviewsBtn.querySelector("span").textContent = "View All Reviews";
  }
});

// Reviews state
const reviewsState = {
  currentPage: 1,
  pageSize: 50,
  filters: {
    clinic: "",
    rating: "",
    dateFrom: "",
    dateTo: "",
    comment: "",
  },
};

// Load clinics dropdown
async function loadClinics() {
  if (!supabaseClient) return;
  
  try {
    const { data, error } = await supabaseClient
      .from("google_reviews")
      .select("clinic_name")
      .order("clinic_name");
    
    if (error) throw error;
    
    const uniqueClinics = [...new Set((data || []).map((r) => r.clinic_name))];
    const clinicSelect = document.getElementById("filter-clinic");
    
    if (clinicSelect) {
      // Keep "All Clinics" option, then add unique clinics
      clinicSelect.innerHTML = '<option value="">All Clinics</option>';
      uniqueClinics.forEach((clinic) => {
        const option = document.createElement("option");
        option.value = clinic;
        option.textContent = clinic;
        clinicSelect.appendChild(option);
      });
    }
  } catch (error) {
    console.error("Error loading clinics:", error);
  }
}

// Load reviews with filters
async function loadReviews() {
  if (!supabaseClient) {
    updateReviewsTable([], "Supabase client not initialized. Please check your configuration.");
    return;
  }
  
  const tbody = document.getElementById("reviews-tbody");
  const countSpan = document.getElementById("reviews-count");
  
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="4" class="loading-state">Loading reviews...</td></tr>';
  }
  
  try {
    let query = supabaseClient
      .from("google_reviews")
      .select("published_at, rating, text, clinic_name", { count: "exact" });
    
    // Apply filters
    if (reviewsState.filters.clinic) {
      query = query.eq("clinic_name", reviewsState.filters.clinic);
    }
    
    if (reviewsState.filters.rating) {
      query = query.eq("rating", parseInt(reviewsState.filters.rating));
    }
    
    if (reviewsState.filters.dateFrom) {
      query = query.gte("published_at", reviewsState.filters.dateFrom);
    }
    
    if (reviewsState.filters.dateTo) {
      // Add one day to include the entire end date
      const endDate = new Date(reviewsState.filters.dateTo);
      endDate.setDate(endDate.getDate() + 1);
      query = query.lt("published_at", endDate.toISOString().split("T")[0]);
    }
    
    if (reviewsState.filters.comment) {
      query = query.ilike("text", `%${reviewsState.filters.comment}%`);
    }
    
    // Order by date (newest first)
    query = query.order("published_at", { ascending: false });
    
    // Pagination
    const from = (reviewsState.currentPage - 1) * reviewsState.pageSize;
    const to = from + reviewsState.pageSize - 1;
    query = query.range(from, to);
    
    const { data, error, count } = await query;
    
    if (error) throw error;
    
    // Update count
    if (countSpan) {
      const total = count || 0;
      const start = total > 0 ? from + 1 : 0;
      const end = Math.min(from + reviewsState.pageSize, total);
      countSpan.textContent = `Showing ${start}-${end} of ${total} reviews`;
    }
    
    // Update pagination buttons
    const prevPageBtn = document.getElementById("prev-page");
    const nextPageBtn = document.getElementById("next-page");
    
    if (prevPageBtn) {
      prevPageBtn.disabled = reviewsState.currentPage === 1;
    }
    if (nextPageBtn) {
      const total = count || 0;
      const maxPage = Math.ceil(total / reviewsState.pageSize);
      nextPageBtn.disabled = reviewsState.currentPage >= maxPage;
    }
    
    // Update page info
    const pageInfo = document.getElementById("page-info");
    if (pageInfo) {
      const total = count || 0;
      const maxPage = Math.ceil(total / reviewsState.pageSize);
      pageInfo.textContent = `Page ${reviewsState.currentPage} of ${maxPage || 1}`;
    }
    
    updateReviewsTable(data || [], null);
  } catch (error) {
    console.error("Error loading reviews:", error);
    updateReviewsTable([], `Error loading reviews: ${error.message}`);
  }
}

function updateReviewsTable(reviews, errorMessage) {
  const tbody = document.getElementById("reviews-tbody");
  if (!tbody) return;
  
  if (errorMessage) {
    tbody.innerHTML = `<tr><td colspan="4" class="error-state">${errorMessage}</td></tr>`;
    return;
  }
  
  if (reviews.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No reviews found matching your filters.</td></tr>';
    return;
  }
  
  tbody.innerHTML = reviews
    .map((review) => {
      const date = review.published_at
        ? new Date(review.published_at).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })
        : "N/A";
      const rating = review.rating ? "★".repeat(review.rating) : "N/A";
      const clinic = review.clinic_name || "Unknown";
      const comment = review.text || "";
      
      return `
        <tr>
          <td class="review-date">${date}</td>
          <td class="review-rating">${rating}</td>
          <td class="review-clinic">${escapeHtml(clinic)}</td>
          <td class="review-comment">${escapeHtml(comment)}</td>
        </tr>
      `;
    })
    .join("");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Setup reviews view functionality
function setupReviewsView() {
  // Filter controls
  const filterClinic = document.getElementById("filter-clinic");
  const filterRating = document.getElementById("filter-rating");
  const filterDateFrom = document.getElementById("filter-date-from");
  const filterDateTo = document.getElementById("filter-date-to");
  const filterComment = document.getElementById("filter-comment");
  const applyFiltersBtn = document.getElementById("apply-filters");
  const clearFiltersBtn = document.getElementById("clear-filters");
  
  applyFiltersBtn?.addEventListener("click", () => {
    reviewsState.filters = {
      clinic: filterClinic?.value || "",
      rating: filterRating?.value || "",
      dateFrom: filterDateFrom?.value || "",
      dateTo: filterDateTo?.value || "",
      comment: filterComment?.value || "",
    };
    reviewsState.currentPage = 1;
    loadReviews();
  });
  
  clearFiltersBtn?.addEventListener("click", () => {
    if (filterClinic) filterClinic.value = "";
    if (filterRating) filterRating.value = "";
    if (filterDateFrom) filterDateFrom.value = "";
    if (filterDateTo) filterDateTo.value = "";
    if (filterComment) filterComment.value = "";
    reviewsState.filters = {
      clinic: "",
      rating: "",
      dateFrom: "",
      dateTo: "",
      comment: "",
    };
    reviewsState.currentPage = 1;
    loadReviews();
  });
  
  // Pagination
  const prevPageBtn = document.getElementById("prev-page");
  const nextPageBtn = document.getElementById("next-page");
  
  prevPageBtn?.addEventListener("click", () => {
    if (reviewsState.currentPage > 1) {
      reviewsState.currentPage--;
      loadReviews();
    }
  });
  
  nextPageBtn?.addEventListener("click", () => {
    reviewsState.currentPage++;
    loadReviews();
  });
  
  // Make loadClinics and loadReviews available globally for tab switching
  window.loadClinics = loadClinics;
  window.loadReviews = loadReviews;
}
    if (!supabaseClient) return;
    
    try {
      const { data, error } = await supabaseClient
        .from("google_reviews")
        .select("clinic_name")
        .order("clinic_name");
      
      if (error) throw error;
      
      const uniqueClinics = [...new Set((data || []).map((r) => r.clinic_name))];
      const clinicSelect = document.getElementById("filter-clinic");
      
      if (clinicSelect) {
        // Keep "All Clinics" option, then add unique clinics
        clinicSelect.innerHTML = '<option value="">All Clinics</option>';
        uniqueClinics.forEach((clinic) => {
          const option = document.createElement("option");
          option.value = clinic;
          option.textContent = clinic;
          clinicSelect.appendChild(option);
        });
      }
    } catch (error) {
      console.error("Error loading clinics:", error);
    }
  }
  
  // Load reviews with filters
  async function loadReviews() {
    if (!supabaseClient) {
      updateReviewsTable([], "Supabase client not initialized. Please check your configuration.");
      return;
    }
    
    const tbody = document.getElementById("reviews-tbody");
    const countSpan = document.getElementById("reviews-count");
    
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="4" class="loading-state">Loading reviews...</td></tr>';
    }
    
    try {
      let query = supabaseClient
        .from("google_reviews")
        .select("published_at, rating, text, clinic_name", { count: "exact" });
      
      // Apply filters
      if (reviewsState.filters.clinic) {
        query = query.eq("clinic_name", reviewsState.filters.clinic);
      }
      
      if (reviewsState.filters.rating) {
        query = query.eq("rating", parseInt(reviewsState.filters.rating));
      }
      
      if (reviewsState.filters.dateFrom) {
        query = query.gte("published_at", reviewsState.filters.dateFrom);
      }
      
      if (reviewsState.filters.dateTo) {
        // Add one day to include the entire end date
        const endDate = new Date(reviewsState.filters.dateTo);
        endDate.setDate(endDate.getDate() + 1);
        query = query.lt("published_at", endDate.toISOString().split("T")[0]);
      }
      
      if (reviewsState.filters.comment) {
        query = query.ilike("text", `%${reviewsState.filters.comment}%`);
      }
      
      // Order by date (newest first)
      query = query.order("published_at", { ascending: false });
      
      // Pagination
      const from = (reviewsState.currentPage - 1) * reviewsState.pageSize;
      const to = from + reviewsState.pageSize - 1;
      query = query.range(from, to);
      
      const { data, error, count } = await query;
      
      if (error) throw error;
      
      // Update count
      if (countSpan) {
        const total = count || 0;
        const start = total > 0 ? from + 1 : 0;
        const end = Math.min(from + reviewsState.pageSize, total);
        countSpan.textContent = `Showing ${start}-${end} of ${total} reviews`;
      }
      
      // Update pagination buttons
      if (prevPageBtn) {
        prevPageBtn.disabled = reviewsState.currentPage === 1;
      }
      if (nextPageBtn) {
        const total = count || 0;
        const maxPage = Math.ceil(total / reviewsState.pageSize);
        nextPageBtn.disabled = reviewsState.currentPage >= maxPage;
      }
      
      // Update page info
      const pageInfo = document.getElementById("page-info");
      if (pageInfo) {
        const total = count || 0;
        const maxPage = Math.ceil(total / reviewsState.pageSize);
        pageInfo.textContent = `Page ${reviewsState.currentPage} of ${maxPage || 1}`;
      }
      
      updateReviewsTable(data || [], null);
    } catch (error) {
      console.error("Error loading reviews:", error);
      updateReviewsTable([], `Error loading reviews: ${error.message}`);
    }
  }
  
  function updateReviewsTable(reviews, errorMessage) {
    const tbody = document.getElementById("reviews-tbody");
    if (!tbody) return;
    
    if (errorMessage) {
      tbody.innerHTML = `<tr><td colspan="4" class="error-state">${errorMessage}</td></tr>`;
      return;
    }
    
    if (reviews.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No reviews found matching your filters.</td></tr>';
      return;
    }
    
    tbody.innerHTML = reviews
      .map((review) => {
        const date = review.published_at
          ? new Date(review.published_at).toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })
          : "N/A";
        const rating = review.rating ? "★".repeat(review.rating) : "N/A";
        const clinic = review.clinic_name || "Unknown";
        const comment = review.text || "";
        
        return `
          <tr>
            <td class="review-date">${date}</td>
            <td class="review-rating">${rating}</td>
            <td class="review-clinic">${escapeHtml(clinic)}</td>
            <td class="review-comment">${escapeHtml(comment)}</td>
          </tr>
        `;
      })
      .join("");
  }
  
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
  
  // Make loadClinics and loadReviews available globally for tab switching
  window.loadClinics = loadClinics;
  window.loadReviews = loadReviews;
}

