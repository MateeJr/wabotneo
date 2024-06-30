const { BufferJSON, WA_DEFAULT_EPHEMERAL, generateWAMessageFromContent, proto, generateWAMessageContent, generateWAMessage, prepareWAMessageMedia, areJidsSameUser, getContentType } = require("@whiskeysockets/baileys");
const fs = require("fs");
const util = require("util");
const chalk = require("chalk");
const axios = require("axios");
const path = require("path");
const { fetch } = require('undici');

let setting = require("./key.json");

function loadOrCreateJSON(filePath, defaultContent = {}) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } else {
      fs.writeFileSync(filePath, JSON.stringify(defaultContent), 'utf8');
      return defaultContent;
    }
  } catch (error) {
    console.log(`Error loading or creating ${filePath}:`, error);
    return defaultContent;
  }
}

let systemPrompt;
try {
  systemPrompt = { role: 'system', content: fs.readFileSync('./system.txt', 'utf8') };
} catch (error) {
  console.log("Error reading system prompt:", error);
  systemPrompt = { role: 'system', content: "Sorry, system prompt failed to load. Please check system.txt file." };
}

let memoryData = loadOrCreateJSON('./memory.json');

function saveMemory() {
  fs.writeFileSync('./memory.json', JSON.stringify(memoryData, null, 2), 'utf8');
}

async function getLLMSummaryAndCheck(chatId, userName, userMessage, aiResponse, previousMemory) {
  const url = 'https://api.unify.ai/v0/chat/completions';
  const headers = {
    'Authorization': 'Bearer oof38keeZm1boOsb3NOnuTux04LVwWjAzKGhtJkSwzE=',
    'Content-Type': 'application/json'
  };
  const payload = {
    model: "claude-3.5-sonnet@anthropic",
    messages: [
      { role: 'system', content: 'You are an AI assistant that summarizes user messages and AI responses concisely in Bahasa Indonesia. If there is nothing important to summarize or the message is unnecessary, respond with "empty". If the user is correcting previous information, update the memory accordingly. Respond in the following format:\n\nsummary: [your summary here]\ncorrection: [old info]|[new info] or null if no correction.... MEMORY ONLY ALLOWED LIKE : HOBBY, LIKES, DISLIKES, NEW INFORMATION, DISINTEREST, INTEREST, PERSONALITY, USER TOLD TO MEMORIZE, CHARACTERS, VERY IMPORTANT MEMORY.. EXCEPT THIS MUST ANSWER empty ... MEMORY ABOUT WHAT AND HOW AI ASSISTANT RESPOND MUST BE empty... strictly avoid write memories beside that! CONCLUSION IS IF IT DOESNT CONTAIN ANY NEW INFORMATION ABOUT HOBBY, LIKES, DISLIKES, NEW INFORMATION, DISINTEREST, INTEREST, PERSONALITY, USER TOLD TO MEMORIZE, CHARACTERS, VERY IMPORTANT MEMORY.. THEN IT MUST BE empty.... INFORMATION ABOUT WHAT USER ASKING, WANT TO KNOW, ETC MUST be empty TOO! BECAUSE IT DOESNT CONTAINS ANY SPECIFIC MEMORIES' },
      { role: 'user', content: `Previous memory: ${previousMemory}\n\nUser message: ${userMessage}\n\nAI response: ${aiResponse}` }
    ]
  };

  try {
    const response = await axios.post(url, payload, { headers });
    const content = response.data.choices[0].message.content;
    
    let summary = '';
    let correction = null;

    const lines = content.split('\n');
    for (const line of lines) {
      if (line.toLowerCase().startsWith('summary:')) {
        summary = line.split(':').slice(1).join(':').trim();
      } else if (line.toLowerCase().startsWith('correction:')) {
        const correctionPart = line.split(':').slice(1).join(':').trim();
        if (correctionPart && correctionPart.toLowerCase() !== 'null') {
          const [old, newInfo] = correctionPart.split('|');
          correction = { old: old.trim(), new: newInfo ? newInfo.trim() : '' };
        }
      }
    }

    return { summary, correction };
  } catch (error) {
    console.error('Error:', error.response ? error.response.data : error.message);
    return { summary: '', correction: null };
  }
}

