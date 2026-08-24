const STORAGE_KEYS = {
  configurations: "configurations",
  activeConfigurationId: "activeConfigurationId"
};

const REQUEST_TIMEOUT_MS = 30000;

const elements = {
  openSettings: document.querySelector("#open-settings"),
  providerBar: document.querySelector("#provider-bar"),
  providerName: document.querySelector("#provider-name"),
  inputText: document.querySelector("#input-text"),
  characterCount: document.querySelector("#character-count"),
  checkButton: document.querySelector("#check-button"),
  buttonLabel: document.querySelector("#button-label"),
  message: document.querySelector("#message"),
  outputSection: document.querySelector("#output-section"),
  correctedText: document.querySelector("#corrected-text"),
  copyButton: document.querySelector("#copy-button")
};

let activeConfiguration = null;

initialize();

async function initialize() {
  bindEvents();

  try {
    await loadActiveConfiguration();
  } catch (_error) {
    showMessage("Could not load saved settings.");
  }
}

function bindEvents() {
  elements.openSettings.addEventListener("click", () => chrome.runtime.openOptionsPage());
  elements.checkButton.addEventListener("click", checkGrammar);
  elements.copyButton.addEventListener("click", copyCorrectedText);
  elements.inputText.addEventListener("input", updateCharacterCount);
}

async function loadActiveConfiguration() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.configurations,
    STORAGE_KEYS.activeConfigurationId
  ]);

  const configurations = Array.isArray(stored.configurations) ? stored.configurations : [];
  activeConfiguration = configurations.find(
    (configuration) => configuration.id === stored.activeConfigurationId
  ) || null;

  if (activeConfiguration) {
    elements.providerName.textContent = activeConfiguration.name;
    elements.providerBar.classList.add("is-ready");
  } else {
    elements.providerName.textContent = "No provider configured";
    elements.providerBar.classList.remove("is-ready");
  }
}

async function checkGrammar() {
  clearMessage();

  const input = elements.inputText.value;
  if (!input.trim()) {
    showMessage("Please enter English text to check.");
    elements.inputText.focus();
    return;
  }

  try {
    await loadActiveConfiguration();
    validateConfiguration(activeConfiguration);
  } catch (error) {
    showMessage(getErrorMessage(error));
    return;
  }

  setLoading(true);
  elements.outputSection.hidden = true;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const requestUrl = buildCompletionUrl(activeConfiguration.endpoint);
    const response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${activeConfiguration.apiKey}`
      },
      body: JSON.stringify({
        model: activeConfiguration.model.trim(),
        messages: [
          {
            role: "system",
            content: "You are an English grammar correction assistant. Return only the corrected text without explanation."
          },
          {
            role: "user",
            content: input
          }
        ],
        temperature: 0.2,
        stream: false
      }),
      signal: controller.signal
    });

    const { data } = await readOpenAIResponse(response);
    const correctedText = data?.choices?.[0]?.message?.content;
    if (typeof correctedText !== "string" || !correctedText.trim()) {
      throw new UserFacingError("The API response did not include corrected text.");
    }

    elements.correctedText.value = correctedText.trim();
    elements.outputSection.hidden = false;
    showMessage("Grammar check complete.", "success");
  } catch (error) {
    if (error.name === "AbortError") {
      showMessage("The API request timed out. Please try again.");
    } else if (error instanceof UserFacingError || error instanceof ApiClientError) {
      showMessage(error.message);
    } else {
      showMessage("Failed to connect to API.");
    }
  } finally {
    clearTimeout(timeoutId);
    setLoading(false);
  }
}

function validateConfiguration(configuration) {
  if (!configuration) {
    throw new UserFacingError("Please configure an API provider first.");
  }
  if (!configuration.endpoint?.trim()) {
    throw new UserFacingError("The active configuration has no endpoint.");
  }
  if (!configuration.apiKey?.trim()) {
    throw new UserFacingError("The active configuration has no API key.");
  }
  if (!configuration.model?.trim()) {
    throw new UserFacingError("The active configuration has no model.");
  }
}

function buildCompletionUrl(endpoint) {
  return getChatCompletionsUrl(endpoint);
}

function setLoading(isLoading) {
  elements.checkButton.disabled = isLoading;
  elements.checkButton.classList.toggle("is-loading", isLoading);
  elements.buttonLabel.textContent = isLoading ? "Checking..." : "Check Grammar";
  elements.inputText.disabled = isLoading;
}

function showMessage(text, type = "error") {
  elements.message.textContent = text;
  elements.message.classList.toggle("is-success", type === "success");
  elements.message.hidden = false;
}

function clearMessage() {
  elements.message.hidden = true;
  elements.message.textContent = "";
  elements.message.classList.remove("is-success");
}

function updateCharacterCount() {
  const count = elements.inputText.value.length;
  elements.characterCount.textContent = `${count} character${count === 1 ? "" : "s"}`;
}

async function copyCorrectedText() {
  if (!elements.correctedText.value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(elements.correctedText.value);
    elements.copyButton.textContent = "Copied";
    setTimeout(() => {
      elements.copyButton.textContent = "Copy";
    }, 1400);
  } catch (_error) {
    showMessage("Could not copy the corrected text.");
  }
}

function getErrorMessage(error) {
  return error instanceof UserFacingError ? error.message : "Could not load saved settings.";
}

class UserFacingError extends Error {
  constructor(message) {
    super(message);
    this.name = "UserFacingError";
  }
}
