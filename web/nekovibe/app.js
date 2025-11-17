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

function appendMessage(message, isTemporary = false) {
  const bubble = document.createElement("div");
  bubble.classList.add("chat-bubble", message.role === "user" ? "user" : "assistant");
  bubble.dataset.messageId = isTemporary ? createId() : "";
  
  if (message.role === "assistant" && !isTemporary && message.prompt) {
    // Add button for assistant messages with prompt
    const contentDiv = document.createElement("div");
    contentDiv.innerText = message.content;
    bubble.appendChild(contentDiv);
    
    const button = document.createElement("button");
    button.className = "query-full-dataset-btn";
    button.innerText = "Query full dataset";
    button.onclick = () => queryFullDataset(message.prompt, message.sources, bubble);
    bubble.appendChild(button);
  } else {
    bubble.innerText = message.content;
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
  
  // Clear existing content
  bubble.innerHTML = "";
  
  if (newMessage.role === "assistant" && newMessage.prompt) {
    // Add content and button
    const contentDiv = document.createElement("div");
    contentDiv.innerText = newMessage.content;
    bubble.appendChild(contentDiv);
    
    const button = document.createElement("button");
    button.className = "query-full-dataset-btn";
    button.innerText = "Query full dataset";
    button.onclick = () => queryFullDataset(newMessage.prompt, newMessage.sources, bubble);
    bubble.appendChild(button);
  } else {
    bubble.innerText = newMessage.content;
  }
  
  delete bubble.dataset.messageId;
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

