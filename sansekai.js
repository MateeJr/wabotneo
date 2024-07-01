const {
  BufferJSON,
  WA_DEFAULT_EPHEMERAL,
  generateWAMessageFromContent,
  proto,
  generateWAMessageContent,
  generateWAMessage,
  prepareWAMessageMedia,
  areJidsSameUser,
  getContentType,
} = require("@whiskeysockets/baileys");
const fs = require("fs");
const util = require("util");
const chalk = require("chalk");
const axios = require("axios");
const path = require("path");
const { fetch } = require("undici");
const { CohereClient } = require("cohere-ai");
const cohere = new CohereClient({
  token: "u0dPctLiSBNAEJTQCiRuXC44sdc5YCQ2t0DugUlL", // Replace with your actual Cohere API key
});

const unifyAIUrl = "https://api.unify.ai/v0/chat/completions";
const unifyAIHeaders = {
  Authorization: "Bearer XEzpBqod5PHXPCspBAZfSMsv67WNhr3xuQcQ2Vr9q9A=",
  "Content-Type": "application/json",
};
const unifyAIHeaders2 = {
  Authorization: "Bearer XEzpBqod5PHXPCspBAZfSMsv67WNhr3xuQcQ2Vr9q9A=",
  "Content-Type": "application/json",
};

let setting = require("./key.json");

function loadOrCreateJSON(filePath, defaultContent = {}) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } else {
      fs.writeFileSync(filePath, JSON.stringify(defaultContent), "utf8");
      return defaultContent;
    }
  } catch (error) {
    console.log(`Error loading or creating ${filePath}:`, error);
    return defaultContent;
  }
}

let systemPrompt;
try {
  systemPrompt = {
    role: "system",
    content: fs.readFileSync("./system.txt", "utf8"),
  };
} catch (error) {
  console.log("Error reading system prompt:", error);
  systemPrompt = {
    role: "system",
    content:
      "Sorry, system prompt failed to load. Please check system.txt file.",
  };
}

let memoryData = loadOrCreateJSON("./memory.json");

function saveMemory() {
  fs.writeFileSync(
    "./memory.json",
    JSON.stringify(memoryData, null, 2),
    "utf8",
  );
}

// Add this function at the top of the file
function getCurrentTimeAndDate() {
const now = new Date();
return now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
}

async function getLLMSummaryAndCheck(
  chatId,
  userName,
  userMessage,
  aiResponse,
  previousMemory
) {
  console.log("Starting getLLMSummaryAndCheck");
  console.log("Inputs:", { chatId, userName, userMessage, aiResponse, previousMemory });

  const url = "https://api.unify.ai/v0/chat/completions";
  const headers = {
    Authorization: "Bearer XEzpBqod5PHXPCspBAZfSMsv67WNhr3xuQcQ2Vr9q9A=",
    "Content-Type": "application/json",
  };
  const payload = {
    model: "claude-3.5-sonnet@anthropic",
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content:
          'You are the AI ​​assistant, summarize and view user messages and AI responses and record any new knowledge about USER for the AI ​​memory inside! ANSWERS FROM AI RESPONSE DO NOT ENTER INTO MEMORY, ONLY USER THINGS!, respond with "blank" if there is no new knowledge about the user or it is not necessary, and only memorize hobbies, likes, dislikes, new information, disinterest, interests, personality, memories user-directed , characters, nicknames and very important information. SHOULD BE BRIEF, TO THE POINT, WITHOUT EXPLANATIONS! IF ITS BLANK, ANSWER text: kosong... or dont answer, or answer null.... IF THE PREVIOUS MEMORY ALREADY EXISTS, THEN DONT NEED ANY MORE AKA its blank null! AVOID TWO SAME MEMORY, JUST kosong or null',
      },
      {
        role: "user",
        content: `Previous memory: ${previousMemory}\n\ntake a look at User message, is there any new knowledge about user? if yes take a note and reply, here's user messages: ${userMessage}\n\nAI response: only for context understanding, not included as user knowledge: ${aiResponse}`,
      },
    ],
  };
  
  try {
    console.log("Sending request to API");
    const response = await axios.post(url, payload, { headers });
    console.log("API response:", response.data);
    const content = response.data.choices[0].message.content;
    console.log("API content:", content);
  
    let summary = "";
    let correction = null;
  
    // Check if content is null, empty, or contains 'kosong'
    if (!content || content.trim() === "" || content.toLowerCase().includes("kosong") || content.toLowerCase().includes("null")) {
      console.log("API returned empty or 'kosong' response");
      return { summary: "", correction: null };
    }
  
    if (content.toLowerCase().includes("new knowledge about user:")) {
      summary = content.split("New knowledge about user:")[1].trim();
    } else if (!content.toLowerCase().includes("no new knowledge")) {
      summary = content.trim();
    }
  
    // If summary is empty after processing, return empty result
    if (!summary || summary.trim() === "") {
      console.log("No valid summary extracted");
      return { summary: "", correction: null };
    }
  
    console.log("Extracted summary:", summary);
    return { summary, correction };
  } catch (error) {
    console.error(
      "Error in getLLMSummaryAndCheck:",
      error.response ? error.response.data : error.message
    );
    return { summary: "", correction: null };
  }};

