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
  const { downloadMediaMessage } = require("@whiskeysockets/baileys");
  const fs = require("fs");
  const util = require("util");
  const chalk = require("chalk");
  const axios = require("axios");
  const path = require("path");
  const { fetch } = require("undici");
  const { CohereClient } = require("cohere-ai");
  const cohere = new CohereClient({
    token: "u0dPctLiSBNAEJTQCiRuXC44sdc5YCQ2t0DugUlL",
  });
  require('dotenv').config();

  const { GoogleGenerativeAI } = require("@google/generative-ai");
  const {
    FileState,
    GoogleAICacheManager,
    GoogleAIFileManager,
  } = require("@google/generative-ai/server");

  const genAI = new GoogleGenerativeAI(process.env.API_KEY);
  const cacheManager = new GoogleAICacheManager(process.env.API_KEY);
  const fileManager = new GoogleAIFileManager(process.env.API_KEY);

  let setting = require("./key.json");

  const processedMessages = new Set();
  let isImageAnalysisInProgress = false;
  let lastProcessedMessageId = null;

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
  content: fs.readFileSync("./system.txt", "utf8") + "\n\nPENTING: Selalu jawab dalam Bahasa Indonesia dengan gaya gen-z yang feminim, cute, dan imut. Gunakan emoji secukupnya."
    };
  } catch (error) {
    console.log("Error reading system prompt:", error);
    systemPrompt = {
      role: "system",
      content: "Sorry, system prompt failed to load. Please check system.txt file.",
    };
  }

  let memoryData = loadOrCreateJSON("./memory.json");

  function saveMemory() {
    fs.writeFileSync("./memory.json", JSON.stringify(memoryData, null, 2), "utf8");
  }

  function getCurrentTimeAndDate() {
    const now = new Date();
    return now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' });
  }

  function getContextFile(chatId, isGroup, name) {
    const fileName = isGroup
      ? `contextgroup-${name}.json`
      : `context-${name}.json`;
    const filePath = path.join(__dirname, fileName);
    const context = loadOrCreateJSON(filePath, []);
    return context.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  }

  function saveContext(chatId, isGroup, name, context) {
    const fileName = isGroup
      ? `contextgroup-${name}.json`
      : `context-${name}.json`;
    const filePath = path.join(__dirname, fileName);
    fs.writeFileSync(filePath, JSON.stringify(context, null, 2), "utf8");
  }

  async function getLLMSummaryAndCheck(chatId, userName, userMessage, aiResponse, previousMemory) {
    console.log("Starting getLLMSummaryAndCheck");
    console.log("Inputs:", { chatId, userName, userMessage, aiResponse, previousMemory });

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-001" });

    const prompt = `You are the AI assistant, summarize and view user messages and AI responses and record any new knowledge about USER for the AI memory inside! ANSWERS FROM AI RESPONSE DO NOT ENTER INTO MEMORY, ONLY USER THINGS!, respond with "blank" if there is no new knowledge about the user or it is not necessary, and only memorize hobbies, likes, dislikes, new information, disinterest, interests, personality, memories user-directed , characters, nicknames and very important information. SHOULD BE BRIEF, TO THE POINT, WITHOUT EXPLANATIONS! IF ITS BLANK, ANSWER text: kosong... or dont answer, or answer null.... IF THE PREVIOUS MEMORY ALREADY EXISTS, THEN DONT NEED ANY MORE AKA its blank null! AVOID TWO SAME MEMORY, JUST kosong or null

  Previous memory: ${previousMemory}

  take a look at User message, is there any new knowledge about user? if yes take a note and reply, here's user messages: ${userMessage}

  AI response: only for context understanding, not included as user knowledge: ${aiResponse}`;

    try {
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.9,
          topK: 1,
          topP: 1,
          maxOutputTokens: 2048,
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_NONE",
          },
        ],
      });
      const response = await result.response;
      const content = response.text();
      console.log("API content:", content);
    
      let summary = "";
      let correction = null;
    
      if (!content || content.trim() === "" || content.toLowerCase().includes("kosong") || content.toLowerCase().includes("null")) {
        console.log("API returned empty or 'kosong' response");
        return { summary: "", correction: null };
      }
    
      if (content.toLowerCase().includes("new knowledge about user:")) {
        summary = content.split("New knowledge about user:")[1].trim();
      } else if (!content.toLowerCase().includes("no new knowledge")) {
        summary = content.trim();
      }
    
      if (!summary || summary.trim() === "") {
        console.log("No valid summary extracted");
        return { summary: "", correction: null };
      }
    
      console.log("Extracted summary:", summary);
      return { summary, correction };
    } catch (error) {
      console.error("Error in getLLMSummaryAndCheck:", error);
      return { summary: "", correction: null };
    }
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

  async function chatCompletion(messages, cache) {
    try {
      const genModel = genAI.getGenerativeModelFromCachedContent(cache);

      const result = await genModel.generateContent({
        contents: messages.map(msg => ({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }],
        })),
        generationConfig: {
          temperature: 0.9,
          topK: 1,
          topP: 1,
          maxOutputTokens: 2048,
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_NONE",
          },
        ],
      });

      const response = await result.response;
      console.log("Token usage:", result.response.usageMetadata);
      return response.text();
    } catch (error) {
      console.error("Error in chatCompletion:", error);
      return chatCompletionWithoutCache(messages);
    }
  }

  async function chatCompletionWithoutCache(messages, systemPrompt, contextFile = []) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-001" });
  
    try {
      console.log("Sending request to Gemini API for chat completion...");
      
      const combinedMessages = [
        { role: 'user', parts: [{ text: systemPrompt }] },
        ...(Array.isArray(contextFile) ? contextFile.map(msg => ({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }]
        })) : []),
        ...messages.map(msg => ({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content || msg.parts[0].text }]
        }))
      ];
  
      console.log("Combined messages:", JSON.stringify(combinedMessages, null, 2));
  
      const result = await model.generateContent({
        contents: combinedMessages,
        generationConfig: {
          temperature: 0.9,
          topK: 1,
          topP: 1,
          maxOutputTokens: 2048,
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_NONE",
          },
        ],
      });
  
      console.log("Received response from Gemini API:", JSON.stringify(result, null, 2));
  
      if (result.response && result.response.candidates && result.response.candidates.length > 0) {
        const textContent = result.response.candidates[0].content.parts[0].text;
        return textContent.trim();
      }
  
      throw new Error("Unable to find text content in API response");
  
    } catch (error) {
      console.error("Error in chatCompletionWithoutCache:", error);
      throw error;
    }
  }
  
  async function generateResponseFromWebSearch(webSearchResult, userQuery, systemPromptContent, userName, contextFile) {
    // First, let's read the system.txt file
    let systemPrompt;
    try {
      systemPrompt = fs.readFileSync("./system.txt", "utf8");
    } catch (error) {
      console.log("Error reading system prompt:", error);
      systemPrompt = "Sorry, system prompt failed to load. Please check system.txt file.";
    }
  
    const prompt = `${systemPrompt}
  
  PENTING: Kamu adalah AI assistant bernama veo, dan ${userName} adalah user yang bertanya. Gunakan hasil pencarian web untuk menjawab pertanyaan user. Jangan abaikan informasi yang diberikan dalam hasil pencarian web.
  
  Hasil pencarian web (dalam bahasa Inggris): ${webSearchResult}
  
  User ${userName} bertanya: ${userQuery}
  
  Tugas kamu:
  1. Terjemahkan hasil pencarian web ke dalam bahasa Indonesia.
  2. Tulis ulang informasi tersebut dalam gaya bahasamu sendiri, sesuai dengan panduan dalam system prompt.
  3. Berikan respons yang relevan, informatif, dan menarik berdasarkan hasil pencarian web yang sudah diterjemahkan.
  4. Gunakan gaya bahasa sesuai instruksi dalam system prompt (gen-z, feminim, cute, imut, dengan emoji).
  5. Pastikan responmu mengandung inti informasi dari hasil pencarian web, tapi dalam kata-katamu sendiri.
  6. Jangan gunakan frasa "veo nemu info nih" atau sejenisnya. Langsung saja berikan informasinya dengan gaya bahasamu.
  
  Berikan respons untuk user:`;
  
    const messages = [
      { role: 'user', parts: [{ text: prompt }] },
    ];
  
    let response = await chatCompletionWithoutCache(messages, '', contextFile);
  
    // Check if the response is too short or doesn't seem to contain the information
    if (response.length < 50 || !response.toLowerCase().includes(webSearchResult.toLowerCase().substring(0, 10))) {
      // If so, try again with a more forceful prompt
      const retryPrompt = `${prompt}\n\nPENTING: Kamu belum memberikan informasi dari hasil pencarian web dengan benar. Tolong tulis ulang responmu, pastikan untuk menyertakan informasi utama dari hasil pencarian web dalam kata-katamu sendiri, dengan gaya bahasa yang sesuai.`;
      response = await chatCompletionWithoutCache([{ role: 'user', parts: [{ text: retryPrompt }] }], '', contextFile);
    }
  
    return response;
  }
  
  function generateFallbackResponse(lastUserMessage) {
    // This is a simple fallback. You can make it more sophisticated if needed.
    return `Maaf, saya mengalami kesulitan dalam memproses permintaan Anda. Namun, berdasarkan pertanyaan terakhir Anda: "${lastUserMessage}", saya akan mencoba menjawab secara umum. Mohon ajukan pertanyaan Anda kembali atau coba beberapa saat lagi.`;
  }

  async function cohereWebSearch(query) {
    try {
      const response = await cohere.chat({
        model: "command-r-plus",
        message: `Please provide a concise summary of the most relevant and up-to-date ${getCurrentTimeAndDate()} (FORMAT CURRENT TIME IS: MONTH/DAY/YEAR, HOUR,MINUTE,SECOND,AM/PM). information about: ${query}. Focus on factual information and recent developments. IF FOUND NOTHING THAT CAN ANSWER THE QUESTION, THEN MUST ANSWER | web search: NO RESULT | (ignore |)NOTHING ELSE!`,
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

  async function needsWebSearch(query, context = []) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-001" });
  
    const prompt = `You are an AI assistant that determines if a web search is needed to answer a query. Respond with only "Yes" or "No".
  
  Current date and time: ${getCurrentTimeAndDate()}
  
  Consider the following factors:
  1. If the query asks for current events, news, or up-to-date information, answer "Yes".
  2. If the query is about a specific person, place, or thing that might have recent developments, answer "Yes".
  3. If the query is about historical facts, general knowledge, or information that doesn't change frequently, answer "No".
  4. If the query is about the user themselves or information contained in the system prompt, answer "No".
  5. If the query is not a question but a statement or command, answer "No".
  6. If you're unsure whether you have the most current information to answer accurately, err on the side of caution and answer "Yes".
  
  Query: ${query}
  
  Does this query require a web search for up-to-date or real-time information?`;
  
    try {
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          topK: 1,
          topP: 1,
          maxOutputTokens: 2048,
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_NONE",
          },
        ],
      });
      const response = await result.response;
      const answer = response.text().trim().toLowerCase();
      console.log("needsWebSearch result:", answer);
      return answer === "yes";
    } catch (error) {
      console.error("Error in needsWebSearch:", error);
      return true; // Default to performing a web search if there's an error
    }
  }

  async function summarizeSearchResults(results, query) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-001" });
  
    const prompt = `You are an AI assistant that summarizes search results concisely and relevantly using bahasa indonesia. Summarize the following search results in relation to the query, try get latest and most recent one..bahasa indonesia , be accurate and do not hallucination: "${query}"\n\n${results}`;
  
    try {
      console.log("Sending request to Gemini API for summarization...");
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.9,
          topK: 1,
          topP: 1,
          maxOutputTokens: 2048,
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_NONE",
          },
        ],
      });
  
      console.log("Received response from Gemini API:", result);
  
      if (!result.response) {
        throw new Error("Unexpected API response structure: missing 'response' property");
      }
  
      const response = result.response;
      console.log("Response object:", response);
  
      if (typeof response.text !== 'function') {
        throw new Error("Unexpected API response structure: 'text' is not a function");
      }
  
      const summary = response.text();
      console.log("Summarized result:", summary);
  
      return summary;
    } catch (error) {
      console.error("Error summarizing search results:", error);
      throw error; // Re-throw the error to be handled by the caller
    }
  }

  async function summarizeForSearch(query, context) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-001" });

    const recentContext = context
      .slice(-10)
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n");

    const promptIndonesian = `Ringkaskan pertanyaan berikut menjadi kueri pencarian yang singkat dan cocok untuk mesin pencari web. Pertahankan bahasa Indonesia jika pertanyaan dalam bahasa Indonesia. Fokus pada kebutuhan informasi utama.

  Konteks terbaru:
  ${recentContext}

  Pertanyaan: ${query}

  Mohon ringkas ini menjadi kueri pencarian dalam bahasa Indonesia.`;

    try {
      const resultIndonesian = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: promptIndonesian }] }],
        generationConfig: {
          temperature: 0.9,
          topK: 1,
          topP: 1,
          maxOutputTokens: 2048,
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_NONE",
          },
        ],
      });
      const responseIndonesian = await resultIndonesian.response;
      const indonesianQuery = responseIndonesian.text().trim();

      const indonesianResults = await cohereWebSearch(indonesianQuery);

      if (indonesianResults && !indonesianResults.includes("NO RESULT")) {
        return { query: indonesianQuery, results: indonesianResults };
      }

      const translatedQuery = await translateToEnglish(query);
      const promptEnglish = `Summarize the following question into a concise search query suitable for a web search engine. Keep it brief and focused on the main information need.

  Recent context:
  ${recentContext}

  Question: ${translatedQuery}

  Please summarize this into a search query in English.`;

      const resultEnglish = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: promptEnglish }] }],
        generationConfig: {
          temperature: 0.9,
          topK: 1,
          topP: 1,
          maxOutputTokens: 2048,
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_NONE",
          },
        ],
      });
      const responseEnglish = await resultEnglish.response;
      const englishQuery = responseEnglish.text().trim();

      const englishResults = await cohereWebSearch(englishQuery);

      return { query: englishQuery, results: englishResults };
    } catch (error) {
      console.error("Error in summarizeForSearch:", error);
      return { query: query, results: null };
    }
  }

  async function isTimeQuery(query) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-001" });

    const prompt = `You are an AI assistant that determines if a query is asking about the CURRENT, STRICTLY CURRENT time or date. Respond with only "Yes" or "No".

  Is this query asking about the current time? Query: ${query}`;

    try {
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.9,
          topK: 1,
          topP: 1,
          maxOutputTokens: 2048,
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_NONE",
          },
        ],
      });
      const response = await result.response;
      const answer = response.text().trim().toLowerCase();
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

  async function handleImageAnalysis(client, m) {
    if (!m.message.imageMessage && (!m.quoted || !m.quoted.imageMessage)) {
      console.log("No image detected, skipping analysis");
      return;
    }

    try {
      isImageAnalysisInProgress = true;
      lastProcessedMessageId = m.key.id;
      console.log("Image detected, starting analysis...");
      const analysisMsg = await m.reply("Sedang Menganalisa....");

      let question, buffer;

      if (m.mtype === "imageMessage") {
        question = m.text?.slice(2).trim() || "Analyze this image";
        buffer = await downloadMediaMessage(m, 'buffer', {}, { 
          logger: console,
          reuploadRequest: client.updateMediaMessage
        });
      } else if (m.quoted && m.quoted.mtype === "imageMessage") {
        question = m.text?.slice(2).trim() || "Analyze this image";
        buffer = await downloadMediaMessage(m.quoted, 'buffer', {}, { 
          logger: console,
          reuploadRequest: client.updateMediaMessage
        });
      }

      if (!buffer) {
        throw new Error("Failed to download image");
      }

      console.log("Image downloaded, converting to base64...");
      const base64Image = buffer.toString('base64');

      console.log("Preparing request for Gemini API...");
      const parts = [
        { text: systemPrompt.content },
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: base64Image
          }
        },
        { text: question }
      ];

      console.log("Sending request to Gemini API...");
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-001" });
      const result = await model.generateContent({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.9,
          topK: 1,
          topP: 1,
          maxOutputTokens: 2048,
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_NONE",
          },
        ],
      });

      console.log("Received response from Gemini API");
      const response = await result.response;
      const aiResponse = response.text();

      // Delete the "Sedang Menganalisa...." message
      await client.sendMessage(m.chat, { delete: analysisMsg.key });

      // Send the final analysis
      await m.reply(aiResponse);

    } catch (error) {
      console.error("Error processing image message:", error);
      m.reply("Sorry, there was an error processing your image and question: " + error.message);
    } finally {
      isImageAnalysisInProgress = false;
    }
  }

  const debounce = (func, delay) => {
    let timeoutId;
    return (...args) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        func.apply(null, args);
      }, delay);
    };
  };

  const debouncedHandleImageAnalysis = debounce(handleImageAnalysis, 1000);

  async function translateToEnglish(text) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-001" });
    const prompt = `Translate the following text to English: "${text}"`;

    try {
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.9,
          topK: 1,
          topP: 1,
          maxOutputTokens: 2048,
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_NONE",
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_NONE",
          },
        ],
      });
      const response = await result.response;
      return response.text().trim();
    } catch (error) {
      console.error("Error translating to English:", error);
      return text; // Return original text if translation fails
    }
  }

  module.exports = sansekai = async (client, m, chatUpdate) => {
    try {
      var body = m.mtype === "conversation" ? m.message.conversation : m.mtype == "imageMessage" ? m.message.imageMessage.caption : m.mtype == "videoMessage" ? m.message.videoMessage.caption : m.mtype == "extendedTextMessage" ? m.message.extendedTextMessage.text : m.mtype == "buttonsResponseMessage" ? m.message.buttonsResponseMessage.selectedButtonId : m.mtype == "listResponseMessage" ? m.message.listResponseMessage.singleSelectReply.selectedRowId : m.mtype == "templateButtonReplyMessage" ? m.message.templateButtonReplyMessage.selectedId : m.mtype === "messageContextInfo" ? (m.message.buttonsResponseMessage?.selectedButtonId || m.message.listResponseMessage?.singleSelectReply.selectedRowId || m.text) : "";
      var budy = typeof m.text == "string" ? m.text : "";
      var prefix = /^[\\/!#.]/gi.test(body) ? body.match(/^[\\/!#.]/gi) : "/";
      const isCmd2 = body.startsWith(prefix);
      const command = body.replace(prefix, "").trim().split(/ +/).shift().toLowerCase();
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
      const groupMetadata = m.isGroup ? await client.groupMetadata(m.chat).catch((e) => {}) : "";
      const groupName = m.isGroup ? groupMetadata.subject : "";

      // Push Message To Console
      let argsLog = budy.length > 30 ? `${q.substring(0, 30)}...` : budy;

      if (isCmd2 && !m.isGroup) {
        console.log(chalk.black(chalk.bgWhite("[ LOGS ]")), color(argsLog, "turquoise"), chalk.magenta("From"), chalk.green(pushname), chalk.yellow(`[ ${m.sender.replace("@s.whatsapp.net", "")} ]`));
      } else if (isCmd2 && m.isGroup) {
        console.log(chalk.black(chalk.bgWhite("[ LOGS ]")), color(argsLog, "turquoise"), chalk.magenta("From"), chalk.green(pushname), chalk.yellow(`[ ${m.sender.replace("@s.whatsapp.net", "")} ]`), chalk.blueBright("IN"), chalk.green(groupName));
      }

      const hasImage = m.mtype === "imageMessage" || (m.quoted && m.quoted.mtype === "imageMessage");
      const isImageCommand = body.toLowerCase().startsWith("/a") && hasImage;

      // Unique identifier for this message
      const messageId = m.key.id;

      // If this message has already been processed, ignore it
      if (processedMessages.has(messageId)) {
        return;
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
                                *(Reset Context)*
                                Cmd: ${prefix}reset
                                Delete chat history with AI
                                *(Source Code Bot)*
                                Cmd: ${prefix}sc
                                Display the bot's source code`);
            break;

            case "a":
case "chat":
case "nanya":
case "ask":
  try {
    if (hasImage) {
      if (!processedMessages.has(messageId)) {
        processedMessages.add(messageId);
        await handleImageAnalysis(client, m);
      }
      return;
    }

    if (!text) return reply(`Chat with AI.\n\nExample:\n${prefix}${command} chat with me`);

    let chatId = m.chat;
    let isGroup = m.isGroup;
    let contextName = isGroup ? groupName : pushname || sender.split("@")[0];
    
    // Load or create context file
    let contextFile = getContextFile(chatId, isGroup, contextName);

    // Get current time and date
    const currentTimeAndDate = getCurrentTimeAndDate();

    // Prepare messages for the model
    let messages = [
      { role: "user", content: `${pushname}: ${q}` }
    ];

    try {
      // Check if web search is needed
      performWebSearch = await needsWebSearch(q, contextFile);
      console.log("Perform web search:", performWebSearch);
    
      if (performWebSearch) {
        console.log("Performing web search...");
        const searchingMsg = await m.reply("tunggu bentar ya, veo lagi nyari info di web... 🔍");
        const searchResult = await summarizeForSearch(q, messages);
        await client.sendMessage(m.chat, { delete: searchingMsg.key });
      
        if (searchResult.results && !searchResult.results.includes("NO RESULT")) {
          console.log("Web search results:", searchResult.results);
          aiResponse = await generateResponseFromWebSearch(searchResult.results, q, systemPrompt.content, pushname, contextFile);
        } else {
          console.log("No web search results found");
          aiResponse = await chatCompletionWithoutCache([
            { role: "user", content: `${pushname}: Maaf, veo ga nemu info yang kamu cari di web. Bisa tolong jelasin lagi atau tanya yang lain?` }
          ], systemPrompt.content, contextFile);
        }
      } else {
        aiResponse = await chatCompletionWithoutCache(messages, systemPrompt.content, contextFile);
      }

      console.log("Final AI Response:", aiResponse);
    } catch (aiError) {
      console.error("Error generating AI response:", aiError);
      aiResponse = `sorri niee, aku lagi bingung nih. Coba tanya lagi nanti ya? 😅`;
    }

    if (aiResponse) {
      await m.reply(aiResponse);

      // Add AI response to context file
      contextFile.push({ role: "user", content: `${pushname}: ${q}` });
      contextFile.push({ role: "assistant", content: aiResponse });

      // Save updated context
      saveContext(chatId, isGroup, contextName, contextFile);

      // Perform additional tasks asynchronously
      setImmediate(async () => {
        try {
          // Update memory
          await addMemory(chatId, pushname, q, aiResponse);
        } catch (error) {
          console.error("Error in asynchronous tasks:", error);
        }
      });
    } else {
      console.log("No AI response generated");
      await m.reply("Maaf, aku ga bisa jawab pertanyaan itu. 😕 Coba tanya yang lain deh!");
    }
  } catch (error) {
    console.error("Error in API request:", error);
    await m.reply("Oops, kayaknya ada error nih: " + error.message);
  }
  break;
  
          case "g":
          case "ai-img":
          case "img":
          case "gambar":
          case "draw":
          case "buat":
            try {
              if (!text) return reply(`Create an image from AI.\n\nExample:\n${prefix}${command} Wooden house on snow mountain`);
              
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
                m.reply("Sorry, there seems to be an error with the response format.");
              }
            } catch (error) {
              console.log(error);
              m.reply("Sorry, there seems to be an error: " + error.message);
            }
            break;

          case "reset":
            try {
              let chatId = m.chat;
              let isGroup = m.isGroup;
              let contextName = isGroup
                ? groupName
                : pushname || sender.split("@")[0];
          
              // Reset context file
              let contextFile = [systemPrompt];
              saveContext(chatId, isGroup, contextName, contextFile);
          
              // Reset memory for this chat
              if (memoryData[chatId]) {
                delete memoryData[chatId];
                saveMemory();
              }
          
              m.reply("AI chat memory and context have been reset.");
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
                console.log(chalk.black(chalk.bgRed("[ ERROR ]")), color("command", "turquoise"), color(`${prefix}${command}`, "turquoise"), color("is not available", "turquoise"));
              } else if (argsLog || (isCmd2 && m.isGroup)) {
                console.log(chalk.black(chalk.bgRed("[ ERROR ]")), color("command", "turquoise"), color(`${prefix}${command}`, "turquoise"), color("is not available", "turquoise"));
              }
            }
          }
        }
      } else if (hasImage && !isImageCommand) {
        // Handle image messages without /a prefix
        processedMessages.add(messageId);
        setTimeout(() => processedMessages.delete(messageId), 30000); // Remove from set after 30 seconds
        await handleImageAnalysis(client, m);
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

  setInterval(() => {
    const now = Date.now();
    for (const id of processedMessages) {
      if (now - id > 60000) { // Remove after 1 minute
        processedMessages.delete(id);
      }
    }
  }, 60000);

  // Export the main function
  module.exports = sansekai;
