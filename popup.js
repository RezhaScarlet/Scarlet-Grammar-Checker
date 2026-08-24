const STORAGE_KEYS = {
  configurations: "configurations",
  activeConfigurationId: "activeConfigurationId"
};

const REQUEST_TIMEOUT_MS = 30000;

const MODE_CONFIG = {
  grammar: {
    inputLabel: "English Text",
    inputPlaceholder: "Enter English text here...",
    outputLabel: "Corrected Text",
    outputAriaLabel: "Corrected text",
    buttonLabel: "Check Grammar",
    loadingLabel: "Checking...",
    emptyInputError: "Please enter English text to check.",
    successMessage: "Grammar check complete.",
    missingContentError: "The API response did not include corrected text.",
    systemPrompt: "You are an English grammar correction assistant. Return only the corrected text without explanation."
  },
  translate: {
    inputLabel: "Indonesian Text",
    inputPlaceholder: "Masukkan teks Bahasa Indonesia...",
    outputLabel: "English Translation",
    outputAriaLabel: "English translation",
    buttonLabel: "Translate to English",
    loadingLabel: "Translating...",
    emptyInputError: "Please enter Indonesian text to translate.",
    successMessage: "Translation complete.",
    missingContentError: "The API response did not include translated text.",
    systemPrompt: "You are a professional Indonesian-to-English translator. Translate the user's Indonesian text into natural, accurate English while preserving its meaning and tone. Return only the English translation without explanation."
  }
};

const elements = {
  openSettings: document.querySelector("#open-settings"),
  providerBar: document.querySelector("#provider-bar"),
  providerName: document.querySelector("#provider-name"),
  modeTabs: Array.from(document.querySelectorAll(".mode-tab")),
  inputLabel: document.querySelector("#input-label"),
  inputText: document.querySelector("#input-text"),
  characterCount: document.querySelector("#character-count"),
  checkButton: document.querySelector("#check-button"),
  buttonLabel: document.querySelector("#button-label"),
  message: document.querySelector("#message"),
  outputSection: document.querySelector("#output-section"),
  outputLabel: document.querySelector("#output-label"),
  correctedText: document.querySelector("#corrected-text"),
  copyButton: document.querySelector("#copy-button")
};

const modeState = {
  grammar: { input: "", output: "" },
  translate: { input: "", output: "" }
};

let activeConfiguration = null;
let activeMode = "grammar";

initialize();

async function initialize() {
  bindEvents();
  updateModeUi();

  try {
    await loadActiveConfiguration();
  } catch (_error) {
    showMessage("Could not load saved settings.");
  }
}

function bindEvents() {
  elements.openSettings.addEventListener("click", () => chrome.runtime.openOptionsPage());
  elements.checkButton.addEventListener("click", runActiveTool);
  elements.copyButton.addEventListener("click", copyOutputText);
  elements.inputText.addEventListener("input", handleInput);

  elements.modeTabs.forEach((tab) => {
    tab.addEventListener("click", () => switchMode(tab.dataset.mode));
  });
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

function switchMode(mode) {
  if (!MODE_CONFIG[mode] || mode === activeMode || elements.checkButton.disabled) {
    return;
  }

  modeState[activeMode].input = elements.inputText.value;
  modeState[activeMode].output = elements.correctedText.value;
  activeMode = mode;
  clearMessage();
  updateModeUi();
}

function updateModeUi() {
  const mode = MODE_CONFIG[activeMode];
  const state = modeState[activeMode];

  elements.modeTabs.forEach((tab) => {
    const isActive = tab.dataset.mode === activeMode;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
  });

  elements.inputLabel.textContent = mode.inputLabel;
  elements.inputText.placeholder = mode.inputPlaceholder;
  elements.inputText.value = state.input;
  elements.outputLabel.textContent = mode.outputLabel;
  elements.correctedText.setAttribute("aria-label", mode.outputAriaLabel);
  elements.correctedText.value = state.output;
  elements.outputSection.hidden = !state.output;
  if (state.output) {
    autoResizeOutput();
  }
  elements.buttonLabel.textContent = mode.buttonLabel;
  updateCharacterCount();
}

function handleInput() {
  modeState[activeMode].input = elements.inputText.value;
  updateCharacterCount();
}

async function runActiveTool() {
  clearMessage();

  const mode = MODE_CONFIG[activeMode];
  const requestedMode = activeMode;
  const input = elements.inputText.value;

  if (!input.trim()) {
    showMessage(mode.emptyInputError);
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

  setLoading(true, mode);
  elements.outputSection.hidden = true;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(getChatCompletionsUrl(activeConfiguration.endpoint), {
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
            content: mode.systemPrompt
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
    const output = data?.choices?.[0]?.message?.content;
    if (typeof output !== "string" || !output.trim()) {
      throw new UserFacingError(mode.missingContentError);
    }

    modeState[requestedMode].output = output.trim();
    elements.correctedText.value = modeState[requestedMode].output;
    elements.outputSection.hidden = false;
    autoResizeOutput();
    showMessage(mode.successMessage, "success");
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
    setLoading(false, MODE_CONFIG[activeMode]);
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

function setLoading(isLoading, mode) {
  elements.checkButton.disabled = isLoading;
  elements.checkButton.classList.toggle("is-loading", isLoading);
  elements.buttonLabel.textContent = isLoading ? mode.loadingLabel : mode.buttonLabel;
  elements.inputText.disabled = isLoading;
  elements.modeTabs.forEach((tab) => {
    tab.disabled = isLoading;
  });
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

function autoResizeOutput() {
  elements.correctedText.style.height = "auto";
  elements.correctedText.style.height = `${elements.correctedText.scrollHeight}px`;
}

async function copyOutputText() {
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
    showMessage("Could not copy the output text.");
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
