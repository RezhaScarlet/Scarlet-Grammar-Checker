(() => {
  const MAX_RESPONSE_PREVIEW_LENGTH = 400;

  const HTTP_STATUS_DETAILS = {
    400: ["Bad Request", "The request format or parameters were rejected. Check the endpoint and model name."],
    401: ["Unauthorized", "The API key is missing, invalid, or expired."],
    402: ["Payment Required", "The account may have no remaining credit or an unpaid billing requirement."],
    403: ["Forbidden", "The API key is valid, but it does not have permission to use this endpoint or model."],
    404: ["Not Found", "The API route or requested model was not found. Check the endpoint and model name."],
    405: ["Method Not Allowed", "The server does not accept POST requests at this URL. Check the endpoint."],
    408: ["Request Timeout", "The server took too long to receive the request. Try again."],
    409: ["Conflict", "The request conflicts with the server's current state. Try again shortly."],
    413: ["Content Too Large", "The submitted text is too large. Shorten it and try again."],
    415: ["Unsupported Media Type", "The server does not accept the request's JSON content type."],
    422: ["Unprocessable Content", "The request contains invalid values. Check the model and parameters."],
    429: ["Too Many Requests", "The rate limit or usage quota was exceeded. Wait, reduce requests, or check your API quota."],
    500: ["Internal Server Error", "The API server encountered an unexpected error. Try again later."],
    501: ["Not Implemented", "The server does not support this API operation."],
    502: ["Bad Gateway", "A gateway received an invalid response from the upstream AI service. Try again later."],
    503: ["Service Unavailable", "The API server is temporarily down, overloaded, or under maintenance. Try again later."],
    504: ["Gateway Timeout", "A gateway waited too long for the upstream AI service. Try again later."],
    507: ["Insufficient Storage", "The server does not have enough storage to complete the request."],
    511: ["Network Authentication Required", "The current network requires authentication, such as a Wi-Fi login page."]
  };

  class ApiClientError extends Error {
    constructor(message) {
      super(message);
      this.name = "ApiClientError";
    }
  }

  function getHttpErrorMessage(status) {
    const detail = HTTP_STATUS_DETAILS[status];
    if (detail) {
      return `HTTP ${status} (${detail[0]}): ${detail[1]}`;
    }

    if (status >= 400 && status < 500) {
      return `HTTP ${status} (Client Error): The server rejected the request. Check the endpoint, API key, model, and request settings.`;
    }

    if (status >= 500 && status < 600) {
      return `HTTP ${status} (Server Error): The API service failed to process the request. Try again later or contact the provider.`;
    }

    return `HTTP ${status}: The API request was not successful.`;
  }

  function getChatCompletionsUrl(endpoint) {
    const normalizedEndpoint = String(endpoint || "").trim().replace(/\/+$/, "");
    const completionUrl = /\/chat\/completions$/i.test(normalizedEndpoint)
      ? normalizedEndpoint
      : `${normalizedEndpoint}/chat/completions`;

    let parsedUrl;
    try {
      parsedUrl = new URL(completionUrl);
    } catch (_error) {
      throw new ApiClientError("The API endpoint is not a valid URL.");
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new ApiClientError("The API endpoint must use HTTP or HTTPS.");
    }

    return parsedUrl.toString();
  }

  async function readOpenAIResponse(response) {
    const contentType = response.headers.get("content-type") || "Not provided";
    const raw = await response.text();
    const responsePreview = getResponsePreview(raw);

    if (contentType.toLowerCase().includes("text/event-stream")) {
      throw new ApiClientError([
        "API returned a streaming response even though stream was set to false.",
        "",
        `HTTP: ${response.status}`,
        `Content-Type: ${contentType}`,
        "",
        "Response:",
        responsePreview || "(empty response)"
      ].join("\n"));
    }

    let data = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch (_error) {
        throw new ApiClientError([
          "API returned non-JSON response.",
          "",
          `HTTP: ${response.status}`,
          `Content-Type: ${contentType}`,
          "",
          "Response:",
          responsePreview || "(empty response)"
        ].join("\n"));
      }
    }

    if (!response.ok) {
      const serverMessage = getServerErrorMessage(data, raw);
      const statusExplanation = getHttpErrorMessage(response.status);
      const details = serverMessage
        ? `${statusExplanation}\n\nServer response:\n${getResponsePreview(serverMessage)}`
        : statusExplanation;
      throw new ApiClientError(`API error ${response.status}.\n\n${details}`);
    }

    return { data, raw, contentType };
  }

  function getServerErrorMessage(data, raw) {
    if (typeof data?.error?.message === "string" && data.error.message.trim()) {
      return data.error.message.trim();
    }
    if (typeof data?.message === "string" && data.message.trim()) {
      return data.message.trim();
    }
    return raw.trim();
  }

  function getResponsePreview(value) {
    const text = String(value || "").trim();
    if (text.length <= MAX_RESPONSE_PREVIEW_LENGTH) {
      return text;
    }
    return `${text.slice(0, MAX_RESPONSE_PREVIEW_LENGTH)}…`;
  }

  globalThis.ApiClientError = ApiClientError;
  globalThis.getHttpErrorMessage = getHttpErrorMessage;
  globalThis.getChatCompletionsUrl = getChatCompletionsUrl;
  globalThis.readOpenAIResponse = readOpenAIResponse;
})();
