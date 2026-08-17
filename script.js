const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

const RESPONSE_LIBRARY_URL = "responses.json";
const WRITE_DELAY_MS = 28;
const CLEAR_BOARD_BEFORE_EACH_RESPONSE = true;
const TRIGGER_COOLDOWN_MS = 3500;

const listenButton = document.querySelector("#listen-button");
const clearButton = document.querySelector("#clear-button");
const board = document.querySelector("#blackboard");
const boardContent = document.querySelector("#board-content");
const status = document.querySelector("#status");

let responseLibrary = [];
let responsesReady = false;
let recognition;
let shouldBeListening = false;
let isWriting = false;
let writeGeneration = 0;
const responseQueue = [];
const lastTriggeredAt = new Map();

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findResponse(transcript) {
  const normalizedTranscript = normalize(transcript);

  return responseLibrary.find((response) =>
    response.triggers.some((trigger) =>
      normalizedTranscript.includes(normalize(trigger))
    )
  );
}

function sleep(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function typeNode(sourceNode, destinationNode, generation) {
  if (generation !== writeGeneration) return;

  if (sourceNode.nodeType === Node.TEXT_NODE) {
    const textNode = document.createTextNode("");
    destinationNode.appendChild(textNode);

    for (const character of sourceNode.textContent) {
      if (generation !== writeGeneration) return;

      textNode.textContent += character;
      board.scrollTop = board.scrollHeight;

      if (/\s/.test(character)) {
        await sleep(WRITE_DELAY_MS * 0.25);
      } else if (/[.!?:]/.test(character)) {
        await sleep(WRITE_DELAY_MS * 4);
      } else if (/[,;]/.test(character)) {
        await sleep(WRITE_DELAY_MS * 2);
      } else {
        await sleep(WRITE_DELAY_MS);
      }
    }
    return;
  }

  if (sourceNode.nodeType !== Node.ELEMENT_NODE) return;

  const clone = sourceNode.cloneNode(false);
  destinationNode.appendChild(clone);

  for (const child of sourceNode.childNodes) {
    await typeNode(child, clone, generation);
    if (generation !== writeGeneration) return;
  }
}

async function writeResponse(response) {
  isWriting = true;
  const generation = writeGeneration;

  if (CLEAR_BOARD_BEFORE_EACH_RESPONSE) {
    boardContent.replaceChildren();
  }

  const section = document.createElement("section");
  section.className = "board-response is-writing";
  boardContent.appendChild(section);

  if (response.title) {
    const heading = document.createElement("h2");
    section.appendChild(heading);
    await typeNode(document.createTextNode(response.title), heading, generation);
  }

  const template = document.createElement("template");
  template.innerHTML = response.html.trim();

  for (const child of template.content.childNodes) {
    await typeNode(child, section, generation);
    if (generation !== writeGeneration) return;
  }

  if (generation === writeGeneration) {
    section.classList.remove("is-writing");
    isWriting = false;
    writeNextResponse();
  }
}

function writeNextResponse() {
  if (isWriting || responseQueue.length === 0) return;
  writeResponse(responseQueue.shift());
}

function queueResponse(response) {
  if (!response) return;

  const key = response.title || response.triggers[0];
  const now = Date.now();

  if (now - (lastTriggeredAt.get(key) || 0) < TRIGGER_COOLDOWN_MS) return;

  lastTriggeredAt.set(key, now);
  responseQueue.push(response);
  status.textContent = `Matched: ${key}`;
  writeNextResponse();
}

function handleTranscript(transcript) {
  const response = findResponse(transcript);
  if (response) queueResponse(response);
}

function updateListenAvailability() {
  listenButton.disabled = !(SpeechRecognition && responsesReady);
}

async function loadResponseLibrary() {
  try {
    const request = await fetch(RESPONSE_LIBRARY_URL);

    if (!request.ok) {
      throw new Error(`HTTP ${request.status}`);
    }

    const payload = await request.json();
    const responses = Array.isArray(payload) ? payload : payload.responses;

    if (
      !Array.isArray(responses) ||
      responses.length === 0 ||
      responses.some(
        (response) =>
          !Array.isArray(response.triggers) ||
          response.triggers.length === 0 ||
          typeof response.html !== "string"
      )
    ) {
      throw new Error("responses.json does not contain a valid response list");
    }

    responseLibrary = responses;
    responsesReady = true;
    status.textContent = "Ready";
    updateListenAvailability();
  } catch (error) {
    status.textContent = "Could not load responses.json";
    console.error("Could not load responses.json", error);
  }
}

function createRecognition() {
  if (!SpeechRecognition) {
    status.textContent = "Speech recognition is unavailable in this browser";
    updateListenAvailability();
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 3;
  recognition.continuous = true;

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      if (!event.results[i].isFinal) continue;

      for (const alternative of event.results[i]) {
        handleTranscript(alternative.transcript);
      }
    }
  };

  recognition.onstart = () => {
    listenButton.textContent = "stop";
    listenButton.classList.add("is-listening");
    status.textContent = "Listening";
  };

  recognition.onend = () => {
    if (shouldBeListening) {
      window.setTimeout(() => {
        try {
          recognition.start();
        } catch (error) {
          console.debug(error);
        }
      }, 250);
    } else {
      listenButton.textContent = "start";
      listenButton.classList.remove("is-listening");
      status.textContent = "Ready";
    }
  };

  recognition.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      shouldBeListening = false;
      listenButton.textContent = "start";
      listenButton.classList.remove("is-listening");
      status.textContent = "Microphone access was not allowed";
    } else if (event.error !== "no-speech") {
      status.textContent = `Speech recognition error: ${event.error}`;
    }
  };
}

listenButton.addEventListener("click", () => {
  if (!recognition || !responsesReady) return;

  if (shouldBeListening) {
    shouldBeListening = false;
    recognition.stop();
  } else {
    shouldBeListening = true;
    try {
      recognition.start();
    } catch (error) {
      console.debug(error);
    }
  }
});

clearButton.addEventListener("click", () => {
  writeGeneration += 1;
  isWriting = false;
  responseQueue.length = 0;
  boardContent.replaceChildren();
  status.textContent = shouldBeListening ? "Listening" : "Ready";
});

// Developer shortcut: run testPhrase("grade distribution") in the console.
window.testPhrase = handleTranscript;

createRecognition();
loadResponseLibrary();