function addMemory(chatId, userName, userMessage, aiResponse) {
  setImmediate(async () => {
    try {
      console.log("Starting addMemory function");
      console.log("Inputs:", { chatId, userName, userMessage, aiResponse });

      if (!memoryData[chatId]) {
        console.log("Initializing memory for chatId:", chatId);
        memoryData[chatId] = [];
      }

      const previousMemory = memoryData[chatId]
        .map((mem) => `${mem.user}: ${mem.memory}`)
        .join("\n");
      console.log("Previous memory:", previousMemory);

      console.log("Calling getLLMSummaryAndCheck");
      const result = await getLLMSummaryAndCheck(
        chatId,
        userName,
        userMessage,
        aiResponse,
        previousMemory
      );
      console.log("LLM Summary result:", result);

      if (result.summary && result.summary !== "empty") {
        console.log("Adding new memory");
        const newMemory = {
          user: userName,
          memory: result.summary,
          timestamp: new Date().toISOString(),
        };
        memoryData[chatId].push(newMemory);
        console.log("Memory added:", newMemory);
      } else {
        console.log("No new memory added");
      }

      if (result.correction && result.correction.old && result.correction.new) {
        console.log("Applying correction to memory");
        const index = memoryData[chatId].findIndex((mem) =>
          mem.memory.includes(result.correction.old)
        );
        if (index !== -1) {
          console.log("Correction applied to memory at index:", index);
          memoryData[chatId][index].memory = memoryData[chatId][
            index
          ].memory.replace(result.correction.old, result.correction.new);
          memoryData[chatId][index].timestamp = new Date().toISOString();
        } else {
          console.log("No matching memory found for correction");
        }
      }

      console.log("Sorting memory by timestamp");
      memoryData[chatId].sort(
        (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
      );

      console.log("Saving memory");
      saveMemory();

      console.log("Memory after update:", memoryData[chatId]);
    } catch (error) {
      console.error("Error processing memory:", error);
    }
  });
}
function addMemory(chatId, userName, userMessage, aiResponse) {
  setImmediate(async () => {
    try {
      console.log("Starting addMemory function");
      console.log("Inputs:", { chatId, userName, userMessage, aiResponse });

      if (!memoryData[chatId]) {
        console.log("Initializing memory for chatId:", chatId);
        memoryData[chatId] = [];
      }

      const previousMemory = memoryData[chatId]
        .map((mem) => `${mem.user}: ${mem.memory}`)
        .join("\n");
      console.log("Previous memory:", previousMemory);

      console.log("Calling getLLMSummaryAndCheck");
      const result = await getLLMSummaryAndCheck(
        chatId,
        userName,
        userMessage,
        aiResponse,
        previousMemory,
      );
      console.log("LLM Summary result:", result);

      if (result.summary && result.summary !== "empty") {
        console.log("Adding new memory");
        memoryData[chatId].push({
          user: userName,
          memory: result.summary,
          timestamp: new Date().toISOString(),
        });
        console.log("Memory added:", result.summary);
      } else {
        console.log("No new memory added");
      }

      if (result.correction && result.correction.old && result.correction.new) {
        console.log("Applying correction to memory");
        const index = memoryData[chatId].findIndex((mem) =>
          mem.memory.includes(result.correction.old),
        );
        if (index !== -1) {
          console.log("Correction applied to memory at index:", index);
          memoryData[chatId][index].memory = memoryData[chatId][
            index
          ].memory.replace(result.correction.old, result.correction.new);
          memoryData[chatId][index].timestamp = new Date().toISOString();
        } else {
          console.log("No matching memory found for correction");
        }
      }

      console.log("Sorting memory by timestamp");
      memoryData[chatId].sort(
        (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
      );

      console.log("Saving memory");
      saveMemory();

      console.log("Memory after update:", memoryData[chatId]);
    } catch (error) {
      console.error("Error processing memory:", error);
    }
  });
}
function getContextFile(chatId, isGroup, name) {
  const fileName = isGroup
    ? `contextgroup-${name}.json`
    : `context-${name}.json`;
  const filePath = path.join(__dirname, fileName);
  return loadOrCreateJSON(filePath, [systemPrompt]);
}

function saveContext(chatId, isGroup, name, context) {
  const fileName = isGroup
    ? `contextgroup-${name}.json`
    : `context-${name}.json`;
  const filePath = path.join(__dirname, fileName);
  fs.writeFileSync(filePath, JSON.stringify(context, null, 2), "utf8");
}

function updateContextWithLatestMemory(chatId, isGroup, name) {
  const contextFile = getContextFile(chatId, isGroup, name);

  const filteredContext = contextFile.filter(
    (item) => !item.content.startsWith("Previous conversation memory:"),
  );

  const latestMemory = memoryData[chatId]
    ? memoryData[chatId].map((mem) => `${mem.user}: ${mem.memory}`).join("\n")
    : "";

  const lastUserIndex = filteredContext
    .map((item) => item.role)
    .lastIndexOf("user");
  if (lastUserIndex !== -1) {
    filteredContext.splice(lastUserIndex, 0, {
      role: "system",
      content: `Previous conversation memory:\n${latestMemory}`,
    });
  } else {
    filteredContext.push({
      role: "system",
      content: `Previous conversation memory:\n${latestMemory}`,
    });
  }

  saveContext(chatId, isGroup, name, filteredContext);
}

async function chatCompletion(model, messages) {
  const url = "https://api.unify.ai/v0/chat/completions";
  const headers = {
    Authorization: "Bearer XEzpBqod5PHXPCspBAZfSMsv67WNhr3xuQcQ2Vr9q9A=",
    "Content-Type": "application/json",
  };
  const payload = {
    model: model,
    temperature: 1,
    messages: messages,
  };

  try {
    const response = await axios.post(url, payload, { headers });
    return response.data;
  } catch (error) {
    console.error(
      "Error:",
      error.response ? error.response.data : error.message,
    );
    throw error;
  }
}

async function translateToEnglish(text) {
  const url = "https://api.unify.ai/v0/chat/completions";
  const headers = {
    Authorization: "Bearer XEzpBqod5PHXPCspBAZfSMsv67WNhr3xuQcQ2Vr9q9A=",
    "Content-Type": "application/json",
  };
  const payload = {
    model: "gpt-4o@openai",
    messages: [
      {
        role: "system",
        content:
          "You are a translator. Translate the following text to English.",
      },
      { role: "user", content: text },
    ],
  };

  try {
    const response = await axios.post(url, payload, { headers });
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error(
      "Translation Error:",
      error.response ? error.response.data : error.message,
    );
    throw error;
  }
}

async function cohereWebSearch(query) {
  try {
    const response = await cohere.chat({
      model: "command-r-plus",
      message: `Please provide a concise summary of the most relevant and up-to-date ${currentTimeAndDate} (FORMAT CURRENT TIME IS: MONTH/DAY/YEAR, HOUR,MINUTE,SECOND,AM/PM). information about: ${query}. Focus on factual information and recent developments. IF FOUND NOTHING THAT CAN ANSWER THE QUESTION, THEN MUST ANSWER | web search: NO RESULT | (ignore |)NOTHING ELSE!`,
      connectors: [{ id: "web-search" }],
      temperature: 0.3,
      maxTokens: 500,
    });

    return response.text;
  } catch (error) {
    console.error("Error during Cohere web search:", error);
    return null;
  }
}

async function fetchWebContent(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });
    const html = await response.text();
    const bodyContent = html.match(/<body.*?>([\s\S]*)<\/body>/i);
    return bodyContent ? bodyContent[1].replace(/<.*?>/g, "") : "";
  } catch (error) {
    console.error("Error fetching web content:", error);
    return "";
  }
}

