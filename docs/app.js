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