function addMemory(chatId, userName, userMessage, aiResponse) {
  setImmediate(async () => {
    try {
      if (!memoryData[chatId]) {
        memoryData[chatId] = [];
      }
      
      const previousMemory = memoryData[chatId].map(mem => `${mem.user}: ${mem.memory}`).join('\n');
      const result = await getLLMSummaryAndCheck(chatId, userName, userMessage, aiResponse, previousMemory);
      
      if (result.summary && result.summary !== 'empty') {
        memoryData[chatId].push({
          user: userName,
          memory: result.summary,
          timestamp: new Date().toISOString()
        });
      }
      
      if (result.correction && result.correction.old && result.correction.new) {
        const index = memoryData[chatId].findIndex(mem => mem.memory.includes(result.correction.old));
        if (index !== -1) {
          memoryData[chatId][index].memory = memoryData[chatId][index].memory.replace(result.correction.old, result.correction.new);
          memoryData[chatId][index].timestamp = new Date().toISOString();
        }
      }
      
      memoryData[chatId].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      saveMemory();
    } catch (error) {
      console.error('Error processing memory:', error);
    }
  });
}

function getContextFile(chatId, isGroup, name) {
  const fileName = isGroup ? `contextgroup-${name}.json` : `context-${name}.json`;
  const filePath = path.join(__dirname, fileName);
  return loadOrCreateJSON(filePath, [systemPrompt]);
}

function saveContext(chatId, isGroup, name, context) {
  const fileName = isGroup ? `contextgroup-${name}.json` : `context-${name}.json`;
  const filePath = path.join(__dirname, fileName);
  fs.writeFileSync(filePath, JSON.stringify(context, null, 2), 'utf8');
}

function updateContextWithLatestMemory(chatId, isGroup, name) {
  const contextFile = getContextFile(chatId, isGroup, name);
  
  const filteredContext = contextFile.filter(item => !item.content.startsWith('Previous conversation memory:'));
  
  const latestMemory = memoryData[chatId] ? memoryData[chatId].map(mem => `${mem.user}: ${mem.memory}`).join('\n') : '';
  
  const lastUserIndex = filteredContext.map(item => item.role).lastIndexOf('user');
  if (lastUserIndex !== -1) {
    filteredContext.splice(lastUserIndex, 0, { role: 'system', content: `Previous conversation memory:\n${latestMemory}` });
  } else {
    filteredContext.push({ role: 'system', content: `Previous conversation memory:\n${latestMemory}` });
  }
  
  saveContext(chatId, isGroup, name, filteredContext);
}

async function chatCompletion(model, messages) {
  const url = 'https://api.unify.ai/v0/chat/completions';
  const headers = {
    'Authorization': 'Bearer oof38keeZm1boOsb3NOnuTux04LVwWjAzKGhtJkSwzE=',
    'Content-Type': 'application/json'
  };
  const payload = {
    model: model,
    temperature: 1,
    messages: messages
  };

  try {
    const response = await axios.post(url, payload, { headers });
    return response.data;
  } catch (error) {
    console.error('Error:', error.response ? error.response.data : error.message);
    throw error;
  }
}

async function translateToEnglish(text) {
  const url = 'https://api.unify.ai/v0/chat/completions';
  const headers = {
    'Authorization': 'Bearer npXMFXNsdNBJ8OiVpp5DM2YS8z07m-4GsTQOzOqIhBY=',
    'Content-Type': 'application/json'
  };
  const payload = {
    model: "claude-3.5-sonnet@anthropic",
    messages: [
      { role: 'system', content: 'You are a translator. Translate the following text to English.' },
      { role: 'user', content: text }
    ]
  };

  try {
    const response = await axios.post(url, payload, { headers });
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('Translation Error:', error.response ? error.response.data : error.message);
    throw error;
  }
}