async function needsWebSearch(query, context = []) {
  const payload = {
    model: "claude-3.5-sonnet@anthropic",
    messages: [
      {
        role: "system",
        content:
          systemPrompt + '||||||||||| You are an AI assistant that determines if a web search is needed to answer a query. If the query answer is available in the system prompt or recent context, then do not use real-time search. if user asking about themself or their own information, check system prompt and do not web search, if you found nothing about user then ask user to do web search or not. If it doesnt sounds like question, then do not web search, WEB SEARCH ONLY FOR IF YOURE ALREADY DESPERATE DIDNT KNOWING THE ANSWER, then do web search.... Respond with only "Yes" or "No".',
      },
      {
        role: "user",
        content: `Does this query REALLY require a web search for up-to-date or real-time information, do you sure it's not inside your memory or system prompt, if there's  really none, then do websearch? IF QUERY ABOUT WHO IS SOMEONE OR PERSON THAT INSIDE SYSTEM PROMPT THEN DO NOT SEARCH WEB, CHECK SYSTEM PROMPT MAYBE THE PERSON INFORMATION IS THERE!! here's the query ,Query: ${query}`,
      },
    ],
  };

  try {
    const response = await axios.post(unifyAIUrl, payload, {
      headers: unifyAIHeaders,
    });
    const answer = response.data.choices[0].message.content
      .trim()
      .toLowerCase();
    return answer === "yes";
  } catch (error) {
    console.error("Error in needsWebSearch:", error);
    return false;
  }
}

