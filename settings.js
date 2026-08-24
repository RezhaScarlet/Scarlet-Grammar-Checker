const STORAGE_KEYS = {
  configurations: "configurations",
  activeConfigurationId: "activeConfigurationId"
};

const CONNECTION_TIMEOUT_MS = 30000;

const elements = {
  addButton: document.querySelector("#add-configuration"),
  pageMessage: document.querySelector("#page-message"),
  contentGrid: document.querySelector(".content-grid"),
  configurationList: document.querySelector("#configuration-list"),
  configurationCount: document.querySelector("#configuration-count"),
  emptyState: document.querySelector("#empty-state"),
  formPanel: document.querySelector("#form-panel"),
  formTitle: document.querySelector("#form-title"),
  form: document.querySelector("#configuration-form"),
  formError: document.querySelector("#form-error"),
  configurationId: document.querySelector("#configuration-id"),
  name: document.querySelector("#configuration-name"),
  endpoint: document.querySelector("#configuration-endpoint"),
  apiKey: document.querySelector("#configuration-api-key"),
  model: document.querySelector("#configuration-model"),
  toggleApiKey: document.querySelector("#toggle-api-key"),
  checkConnection: document.querySelector("#check-connection"),
  checkLabel: document.querySelector("#check-label"),
  checkResult: document.querySelector("#check-result"),
  saveButton: document.querySelector("#save-configuration"),
  closeForm: document.querySelector("#close-form"),
  cancelForm: document.querySelector("#cancel-form")
};

let configurations = [];
let activeConfigurationId = null;
let messageTimer = null;
let verifiedConfigurationSignature = null;

initialize();

async function initialize() {
  bindEvents();

  try {
    const stored = await chrome.storage.local.get([
      STORAGE_KEYS.configurations,
      STORAGE_KEYS.activeConfigurationId
    ]);

    configurations = Array.isArray(stored.configurations) ? stored.configurations : [];
    activeConfigurationId = stored.activeConfigurationId || null;

    if (!configurations.some((configuration) => configuration.id === activeConfigurationId)) {
      activeConfigurationId = configurations[0]?.id || null;
      if (activeConfigurationId) {
        await saveState();
      }
    }

    renderConfigurations();
  } catch (_error) {
    showPageMessage("Could not load saved configurations.", "error");
  }
}

function bindEvents() {
  elements.addButton.addEventListener("click", () => openForm());
  elements.closeForm.addEventListener("click", closeForm);
  elements.cancelForm.addEventListener("click", closeForm);
  elements.toggleApiKey.addEventListener("click", toggleApiKeyVisibility);
  elements.checkConnection.addEventListener("click", checkConnection);
  elements.form.addEventListener("submit", saveConfiguration);

  [elements.endpoint, elements.apiKey, elements.model].forEach((input) => {
    input.addEventListener("input", invalidateConnectionCheck);
  });
}

function renderConfigurations() {
  elements.configurationList.replaceChildren();
  elements.configurationCount.textContent = String(configurations.length);
  elements.emptyState.hidden = configurations.length > 0;

  configurations.forEach((configuration) => {
    const isActive = configuration.id === activeConfigurationId;
    const card = document.createElement("article");
    card.className = `configuration-card${isActive ? " is-active" : ""}`;

    const main = document.createElement("div");
    main.className = "configuration-main";

    const titleRow = document.createElement("div");
    titleRow.className = "configuration-title-row";

    const title = document.createElement("h3");
    title.className = "configuration-title";
    title.textContent = configuration.name;
    titleRow.appendChild(title);

    if (isActive) {
      const activeBadge = document.createElement("span");
      activeBadge.className = "active-badge";
      activeBadge.textContent = "Active";
      titleRow.appendChild(activeBadge);
    }

    const meta = document.createElement("div");
    meta.className = "configuration-meta";

    const endpoint = document.createElement("span");
    endpoint.textContent = configuration.endpoint;
    endpoint.title = configuration.endpoint;

    const model = document.createElement("span");
    model.textContent = `Model: ${configuration.model}`;

    meta.append(endpoint, model);
    main.append(titleRow, meta);

    const actions = document.createElement("div");
    actions.className = "configuration-actions";

    if (!isActive) {
      actions.appendChild(createActionButton("Use", "use-button", () => setActiveConfiguration(configuration.id)));
    }

    actions.appendChild(createActionButton("Edit", "edit-button", () => openForm(configuration)));
    actions.appendChild(createActionButton("Delete", "delete-button", () => deleteConfiguration(configuration.id)));

    card.append(main, actions);
    elements.configurationList.appendChild(card);
  });
}

function createActionButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `small-button ${className}`;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function openForm(configuration = null) {
  clearFormError();
  resetConnectionCheck();
  setApiKeyVisibility(false);
  elements.form.reset();

  if (configuration) {
    elements.formTitle.textContent = "Edit configuration";
    elements.configurationId.value = configuration.id;
    elements.name.value = configuration.name;
    elements.endpoint.value = configuration.endpoint;
    elements.apiKey.value = configuration.apiKey;
    elements.model.value = configuration.model;
  } else {
    elements.formTitle.textContent = "Add configuration";
    elements.configurationId.value = "";
  }

  elements.formPanel.hidden = false;
  elements.contentGrid.classList.add("has-form");
  elements.name.focus();
}

function closeForm() {
  elements.formPanel.hidden = true;
  elements.contentGrid.classList.remove("has-form");
  elements.form.reset();
  elements.configurationId.value = "";
  clearFormError();
  resetConnectionCheck();
  setApiKeyVisibility(false);
}

async function checkConnection() {
  clearFormError();
  clearCheckResult();

  const configuration = getFormConfiguration();
  const validationError = validateConnectionFields(configuration);
  if (validationError) {
    showCheckResult(validationError, "error");
    return;
  }

  setCheckLoading(true);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS);

  try {
    const response = await fetch(buildCompletionUrl(configuration.endpoint), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${configuration.apiKey}`
      },
      body: JSON.stringify({
        model: configuration.model,
        messages: [
          {
            role: "user",
            content: "Reply with exactly: OK"
          }
        ],
        temperature: 0,
        stream: false
      }),
      signal: controller.signal
    });

    const { data } = await readOpenAIResponse(response);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new ConnectionCheckError("Connected to server, but the response is not OpenAI Chat Completions compatible.");
    }

    const checkedSignature = getConfigurationSignature(configuration);
    if (checkedSignature !== getConfigurationSignature(getFormConfiguration())) {
      throw new ConnectionCheckError("The connection fields changed during the test. Please check again.");
    }

    verifiedConfigurationSignature = checkedSignature;
    elements.saveButton.disabled = false;
    showCheckResult(`Connection successful. Model “${configuration.model}” is available.`, "success");
  } catch (error) {
    verifiedConfigurationSignature = null;
    elements.saveButton.disabled = true;

    if (error.name === "AbortError") {
      showCheckResult("Connection test timed out. Please check the endpoint and try again.", "error");
    } else if (error instanceof ConnectionCheckError || error instanceof ApiClientError) {
      showCheckResult(error.message, "error");
    } else {
      showCheckResult("Failed to connect to API. Check the endpoint and network connection.", "error");
    }
  } finally {
    clearTimeout(timeoutId);
    setCheckLoading(false);
  }
}

async function saveConfiguration(event) {
  event.preventDefault();
  clearFormError();

  const configuration = {
    id: elements.configurationId.value || createId(),
    name: elements.name.value.trim(),
    endpoint: normalizeEndpoint(elements.endpoint.value),
    apiKey: elements.apiKey.value.trim(),
    model: elements.model.value.trim()
  };

  const validationError = validateConfiguration(configuration);
  if (validationError) {
    showFormError(validationError);
    return;
  }

  if (verifiedConfigurationSignature !== getConfigurationSignature(configuration)) {
    showFormError("Please check the endpoint and model successfully before saving.");
    return;
  }

  const existingIndex = configurations.findIndex((item) => item.id === configuration.id);
  if (existingIndex >= 0) {
    configurations[existingIndex] = configuration;
  } else {
    configurations.push(configuration);
  }

  if (!activeConfigurationId) {
    activeConfigurationId = configuration.id;
  }

  try {
    await saveState();
    renderConfigurations();
    closeForm();
    showPageMessage(existingIndex >= 0 ? "Configuration updated." : "Configuration added.", "success");
  } catch (_error) {
    showFormError("Could not save the configuration.");
  }
}

async function setActiveConfiguration(id) {
  activeConfigurationId = id;

  try {
    await saveState();
    renderConfigurations();
    showPageMessage("Active configuration changed.", "success");
  } catch (_error) {
    showPageMessage("Could not change the active configuration.", "error");
  }
}

async function deleteConfiguration(id) {
  const configuration = configurations.find((item) => item.id === id);
  if (!configuration) {
    return;
  }

  const confirmed = window.confirm(`Delete “${configuration.name}”?`);
  if (!confirmed) {
    return;
  }

  const previousConfigurations = configurations;
  const previousActiveId = activeConfigurationId;

  configurations = configurations.filter((item) => item.id !== id);
  if (activeConfigurationId === id) {
    activeConfigurationId = configurations[0]?.id || null;
  }

  try {
    await saveState();
    renderConfigurations();
    if (elements.configurationId.value === id) {
      closeForm();
    }
    showPageMessage("Configuration deleted.", "success");
  } catch (_error) {
    configurations = previousConfigurations;
    activeConfigurationId = previousActiveId;
    showPageMessage("Could not delete the configuration.", "error");
  }
}

function validateConfiguration(configuration) {
  if (!configuration.name) {
    return "Name is required.";
  }

  return validateConnectionFields(configuration);
}

function validateConnectionFields(configuration) {
  if (!configuration.endpoint) {
    return "Endpoint is required.";
  }
  if (!configuration.apiKey) {
    return "API key is required.";
  }
  if (!configuration.model) {
    return "Model is required.";
  }

  try {
    const url = new URL(configuration.endpoint);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return "Endpoint must use HTTP or HTTPS.";
    }
  } catch (_error) {
    return "Endpoint must be a valid URL.";
  }

  return "";
}

function getFormConfiguration() {
  return {
    id: elements.configurationId.value,
    name: elements.name.value.trim(),
    endpoint: normalizeEndpoint(elements.endpoint.value),
    apiKey: elements.apiKey.value.trim(),
    model: elements.model.value.trim()
  };
}

function getConfigurationSignature(configuration) {
  return JSON.stringify([
    normalizeEndpoint(configuration.endpoint),
    configuration.apiKey.trim(),
    configuration.model.trim()
  ]);
}

function buildCompletionUrl(endpoint) {
  return getChatCompletionsUrl(endpoint);
}

function normalizeEndpoint(value) {
  return value.trim().replace(/\/+$/, "");
}

function toggleApiKeyVisibility() {
  setApiKeyVisibility(elements.apiKey.type === "password");
}

function setApiKeyVisibility(isVisible) {
  elements.apiKey.type = isVisible ? "text" : "password";
  elements.toggleApiKey.textContent = isVisible ? "Hide" : "Show";
  elements.toggleApiKey.setAttribute("aria-label", `${isVisible ? "Hide" : "Show"} API key`);
}

function showFormError(message) {
  elements.formError.textContent = message;
  elements.formError.hidden = false;
}

function clearFormError() {
  elements.formError.textContent = "";
  elements.formError.hidden = true;
}

function showCheckResult(message, type) {
  elements.checkResult.textContent = message;
  elements.checkResult.classList.toggle("is-error", type === "error");
  elements.checkResult.hidden = false;
}

function clearCheckResult() {
  elements.checkResult.textContent = "";
  elements.checkResult.classList.remove("is-error");
  elements.checkResult.hidden = true;
}

function invalidateConnectionCheck() {
  verifiedConfigurationSignature = null;
  elements.saveButton.disabled = true;
  clearCheckResult();
  clearFormError();
}

function resetConnectionCheck() {
  verifiedConfigurationSignature = null;
  elements.saveButton.disabled = true;
  setCheckLoading(false);
  clearCheckResult();
}

function setCheckLoading(isLoading) {
  elements.checkConnection.disabled = isLoading;
  elements.checkConnection.classList.toggle("is-loading", isLoading);
  elements.checkLabel.textContent = isLoading ? "Checking..." : "Check";
}

function showPageMessage(message, type) {
  if (messageTimer) {
    clearTimeout(messageTimer);
  }

  elements.pageMessage.textContent = message;
  elements.pageMessage.classList.toggle("is-success", type === "success");
  elements.pageMessage.hidden = false;

  messageTimer = setTimeout(() => {
    elements.pageMessage.hidden = true;
  }, 3000);
}

function createId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function saveState() {
  return chrome.storage.local.set({
    [STORAGE_KEYS.configurations]: configurations,
    [STORAGE_KEYS.activeConfigurationId]: activeConfigurationId
  });
}

class ConnectionCheckError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConnectionCheckError";
  }
}