async function googleSearch(query) {
  const apiKey = 'AIzaSyBG0oHHa31C5gHmYskfWtfGrhGqNKoTy_0';
  const searchEngineId = '3542706eecde94f0b';
  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}`;

  try {
    const response = await axios.get(url);
    return response.data.items.map(item => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet
    }));
  } catch (error) {
    console.error('Error during Google search:', error);
    return [];
  }
}

async function fetchWebContent(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    const html = await response.text();
    const bodyContent = html.match(/<body.*?>([\s\S]*)<\/body>/i);
    return bodyContent ? bodyContent[1].replace(/<.*?>/g, '') : '';
  } catch (error) {
    console.error('Error fetching web content:', error);
    return '';
  }
}

async function needsWebSearch(query, context = []) {
  const url = 'https://api.unify.ai/v0/chat/completions';
  const headers = {
    'Authorization': 'Bearer oof38keeZm1boOsb3NOnuTux04LVwWjAzKGhtJkSwzE=',
    'Content-Type': 'application/json'
  };

  // Get up to the last 5 messages from the context, handling cases with fewer messages
  const lastMessages = context.slice(-5);
  const recentContext = lastMessages.map(msg => `${msg.role}: ${msg.content}`).join('\n');

  const payload = {
    model: "claude-3.5-sonnet@anthropic",
    messages: [
      { role: 'system', content: 'You are an AI assistant that determines if a web search is needed to answer a query. If the query answer is available in the system prompt or recent context, then do not use real-time search except if the user explicitly asks for it. Use very low-mid sensitivity to detect web search needs. Respond with only "Yes" or "No".' },
      { role: 'user', content: `Does this query really require a web search for up-to-date or real-time information? ${recentContext ? `Here's the recent context:\n\n${recentContext}\n\n` : ''}Query: ${query}` }
    ]
  };

  try {
    const response = await axios.post(url, payload, { headers });
    const answer = response.data.choices[0].message.content.trim().toLowerCase();
    return answer === 'yes';
  } catch (error) {
    console.error('Error in needsWebSearch:', error);
    return false;
  }
}

async function summarizeSearchResults(results, query) {
  const url = 'https://api.unify.ai/v0/chat/completions';
  const headers = {
    'Authorization': 'Bearer oof38keeZm1boOsb3NOnuTux04LVwWjAzKGhtJkSwzE=',
    'Content-Type': 'application/json'
  };
  const payload = {
    model: "claude-3.5-sonnet@anthropic",
    messages: [
      { role: 'system', content: 'You are an AI assistant that summarizes search results concisely and relevantly.' },
      { role: 'user', content: `Summarize the following search results in relation to the query: "${query}"\n\n${results}` }
    ]
  };

  try {
    const response = await axios.post(url, payload, { headers });
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('Error summarizing search results:', error);
    return '';
  }
}

module.exports = sansekai = async (client, m, chatUpdate) => {
  try {
    var body = m.mtype === "conversation" ? m.message.conversation : m.mtype == "imageMessage" ? m.message.imageMessage.caption : m.mtype == "videoMessage" ? m.message.videoMessage.caption : m.mtype == "extendedTextMessage" ? m.message.extendedTextMessage.text : m.mtype == "buttonsResponseMessage" ? m.message.buttonsResponseMessage.selectedButtonId : m.mtype == "listResponseMessage" ? m.message.listResponseMessage.singleSelectReply.selectedRowId : m.mtype == "templateButtonReplyMessage" ? m.message.templateButtonReplyMessage.selectedId : m.mtype === "messageContextInfo" ? (m.message.buttonsResponseMessage?.selectedButtonId || m.message.listResponseMessage?.singleSelectReply.selectedRowId || m.text) : "";
    var budy = (typeof m.text == "string" ? m.text : "");
    var prefix = /^[\\/!#.]/gi.test(body) ? body.match(/^[\\/!#.]/gi) : "/";
    const isCmd2 = body.startsWith(prefix);
    const command = body.replace(prefix, "").trim().split(/ +/).shift().toLowerCase();
    const args = body.trim().split(/ +/).slice(1);
    const pushname = m.pushName || "No Name";
    const botNumber = await client.decodeJid(client.user.id);
    const itsMe = m.sender == botNumber ? true : false;
    let text = q = args.join(" ");
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

    if (isCmd2) {
      switch (command) {
        case "help": case "menu": case "start": case "info":
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
Display the bot's source code`)
          break;
          case "a": case "chat": case "nanya": case "ask":
  try {
    if (!text) return reply(`Chat with AI.\n\nExample:\n${prefix}${command} chat with me`);

    let chatId = m.chat;
    let isGroup = m.isGroup;
    let contextName = isGroup ? groupName : (pushname || sender.split('@')[0]);
    let currentContext = getContextFile(chatId, isGroup, contextName);

    // Store the user's latest input
    const userLatestInput = `${pushname}: ${q}`;

    // Check if web search is needed
    const needsSearch = await needsWebSearch(q);
    let searchResults = '';

    if (needsSearch) {
      m.reply("Searching...");
      const results = await googleSearch(q);
      for (const result of results.slice(0, 5)) {
        const content = await fetchWebContent(result.link);
        searchResults += `${result.title}\n${content}\n\n`;
        if (searchResults.length > 10000) break;
      }
      
      if (searchResults) {
        searchResults = await summarizeSearchResults(searchResults, q);
      }
    }

    // Insert web search results if available
    if (searchResults) {
      currentContext.push({ role: 'system', content: `Relevant web search information: ${searchResults}` });
    }

    // Add user's latest input after the web search results
    currentContext.push({ role: 'user', content: userLatestInput });

    console.log("Context sent to API:", currentContext);

    const response = await chatCompletion("claude-3.5-sonnet@anthropic", currentContext);
    console.log("API response:", response);

    if (response.choices && response.choices.length > 0 && response.choices[0].message) {
      const aiResponse = response.choices[0].message.content;
      console.log("AI response content:", aiResponse);
      
      // Send response to WhatsApp user
      await m.reply(aiResponse);
      
      // Add AI response to context
      currentContext.push({ role: 'assistant', content: aiResponse });
      
      // Remove web search results from context to save memory
      currentContext = currentContext.filter(msg => !msg.content.startsWith('Relevant web search information:'));
      
      // Trim context if it's too long
      const totalTokens = currentContext.reduce((acc, message) => acc + message.content.length / 4, 0);
      while (totalTokens > 200000) {
        currentContext.splice(1, 2);
      }
      
      // Save updated context
      saveContext(chatId, isGroup, contextName, currentContext);
      
      // Update memory
      addMemory(chatId, pushname, q, aiResponse);
      
      // Update context with latest memory
      updateContextWithLatestMemory(chatId, isGroup, contextName);
    } else {
      console.log("Unexpected API response structure:", response);
      m.reply("Sorry, I couldn't generate a proper response.");
    }

  } catch (error) {
    console.log(error);
    m.reply("Oops, looks like there's an error: " + error.message);
  }
  break;
        case "g": case "ai-img": case "img": case "gambar": case "draw": case "buat":
          try {
            if (!text) return reply(`Create image from AI.\n\nExample:\n${prefix}${command} Wooden house on snow mountain`);

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
        case "unify":
          try {
            if (!text) return reply(`Chat with Unify AI.\n\nExample:\n${prefix}${command} What is a recession`);

            let chatId = m.chat;
            let isGroup = m.isGroup;
            let contextName = isGroup ? groupName : (pushname || sender.split('@')[0]);
            let currentContext = getContextFile(chatId, isGroup, contextName);

            // Check if web search is needed
            const needsSearch = await needsWebSearch(q);
            let searchResults = '';

            if (needsSearch) {
              m.reply("Searching...");
              const results = await googleSearch(q);
              for (const result of results.slice(0, 5)) {
                const content = await fetchWebContent(result.link);
                searchResults += `${result.title}\n${content}\n\n`;
                if (searchResults.length > 10000) break;
              }
                
              if (searchResults) {
                searchResults = await summarizeSearchResults(searchResults, q);
              }
            }

            // Insert web search results just before the user's question
            if (searchResults) {
              currentContext.push({ role: 'system', content: `Relevant web search information: ${searchResults}` });
            }

            // Add user message to context
            currentContext.push({ role: 'user', content: `${pushname}: ${q}` });

            const response = await chatCompletion("claude-3.5-sonnet@anthropic", currentContext);
            const aiResponse = response.choices[0].message.content;

            // Send response to WhatsApp user
            await m.reply(aiResponse);

            // Add AI response to context
            currentContext.push({ role: 'assistant', content: aiResponse });

            // Remove web search results from context to save memory
            currentContext = currentContext.filter(msg => !msg.content.startsWith('Relevant web search information:'));

            // Trim context if it's too long
            const totalTokens = currentContext.reduce((acc, message) => acc + message.content.length / 4, 0);
            while (totalTokens > 200000) {
              currentContext.splice(1, 2);
            }

            // Save updated context
            saveContext(chatId, isGroup, contextName, currentContext);
            
            // Update memory
            addMemory(chatId, pushname, q, aiResponse);

            // Update context with latest memory
            updateContextWithLatestMemory(chatId, isGroup, contextName);

          } catch (error) {
            console.log(error);
            m.reply("Sorry, there seems to be an error: " + error.message);
          }
          break;
        case "adminreset":
          try {
            let chatId = m.chat;
            let isGroup = m.isGroup;
            let contextName = isGroup ? groupName : (pushname || sender.split('@')[0]);
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
              m.reply("There's no AI chat memory or context that needs to be reset.");
            }
          } catch (error) {
            console.log(error);
            m.reply("Sorry, an error occurred while resetting AI memory and context: " + error.message);
          }
          break;
        case "dev": case "tentang": case "about":
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