async function summarizeSearchResults(results, query) {
  const url = "https://api.unify.ai/v0/chat/completions";
  const headers = {
    Authorization: "Bearer XEzpBqod5PHXPCspBAZfSMsv67WNhr3xuQcQ2Vr9q9A=",
    "Content-Type": "application/json",
  };
  const payload = {
    model: "claude-3-haiku@anthropic",
    messages: [
      {
        role: "system",
        content:
          "You are an AI assistant that summarizes search results concisely and relevantly using bahasa indonesia.",
      },
      {
        role: "user",
        content: `Summarize the following search results in relation to the query, try get latest and most recent one..bahasa indonesia , be accurate and do not hallucination: "${query}"\n\n${results}`,
      },
    ],
  };

  try {
    const response = await axios.post(url, payload, { headers });
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error("Error summarizing search results:", error);
    return "";
  }
}

async function summarizeForSearch(query, context) {
  const url = "https://api.unify.ai/v0/chat/completions";
  const headers = {
    Authorization: "Bearer XEzpBqod5PHXPCspBAZfSMsv67WNhr3xuQcQ2Vr9q9A=",
    "Content-Type": "application/json",
  };

  // Get the last 10 messages from the context
  const recentContext = context
    .slice(-10)
    .map((msg) => `${msg.role}: ${msg.content}`)
    .join("\n");

  // First attempt: Summarize in Bahasa Indonesia
  const payloadIndonesian = {
    model: "claude-3-haiku@anthropic",
    messages: [
      {
        role: "system",
        content:
          "Ringkaskan pertanyaan berikut menjadi kueri pencarian yang singkat dan cocok untuk mesin pencari web. Pertahankan bahasa Indonesia jika pertanyaan dalam bahasa Indonesia. Fokus pada kebutuhan informasi utama.",
      },
      {
        role: "user",
        content: `Konteks terbaru:\n${recentContext}\n\nPertanyaan: ${query}\n\nMohon ringkas ini menjadi kueri pencarian dalam bahasa Indonesia.`,
      },
    ],
  };

  try {
    const responseIndonesian = await axios.post(url, payloadIndonesian, { headers });
    const indonesianQuery = responseIndonesian.data.choices[0].message.content.trim();

    // Perform search with Indonesian query
    const indonesianResults = await cohereWebSearch(indonesianQuery);

    if (indonesianResults && !indonesianResults.includes("NO RESULT")) {
      return { query: indonesianQuery, results: indonesianResults };
    }

    // If no results, translate to English and try again
    const translatedQuery = await translateToEnglish(query);
    const payloadEnglish = {
      model: "claude-3-haiku@anthropic",
      messages: [
        {
          role: "system",
          content:
            "Summarize the following question into a concise search query suitable for a web search engine. Keep it brief and focused on the main information need.",
        },
        {
          role: "user",
          content: `Recent context:\n${recentContext}\n\nQuestion: ${translatedQuery}\n\nPlease summarize this into a search query in English.`,
        },
      ],
    };

    const responseEnglish = await axios.post(url, payloadEnglish, { headers });
    const englishQuery = responseEnglish.data.choices[0].message.content.trim();

    // Perform search with English query
    const englishResults = await cohereWebSearch(englishQuery);

    return { query: englishQuery, results: englishResults };
  } catch (error) {
    console.error("Error in summarizeForSearch:", error);
    return { query: query, results: null };
  }
}

async function isTimeQuery(query) {
  const url = "https://api.unify.ai/v0/chat/completions";
  const headers = {
    Authorization: "Bearer XEzpBqod5PHXPCspBAZfSMsv67WNhr3xuQcQ2Vr9q9A=",
    "Content-Type": "application/json",
  };

  const payload = {
    model: "claude-3-5-sonnet@anthropic",
    messages: [
      {
        role: "system",
        content:
          'You are an AI assistant that determines if a query is asking about the CURRENT, STRICTLY CURRENT time or date. Respond with only "Yes" or "No".',
      },
      {
        role: "user",
        content: `Is this query asking about the current time? Query: ${query}`,
      },
    ],
  };

  try {
    const response = await axios.post(url, payload, { headers });
    const answer = response.data.choices[0].message.content
      .trim()
      .toLowerCase();
    return answer === "yes";
  } catch (error) {
    console.error("Error in isTimeQuery:", error);
    return false;
  }
}

function getCurrentTime(timezone = "Asia/Jakarta") {
  return new Date().toLocaleString("en-US", {
    timeZone: timezone,
    timeStyle: "full",
    dateStyle: "full",
  });
}

module.exports = sansekai = async (client, m, chatUpdate) => {
  try {
    var body =
      m.mtype === "conversation"
        ? m.message.conversation
        : m.mtype == "imageMessage"
          ? m.message.imageMessage.caption
          : m.mtype == "videoMessage"
            ? m.message.videoMessage.caption
            : m.mtype == "extendedTextMessage"
              ? m.message.extendedTextMessage.text
              : m.mtype == "buttonsResponseMessage"
                ? m.message.buttonsResponseMessage.selectedButtonId
                : m.mtype == "listResponseMessage"
                  ? m.message.listResponseMessage.singleSelectReply
                      .selectedRowId
                  : m.mtype == "templateButtonReplyMessage"
                    ? m.message.templateButtonReplyMessage.selectedId
                    : m.mtype === "messageContextInfo"
                      ? m.message.buttonsResponseMessage?.selectedButtonId ||
                        m.message.listResponseMessage?.singleSelectReply
                          .selectedRowId ||
                        m.text
                      : "";
    var budy = typeof m.text == "string" ? m.text : "";
    var prefix = /^[\\/!#.]/gi.test(body) ? body.match(/^[\\/!#.]/gi) : "/";
    const isCmd2 = body.startsWith(prefix);
    const command = body
      .replace(prefix, "")
      .trim()
      .split(/ +/)
      .shift()
      .toLowerCase();
    const args = body.trim().split(/ +/).slice(1);
    const pushname = m.pushName || "No Name";
    const botNumber = await client.decodeJid(client.user.id);
    const itsMe = m.sender == botNumber ? true : false;
    let text = (q = args.join(" "));
    const arg = budy.trim().substring(budy.indexOf(" ") + 1);
    const arg1 = arg.trim().substring(arg.indexOf(" ") + 1);

    const from = m.chat;
    const reply = m.reply;
    const sender = m.sender;
    const mek = chatUpdate.messages[0];

    const color = (text, color) => {
      return !color ? chalk.green(text) : chalk.keyword(color)(text);
    };

    // Group
    const groupMetadata = m.isGroup
      ? await client.groupMetadata(m.chat).catch((e) => {})
      : "";
    const groupName = m.isGroup ? groupMetadata.subject : "";

    // Push Message To Console
    let argsLog = budy.length > 30 ? `${q.substring(0, 30)}...` : budy;

    if (isCmd2 && !m.isGroup) {
      console.log(
        chalk.black(chalk.bgWhite("[ LOGS ]")),
        color(argsLog, "turquoise"),
        chalk.magenta("From"),
        chalk.green(pushname),
        chalk.yellow(`[ ${m.sender.replace("@s.whatsapp.net", "")} ]`),
      );
    } else if (isCmd2 && m.isGroup) {
      console.log(
        chalk.black(chalk.bgWhite("[ LOGS ]")),
        color(argsLog, "turquoise"),
        chalk.magenta("From"),
        chalk.green(pushname),
        chalk.yellow(`[ ${m.sender.replace("@s.whatsapp.net", "")} ]`),
        chalk.blueBright("IN"),
        chalk.green(groupName),
      );
    }

    if (isCmd2) {
      switch (command) {
        case "help":
        case "menu":
        case "start":
        case "info":
          m.reply(`*Whatsapp Bot OpenAI*

                                  *(ChatGPT)*
                                  Cmd: ${prefix}a 
                                  Ask anything to AI. 

                                  *(DALL-E)*
                                  Cmd: ${prefix}omaga
                                  Create image from text

                                  *(Unify AI)*
                                  Cmd: ${prefix}unify
                                  Chat with Unify AI

                                  *(Reset Context)*
                                  Cmd: ${prefix}reset
                                  Delete chat history with AI

                                  *(Source Code Bot)*
                                  Cmd: ${prefix}sc
                                  Display the bot's source code`);
          break;
          // Add this function at the top of the file
function getCurrentTimeAndDate() {
const now = new Date();
return now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
}

// In the case "a": block, modify the code as follows:
case "a":
case "chat":
case "nanya":
case "ask":
try {
  if (!text)
    return reply(
      `Chat with AI.\n\nExample:\n${prefix}${command} chat with me`,
    );

  let chatId = m.chat;
  let isGroup = m.isGroup;
  let contextName = isGroup
    ? groupName
    : pushname || sender.split("@")[0];
  let currentContext = getContextFile(chatId, isGroup, contextName);

  // Get current time and date
  const currentTimeAndDate = getCurrentTimeAndDate();

  // Add current time and date to context
  currentContext.push({
    role: "system",
    content: `DO NOT WRITE THIS INTO YOUR RESPONSES: Current time and date: ${currentTimeAndDate}`,
  });

  // Store the user's latest input
  const userLatestInput = `${pushname}: ${q}`;

  // Add user's latest input to context
  currentContext.push({ role: "user", content: userLatestInput });

  // Check if it's a time query
  const isTimeQuestion = await isTimeQuery(q);

  if (isTimeQuestion) {
    const timeZone = q.toLowerCase().includes("medan")
      ? "Asia/Jakarta"
      : "Asia/Jakarta";
    const currentTime = getCurrentTime(timeZone);
    const timeResponse = `The current time is: ${currentTime}`;

    await m.reply(timeResponse);

    // Add AI response to context
    currentContext.push({ role: "assistant", content: timeResponse });

    // Save updated context
    saveContext(chatId, isGroup, contextName, currentContext);

    // Update memory
    await addMemory(chatId, pushname, q, timeResponse);

    // Update context with latest memory
    updateContextWithLatestMemory(chatId, isGroup, contextName);

    return;
  }

  // Check if web search is needed
  const needsSearch = await needsWebSearch(q, currentContext);

  if (needsSearch) {
    // Send "Searching..." message
    await m.reply("Sedang mencari data...");

    // Use the new summarizeForSearch function
    const { query: searchQuery, results: searchResults } = await summarizeForSearch(q, currentContext);

    if (searchResults && !searchResults.includes("NO RESULT")) {
      currentContext.push({
        role: "system",
        content: `Relevant web search information: ${searchResults}`,
      });
      console.log("Web search results added to context");
    } else {
      console.log("No relevant web search results found");
    }
  }

  // Generate AI response using Claude via Unify.AI
  const payload = {
    model: "claude-3.5-sonnet@anthropic",
    messages: currentContext,
  };

  const response = await axios.post("https://api.unify.ai/v0/chat/completions", payload, {
    headers: {
      Authorization: "Bearer XEzpBqod5PHXPCspBAZfSMsv67WNhr3xuQcQ2Vr9q9A=",
      "Content-Type": "application/json",
    },
  });

  if (
    response.data.choices &&
    response.data.choices.length > 0 &&
    response.data.choices[0].message
  ) {
    const aiResponse = response.data.choices[0].message.content;

    // Prepend the current time and date to the AI response
    const finalResponse = `${aiResponse}`;

    // Send response to WhatsApp user
    await m.reply(finalResponse);

    // Add AI response to context
    currentContext.push({ role: "assistant", content: finalResponse });

    // Perform additional tasks asynchronously
    setImmediate(async () => {
      try {
        // Trim context if it's too long
        const totalTokens = currentContext.reduce(
          (acc, message) => acc + message.content.length / 4,
          0
        );
        while (totalTokens > 200000) {
          currentContext.splice(1, 2);
        }

        // Save updated context
        saveContext(chatId, isGroup, contextName, currentContext);

        // Update memory
        await addMemory(chatId, pushname, q, finalResponse);

        // Update context with latest memory
        updateContextWithLatestMemory(chatId, isGroup, contextName);
      } catch (error) {
        console.error("Error in asynchronous tasks:", error);
      }
    });
  } else {
    console.log("Unexpected API response structure:", response.data);
    m.reply("Sorry, I couldn't generate a proper response.");
  }
} catch (error) {
  console.error("Error in API request:", error.response ? error.response.data : error.message);
  console.error("Status code:", error.response ? error.response.status : "N/A");
  console.error("Headers:", error.response ? error.response.headers : "N/A");
  m.reply("Oops, looks like there's an error: " + error.message);
}
break;
            
              case "g": case "ai-img": case "img": case "gambar": case "draw": case "buat":
                try {
                  if (!text) return reply(`Membuat gambar dari AI.\n\nContoh:\n${prefix}${command} Wooden house on snow mountain`);
                  
                  const translatedPrompt = await translateToEnglish(q);
                  
                  const response = await axios.post('https://image.octoai.run/generate/sdxl', {
                    prompt: translatedPrompt,
                    negative_prompt: "Blurry, low-res, poor quality",
                    checkpoint: "octoai:crystal-clear",
                    loras: {
                      "octoai:add-detail": 0.5
                    },
                    width: 1344,
                    height: 768,
                    num_images: 1,
                    sampler: "DPM_PLUS_PLUS_2M_KARRAS",
                    steps: 30,
                    cfg_scale: 7.5,
                    use_refiner: true,
                    high_noise_frac: 0.8,
                    style_preset: "cinematic"
                  }, {
                    headers: {
                      'Authorization': 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjNkMjMzOTQ5In0.eyJzdWIiOiIyY2JjYzI0OS0yN2YzLTQ2ODgtOTg2ZS1jMmU1NzExNTQ3ZTciLCJ0eXBlIjoidXNlckFjY2Vzc1Rva2VuIiwidGVuYW50SWQiOiJkMmQ4NDMwNy1kZDc0LTRjZjktOTFmMC01NjA4NmJiNDQ0OTYiLCJ1c2VySWQiOiJkMWYxODc3NC1iMTBhLTRjMDktYTM4NS04YWY0YzQzMTUwNzAiLCJhcHBsaWNhdGlvbklkIjoiYTkyNmZlYmQtMjFlYS00ODdiLTg1ZjUtMzQ5NDA5N2VjODMzIiwicm9sZXMiOlsiRkVUQ0gtUk9MRVMtQlktQVBJIl0sInBlcm1pc3Npb25zIjpbIkZFVENILVBFUk1JU1NJT05TLUJZLUFQSSJdLCJhdWQiOiIzZDIzMzk0OS1hMmZiLTRhYjAtYjdlYy00NmY2MjU1YzUxMGUiLCJpc3MiOiJodHRwczovL2lkZW50aXR5Lm9jdG8uYWkiLCJpYXQiOjE3MTk3MjAyMDZ9.CMqp-3SKNZtRvmNCVvAG3YjLTTmQJFymSRe3CXQRvaWYcxFTxf2tlVG_DxmVqyuPRihzQsFzxPn76EEZ5Gg2ApUFx387xktL_3wBIlHwGOcFAWIxult1CgNhD4SV4joCjyeZTlJq1HEs4PfUXSqtUVTRGa3p7uKXK3lijJbGxr339xEbg7QrOKstW2J2CftupBLBYNjsAjjvF3S_5uoNNm_atebh3GASrbfNz_Uzg4L2n2HebCqH8xvb-FAIS9KXPYiDHSD5MN2dvTBmcMG_AwA4EK6vPDm4MnXYfVFzquW9ylDYyh2un77WL78lc53jBmsrg5910C5P7qnUnUWQjg',
                      'Content-Type': 'application/json'
                    }
                  });
              
                  console.log('Full response:', response.data);
              
                  if (response.data && response.data.images && response.data.images.length > 0) {
                    const imageBase64 = response.data.images[0].image_b64;
              
                    const imageBuffer = Buffer.from(imageBase64, 'base64');
              
                    const filename = `result_${Date.now()}.jpg`;
              
                    fs.writeFileSync(filename, imageBuffer);
              
                    await client.sendImage(from, filename, text, mek);
              
                    fs.unlinkSync(filename);
                  } else {
                    console.log('Response data structure is incorrect:', response.data);
                    m.reply("Maaf, sepertinya ada yang error dengan format response.");
                  }
                } catch (error) {
                  console.log(error);
                  m.reply("Maaf, sepertinya ada yang error :" + error.message);
                }
                break;
      
        case "unify":
          try {
            if (!text)
              return reply(
                `Chat with Unify AI.\n\nExample:\n${prefix}${command} What is a recession`,
              );

            let chatId = m.chat;
            let isGroup = m.isGroup;
            let contextName = isGroup
              ? groupName
              : pushname || sender.split("@")[0];
            let currentContext = getContextFile(chatId, isGroup, contextName);

            // Add user message to context
            currentContext.push({ role: "user", content: `${pushname}: ${q}` });

            const response = await chatCompletion(
              "claude-3.5-sonnet@anthropic",
              currentContext,
            );
            const aiResponse = response.choices[0].message.content;

            // Send response to WhatsApp user
            await m.reply(aiResponse);

            // Add AI response to context
            currentContext.push({ role: "assistant", content: aiResponse });

            // Perform additional tasks asynchronously
            setImmediate(async () => {
              try {
                // Check if web search is needed
                const needsSearch = await needsWebSearch(q);

                // Modified part starts here
                const results = await duckDuckGoSearch(searchQuery);
                let searchResults = "";

                if (results && results.RelatedTopics) {
                  for (const topic of results.RelatedTopics.slice(0, 5)) {
                    if (topic.Text) {
                      searchResults += `${topic.Text}\n\n`;
                    }
                  }
                }

                if (searchResults) {
                  searchResults = await summarizeSearchResults(
                    searchResults,
                    searchQuery,
                  );
                  currentContext.push({
                    role: "system",
                    content: `Relevant web search information: ${searchResults}`,
                  });
                }
                // Modified part ends here

                // Trim context if it's too long
                const totalTokens = currentContext.reduce(
                  (acc, message) => acc + message.content.length / 4,
                  0,
                );
                while (totalTokens > 200000) {
                  currentContext.splice(1, 2);
                }

                // Save updated context
                saveContext(chatId, isGroup, contextName, currentContext);

                // Update memory
                await addMemory(chatId, pushname, q, aiResponse);

                // Update context with latest memory
                updateContextWithLatestMemory(chatId, isGroup, contextName);
              } catch (error) {
                console.error("Error in asynchronous tasks:", error);
              }
            });
          } catch (error) {
            console.log(error);
            m.reply("Sorry, there seems to be an error: " + error.message);
          }
          break;
        case "adminreset":
          try {
            let chatId = m.chat;
            let isGroup = m.isGroup;
            let contextName = isGroup
              ? groupName
              : pushname || sender.split("@")[0];
            let currentContext = getContextFile(chatId, isGroup, contextName);

            if (currentContext.length > 1) {
              currentContext = [systemPrompt];
              saveContext(chatId, isGroup, contextName, currentContext);

              // Also reset memory for this chat
              if (memoryData[chatId]) {
                delete memoryData[chatId];
                saveMemory();
              }

              m.reply("AI chat memory and context have been reset.");
            } else {
              m.reply(
                "There's no AI chat memory or context that needs to be reset.",
              );
            }
          } catch (error) {
            console.log(error);
            m.reply(
              "Sorry, an error occurred while resetting AI memory and context: " +
                error.message,
            );
          }
          break;
        case "dev":
        case "tentang":
        case "about":
          m.reply("This bot was created by Vallian Sayoga");
          break;
        default: {
          if (isCmd2 && budy.toLowerCase() != undefined) {
            if (m.chat.endsWith("broadcast")) return;
            if (m.isBaileys) return;
            if (!budy.toLowerCase()) return;
            if (argsLog || (isCmd2 && !m.isGroup)) {
              console.log(
                chalk.black(chalk.bgRed("[ ERROR ]")),
                color("command", "turquoise"),
                color(`${prefix}${command}`, "turquoise"),
                color("is not available", "turquoise"),
              );
            } else if (argsLog || (isCmd2 && m.isGroup)) {
              console.log(
                chalk.black(chalk.bgRed("[ ERROR ]")),
                color("command", "turquoise"),
                color(`${prefix}${command}`, "turquoise"),
                color("is not available", "turquoise"),
              );
            }
          }
        }
      }
    }
  } catch (err) {
    m.reply(util.format(err));
  }
};

let file = require.resolve(__filename);
fs.watchFile(file, () => {
  fs.unwatchFile(file);
  console.log(chalk.redBright(`Update ${__filename}`));
  delete require.cache[file];
  require(file);
});
