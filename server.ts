import express from 'express';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';
import crypto from 'crypto';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EDGE_API_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const EDGE_VERSION = "1-143.0.3650.75";
const WINDOWS_FILE_TIME_EPOCH = BigInt("11644473600");

function generateSecMsGecToken(): string {
  const seconds = BigInt(Math.floor(Date.now() / 1000 + Number(WINDOWS_FILE_TIME_EPOCH)));
  const ticks = seconds * BigInt("10000000");
  const baseVal = ticks - ticks % BigInt("3000000000");
  const strToHash = baseVal.toString() + EDGE_API_TOKEN;
  
  const hash = crypto.createHash('sha256').update(strToHash).digest('hex');
  return hash.toUpperCase();
}

class ConcurrencyPool {
  private activeCount = 0;
  private queue: (() => void)[] = [];
  
  constructor(private maxConcurrency: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const execute = () => {
        this.activeCount++;
        fn()
          .then(resolve)
          .catch(reject)
          .finally(() => {
            this.activeCount--;
            const next = this.queue.shift();
            if (next) {
              next();
            }
          });
      };

      if (this.activeCount < this.maxConcurrency) {
        execute();
      } else {
        this.queue.push(execute);
      }
    });
  }
}

// Global throttle limits: max 128 concurrent active Edge TTS WebSocket connections and max 64 for Google Translate across all requests!
const globalEdgeTtsPool = new ConcurrencyPool(128);
const globalGoogleTtsPool = new ConcurrencyPool(64);

// LRU In-memory audio cache to make repeat translations instant and save bandwidth
const AUDIO_CACHE = new Map<string, { audio: string; mimeType: string; isLocal?: boolean; warning?: string }>();
const MAX_CACHE_SIZE = 2000;

function getCacheKey(text: string, voice: string, language: string, engine: string): string {
  const hash = crypto.createHash('sha256').update(`${text}_${voice}_${language}_${engine}`).digest('hex');
  return hash;
}

function cacheAudio(key: string, result: { audio: string; mimeType: string; isLocal?: boolean; warning?: string }) {
  if (AUDIO_CACHE.size >= MAX_CACHE_SIZE) {
    const oldestKey = AUDIO_CACHE.keys().next().value;
    if (oldestKey !== undefined) {
      AUDIO_CACHE.delete(oldestKey);
    }
  }
  AUDIO_CACHE.set(key, result);
}

// Chunk-level cache to make repeated sentences/chunks instant and save API rate limits / bandwidth
const CHUNK_CACHE = new Map<string, Buffer>();
const MAX_CHUNK_CACHE_SIZE = 10000;

function getChunkCacheKey(text: string, voice: string, pitch: string, rate: string, engine: string): string {
  const hash = crypto.createHash('sha256').update(`${text}_${voice}_${pitch}_${rate}_${engine}`).digest('hex');
  return hash;
}

function cacheChunk(key: string, buffer: Buffer) {
  if (CHUNK_CACHE.size >= MAX_CHUNK_CACHE_SIZE) {
    const oldestKey = CHUNK_CACHE.keys().next().value;
    if (oldestKey !== undefined) {
      CHUNK_CACHE.delete(oldestKey);
    }
  }
  CHUNK_CACHE.set(key, buffer);
}

function getGeminiVoice(voice: string): string {
  const supported = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Zephyr'];
  if (supported.includes(voice)) {
    return voice;
  }
  switch (voice) {
    case 'Kavya': return 'Aoede';
    case 'Nisha': return 'Aoede';
    case 'Ananya': return 'Kore';
    case 'Aarav': return 'Zephyr';
    case 'Rohan': return 'Fenrir';
    case 'Chiku': return 'Puck';
    default: return 'Puck';
  }
}

// Highly resilient backoff-retry helper to handle rate limits (429) and network hiccups (timeout/close)
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 3,
  delay = 1000,
  backoffFactor = 2
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const errStr = String(error?.message || error || '');
    const isRateLimit = errStr.includes('429') || error?.status === 429 || JSON.stringify(error).includes('429');
    const isNetworkError = errStr.includes('WebSocket') || errStr.includes('timeout') || errStr.includes('fetch') || errStr.includes('closed');
    
    if (retries > 0 && (isRateLimit || isNetworkError)) {
      console.warn(`[Retry Warning] Hit recoverable error: ${errStr.substring(0, 80)}. Retrying in ${delay}ms... (${retries} retries left)`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return retryWithBackoff(fn, retries - 1, delay * backoffFactor, backoffFactor);
    }
    throw error;
  }
}

function customEdgeTts(text: string, options: { voice: string; pitch: string; rate: string }): Promise<Buffer> {
  const { voice = 'en-GB-SoniaNeural', pitch = '+0%', rate = '+0%' } = options;

  return globalEdgeTtsPool.run(() => {
    return new Promise<Buffer>((resolve, reject) => {
      const connectionId = crypto.randomUUID().replaceAll('-', '');
      const secMsGec = generateSecMsGecToken();
      const fullUrl = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${EDGE_API_TOKEN}&ConnectionId=${connectionId}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${EDGE_VERSION}`;

      let isFinished = false;
      const audioData: Buffer[] = [];

      const ws = new WebSocket(fullUrl, {
        host: 'speech.platform.bing.com',
        origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br, zstd'
        }
      });

      // Dynamic safety timeout: terminate and fail-fast if synthesis gets stuck
      // Base timeout of 25 seconds + 40ms per character (up to 75 seconds max) to allow long speech streaming to finish safely
      const calculatedTimeout = Math.max(25000, Math.min(75000, text.length * 40));
      const timeoutTimer = setTimeout(() => {
        if (!isFinished) {
          isFinished = true;
          try {
            ws.terminate(); // Forcefully close immediately to prevent leak
          } catch (e) {}
          reject(new Error(`WebSocket synthesis timed out after ${Math.round(calculatedTimeout / 1000)} seconds`));
        }
      }, calculatedTimeout);

      ws.on('message', (rawData, isBinary) => {
        if (!isBinary) {
          const data = rawData.toString('utf8');
          if (data.includes('turn.end')) {
            isFinished = true;
            clearTimeout(timeoutTimer);
            resolve(Buffer.concat(audioData));
            try {
              ws.close();
            } catch (e) {}
          }
          return;
        }
        const data = rawData as Buffer;
        const separator = 'Path:audio\r\n';
        const separatorIndex = data.indexOf(separator);
        if (separatorIndex !== -1) {
          const content = data.subarray(separatorIndex + separator.length);
          audioData.push(content);
        }
      });

      ws.on('error', (err) => {
        if (!isFinished) {
          isFinished = true;
          clearTimeout(timeoutTimer);
          reject(err);
        }
      });

      ws.on('close', (code, reason) => {
        if (!isFinished) {
          isFinished = true;
          clearTimeout(timeoutTimer);
          if (audioData.length > 0) {
            resolve(Buffer.concat(audioData));
          } else {
            reject(new Error(`WebSocket closed before finishing. Code: ${code}, Reason: ${reason.toString()}`));
          }
        }
      });

      const speechConfig = JSON.stringify({
        context: {
          synthesis: {
            audio: {
              metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
              outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
            }
          }
        }
      });

      const configMessage = `X-Timestamp:${Date()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${speechConfig}`;

      ws.on('open', () => {
        ws.send(configMessage, { compress: true }, (configError) => {
          if (configError) {
            if (!isFinished) {
              isFinished = true;
              clearTimeout(timeoutTimer);
              reject(configError);
              try { ws.close(); } catch (e) {}
            }
            return;
          }

          const requestId = crypto.randomUUID().replaceAll('-', '');
          const ssmlMessage = `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\n`
            + `X-Timestamp:${Date()}Z\r\nPath:ssml\r\n\r\n`
            + `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>`
            + `<voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='+0%'>`
            + `${text}</prosody></voice></speak>`;

          ws.send(ssmlMessage, { compress: true }, (ssmlError) => {
            if (ssmlError && !isFinished) {
              isFinished = true;
              clearTimeout(timeoutTimer);
              reject(ssmlError);
              try { ws.close(); } catch (e) {}
            }
          });
        });
      });
    });
  });
}

// Helper function to add WAV header to raw PCM (linear16) data
function addWavHeader(pcmBuffer: Buffer, sampleRate: number = 24000): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const subChunk2Size = pcmBuffer.length;
  const chunkSize = 36 + subChunk2Size;

  const header = Buffer.alloc(44);

  header.write('RIFF', 0); // ChunkID
  header.writeUInt32LE(chunkSize, 4); // ChunkSize
  header.write('WAVE', 8); // Format
  header.write('fmt ', 12); // Subchunk1ID
  header.writeUInt32LE(16, 16); // Subchunk1Size
  header.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  header.writeUInt16LE(numChannels, 22); // NumChannels (1 for Mono)
  header.writeUInt32LE(sampleRate, 24); // SampleRate
  header.writeUInt32LE(byteRate, 28); // ByteRate
  header.writeUInt16LE(blockAlign, 32); // BlockAlign
  header.writeUInt16LE(bitsPerSample, 34); // BitsPerSample
  header.write('data', 36); // Subchunk2ID
  header.writeUInt32LE(subChunk2Size, 40); // Subchunk2Size

  return Buffer.concat([header, pcmBuffer]);
}

function splitTextIntoChunks(text: string, maxChunkLength: number = 1500): string[] {
  const sentences = text.match(/[^।\.!\?\n]+[।\.!\?\n]*/g) || [text];
  const chunks: string[] = [];
  let currentChunk = "";
  
  for (const sentence of sentences) {
    if (sentence.length > maxChunkLength) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = "";
      }
      const parts = sentence.split(/([,，\s]+)/);
      for (const part of parts) {
        if ((currentChunk + part).length > maxChunkLength) {
          if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
          }
          currentChunk = part;
        } else {
          currentChunk += part;
        }
      }
    } else {
      if ((currentChunk + sentence).length > maxChunkLength) {
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = sentence;
      } else {
        currentChunk += sentence;
      }
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  return chunks;
}

async function pLimit<T>(items: any[], limit: number, fn: (item: any) => Promise<T>): Promise<T[]> {
  const results: T[] = new Array(items.length);
  let index = 0;
  
  async function worker() {
    while (index < items.length) {
      const currentIdx = index++;
      results[currentIdx] = await fn(items[currentIdx]);
    }
  }
  
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

const app = express();
const port = 3000;

app.use(express.json());

// API route for Song / Music Generation
app.post('/api/generate-song', async (req, res) => {
  try {
    const { prompt, style, duration, language } = req.body;
    
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'कृपया गाने का विषय या प्रॉम्प्ट दर्ज करें (Please enter a song prompt)' });
    }

    const cleanPrompt = prompt.trim();
    const songStyle = style || 'dance';
    const lang = language || 'hi';
    const songDuration = duration || 'medium'; // short, medium, long

    console.log(`Generating song lyrics for style: ${songStyle}, prompt: "${cleanPrompt.substring(0, 40)}..."`);

    // In case API key is missing, return a high-quality preset song immediately so the app doesn't fail
    if (!process.env.GEMINI_API_KEY) {
      console.log('Gemini API key is missing. Returning a highly stylized local preset song...');
      const fallbackSongs: Record<string, any> = {
        hi: {
          title: songStyle === 'dance' ? 'चलो नाचो यार' : songStyle === 'motivational' ? 'जीत की उड़ान' : songStyle === 'sad' ? 'अधूरी दास्तां' : 'खुशियों का सफर',
          vibeDescription: `एक खूबसूरत ${songStyle} गीत जो आपके प्रॉम्प्ट के अनुसार है! (Local Preset)`,
          lyricsSections: [
            { type: 'Intro / संगीत', text: 'धूम-ता-ना-ना, धूम-ता-ना-ना, ये धुन सुनो!' },
            { type: 'Verse 1 / अंतरा 1', text: songStyle === 'dance' ? 'पैरों में है मस्ती, दिल में है तरंग, आज की रात नाचेंगे सबके संग!' : songStyle === 'motivational' ? 'राहें कठिन हैं, पर हौसला बुलंद है, मंज़िल को पा लेंगे, यही दिल की उमंग है!' : songStyle === 'sad' ? 'दिल के कोने में छुपा है कोई गम, यादों के साए में आँखें हैं नम।' : 'सुबह की किरणें लाई हैं नई आस, हर पल है सुंदर, हर पल है खास!' },
            { type: 'Chorus / स्थाई', text: songStyle === 'dance' ? 'चलो नाचो यार, झूम उठो यार, गमों को भूलकर करो प्यार!' : songStyle === 'motivational' ? 'हम जीतेंगे हर बाज़ी, डरने की क्या बात है! जब खुद पर हो भरोसा, तो हर मंज़िल अपने साथ है!' : songStyle === 'sad' ? 'अधूरी है दास्तां, खो गया कारवां, अब कहाँ जाएँ हम, रूठा है आसमान।' : 'मुस्कुराओ सदा, खिलखिलाओ सदा, इस खूबसूरत जीवन का आनंद उठाओ सदा!' },
            { type: 'Verse 2 / अंतरा 2', text: songStyle === 'dance' ? 'संगीत की लहरों पर बहता चला जाए मन, थिरकते कदमों से गूंज उठे सारा चमन!' : songStyle === 'motivational' ? 'तूफान आएँ तो भी कदम न रुकने पाएँ, मेहनत की स्याही से इतिहास लिख जाएँ!' : songStyle === 'sad' ? 'कहने को तो बहुत कुछ था पर हम खामोश रहे, आंसुओं के समंदर में हम अकेले बहते रहे।' : 'प्यारे दोस्तों संग झूमेंगे और गाएंगे, हर लम्हे को यादगार बनाते जाएंगे!' },
            { type: 'Chorus / स्थाई', text: songStyle === 'dance' ? 'चलो नाचो यार, झूम उठो यार, गमों को भूलकर करो प्यार!' : songStyle === 'motivational' ? 'हम जीतेंगे हर बाज़ी, डरने की क्या बात है! जब खुद पर हो भरोसा, तो हर मंज़िल अपने साथ है!' : songStyle === 'sad' ? 'अधूरी है दास्तां, खो गया कारवां, अब कहाँ जाएँ हम, रूठा है आसमान।' : 'मुस्कुराओ सदा, खिलखिलाओ सदा, इस खूबसूरत जीवन का आनंद उठाओ सदा!' },
            { type: 'Outro / समाप्ति', text: 'धुन मद्धम होती है... और गीत यहाँ समाप्त होता है!' }
          ],
          vocalsText: songStyle === 'dance' 
            ? 'धूम-ता-ना-ना, धूम-ता-ना-ना, ये धुन सुनो! पैरों में है मस्ती, दिल में है तरंग, आज की रात नाचेंगे सबके संग! चलो नाचो यार, झूम उठो यार, गमों को भूलकर करो प्यार! संगीत की लहरों पर बहता चला जाए मन, थिरकते कदमों से गूंज उठे सारा चमन! चलो नाचो यार, झूम उठो यार, गमों को भूलकर करो प्यार! धुन मद्धम होती है और गीत समाप्त होता है!'
            : songStyle === 'motivational'
            ? 'राहें कठिन हैं, पर हौसला बुलंद है, मंज़िल को पा लेंगे, यही दिल की उमंग है! हम जीतेंगे हर बाज़ी, डरने की क्या बात है! जब खुद पर हो भरोसा, तो हर मंज़िल अपने साथ है! तूफान आएँ तो भी कदम न रुकने पाएँ, मेहनत की स्याही से इतिहास लिख जाएँ! हम जीतेंगे हर बाज़ी, डरने की क्या बात है! जब खुद पर हो भरोसा, तो हर मंज़िल अपने साथ है!'
            : songStyle === 'sad'
            ? 'दिल के कोने में छुपा है कोई गम, यादों के साए में आँखें हैं नम। अधूरी है दास्तां, खो गया कारवां, अब कहाँ जाएँ हम, रूठा है आसमान। कहने को तो बहुत कुछ था पर हम खामोश रहे, आंसुओं के समंदर में हम अकेले बहते रहे। अधूरी है दास्तां, खो गया कारवां।'
            : 'सुबह की किरणें लाई हैं नई आस, हर पल है सुंदर, हर पल है खास! मुस्कुराओ सदा, खिलखिलाओ सदा, इस खूबसूरत जीवन का आनंद उठाओ सदा! प्यारे दोस्तों संग झूमेंगे और गाएंगे, हर लम्हे को यादगार बनाते जाएंगे! मुस्कुराओ सदा, खिलखिलाओ सदा, इस खूबसूरत जीवन का आनंद उठाओ सदा!'
        },
        en: {
          title: songStyle === 'dance' ? 'Feel the Beat' : songStyle === 'motivational' ? 'Rise Above' : songStyle === 'sad' ? 'Whispers of Rain' : 'Sunny Side Up',
          vibeDescription: `A high-quality ${songStyle} song based on your theme! (Local Preset)`,
          lyricsSections: [
            { type: 'Intro', text: 'Yeah, listen to the rhythm, let it take control!' },
            { type: 'Verse 1', text: songStyle === 'dance' ? 'Lights are flashing bright, we own the floor tonight, everything feels so right!' : songStyle === 'motivational' ? 'The road is long and steep, but promises we keep, we will fly high and deep!' : songStyle === 'sad' ? 'Walking alone in the cold, a story left untold, memories we used to hold.' : 'Sunlight in my eyes, a beautiful surprise, watch the spirits rise!' },
            { type: 'Chorus', text: songStyle === 'dance' ? 'Feel the beat, move your feet, let the music sweep you off your seat!' : songStyle === 'motivational' ? 'We will rise above, driven by our goals, with fire in our souls!' : songStyle === 'sad' ? 'Tears fall like the rain, washing away the pain, nothing stays the same.' : 'Smile all day, dance and play, let the good times roll today!' },
            { type: 'Verse 2', text: songStyle === 'dance' ? 'Bass is pumping loud, dancing in the crowd, floating on a happy cloud!' : songStyle === 'motivational' ? 'Storms will come and go, but the inner strength will grow, let your power show!' : songStyle === 'sad' ? 'Silent empty halls, shadows on the walls, as the night falls.' : 'Friends are by my side, with nothing left to hide, enjoying this sweet ride!' },
            { type: 'Chorus', text: songStyle === 'dance' ? 'Feel the beat, move your feet, let the music sweep you off your seat!' : songStyle === 'motivational' ? 'We will rise above, driven by our goals, with fire in our souls!' : songStyle === 'sad' ? 'Tears fall like the rain, washing away the pain, nothing stays the same.' : 'Smile all day, dance and play, let the good times roll today!' },
            { type: 'Outro', text: 'Fade away with the beautiful music...' }
          ],
          vocalsText: songStyle === 'dance'
            ? 'Yeah, listen to the rhythm, let it take control! Lights are flashing bright, we own the floor tonight. Feel the beat, move your feet, let the music sweep you off your seat! Bass is pumping loud, dancing in the crowd. Feel the beat, move your feet!'
            : songStyle === 'motivational'
            ? 'The road is long and steep, but promises we keep, we will fly high! We will rise above, driven by our goals, with fire in our souls! Storms will come and go, but the inner strength will grow. We will rise above, driven by our goals!'
            : songStyle === 'sad'
            ? 'Walking alone in the cold, a story left untold. Tears fall like the rain, washing away the pain, nothing stays the same. Silent empty halls, shadows on the walls. Tears fall like the rain.'
            : 'Sunlight in my eyes, a beautiful surprise. Smile all day, dance and play, let the good times roll today! Friends are by my side, with nothing left to hide. Smile all day, dance and play!'
        }
      };

      const preset = fallbackSongs[lang] || fallbackSongs['hi'];
      return res.json(preset);
    }

    // Call Gemini to generate lyrics and vocals structure
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const isHindi = lang === 'hi';
    const durationPrompt = songDuration === 'short' ? 'short (around 15 lines)' : songDuration === 'long' ? 'long and detailed (around 35 lines with multiple verses and choruses)' : 'medium-sized (around 20-25 lines)';

    const systemInstruction = `You are an elite songwriting and musical lyricist AI assistant.
    Your absolute goal is to write highly rhythmic, poetic, and beautifully rhymed lyrics that flow like an actual song with perfect tempo and cadence.
    The musical style is: ${songStyle} (Options: dance, motivational, sad, happy).
    The song duration/length requested is: ${durationPrompt}.

    CRITICAL STYLE & GENRE ADAPTATION:
    - If the user's prompt mentions "Bhojpuri", "bhojpuri", "wedding", "shaadi", "vivah", "shadi", "vivah geet", "bhakti", "devotional", "dhamaka", or similar popular YouTube formats:
      1. Write in the exact dialect or vocabulary of that style (for Bhojpuri, use terms like "saiyaan", "gori", "baate", "babu", "laika", "manwa", "jiyara", etc. For Shaadi-Vivah, use traditional wedding terms like "dulha", "dulhan", "mandap", "sehra", "banna", "banni", "maiya", "shahnai", "haldi", "gathbandhan", etc.).
      2. Structure the lyrics with incredibly catchy, high-energy YouTube-hit refrains, repetitive hooks, and rhythmic syncopated lines that sound amazing when recited with our backing dholak, tabla, and harmonium beats.
      3. Ensure the rhyming is tight and extremely musical.

    CRITICAL VOCAL SYNTHESIS GUIDELINES FOR "vocalsText":
    - Keep lines and sentences short, catchy, and highly rhythmic.
    - Use simple, strong rhyming schemes (like AABB or ABAB) with memorable end-rhymes (e.g., 'masti / sasti', 'shaan / jaan', 'deep / keep').
    - Keep the vocals text completely clean, natural, and simple. Do NOT insert artificial ellipses (...), excessive commas, or filler sounds (like "oh", "yeah", "ah", "ओह", "हाँ", "या"). The Text-to-Speech engine should recite the beautiful song lyrics normally and clearly, without sounding like it is trying to fake a singing person.
    - "vocalsText" must contain ONLY the clean vocal lyrics, with no brackets, headers, section labels, or spoken instructions. Always output in ${isHindi ? 'Hindi (Devanagari script)' : 'English'}.

    Based on the user's prompt: "${cleanPrompt}", generate:
    1. A unique, creative title.
    2. A list of lyrics sections (Intro, Verse 1, Chorus, Verse 2, Chorus, Outro) styled matching the requested vibe.
    3. A simplified continuous "vocalsText" string matching the critical vocal synthesis guidelines.

    Return the response strictly as a JSON object matching this schema:
    {
      "title": "A string of the song's title",
      "vibeDescription": "A short, engaging description of the vibe and style in the chosen language",
      "lyricsSections": [
        { "type": "Intro", "text": "Lyrics text of this section" }
      ],
      "vocalsText": "Complete clean continuous vocal text with normal punctuation for a beautiful clean recitation"
    }`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: `Create a ${songStyle} song in ${isHindi ? 'Hindi' : 'English'} about: ${cleanPrompt}`,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: {
              type: Type.STRING,
              description: "A unique, creative title of the song in the chosen language",
            },
            vibeDescription: {
              type: Type.STRING,
              description: "A short, engaging description of the vibe and style in the chosen language",
            },
            lyricsSections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: {
                    type: Type.STRING,
                    description: "The type of the lyrics section (e.g. Intro, Verse 1, Chorus, Verse 2, Outro)",
                  },
                  text: {
                    type: Type.STRING,
                    description: "The actual lyrics text of this section",
                  },
                },
                required: ["type", "text"],
              },
              description: "The list of lyrics sections",
            },
            vocalsText: {
              type: Type.STRING,
              description: "Complete clean continuous vocal text without headers, square brackets, or spoken cues, only the lyrics to be synthesized directly by a Text-to-Speech engine",
            },
          },
          required: ["title", "vibeDescription", "lyricsSections", "vocalsText"],
        },
        temperature: 0.8,
      },
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error('Gemini returned an empty lyrics response');
    }

    const songData = JSON.parse(resultText.trim());
    res.json(songData);

  } catch (error: any) {
    console.error('Error generating song lyrics on server:', error);
    res.status(500).json({ error: 'गीत तैयार करने में समस्या आई। कृपया फिर से प्रयास करें। (Song generation failed. Please try again.)' });
  }
});

// API route for Text-to-Speech
app.post('/api/tts', async (req, res) => {
  let runEdgeTTS: any;
  try {
    const { text, voice, language, engine } = req.body;
    
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'कृपया कुछ टेक्स्ट दर्ज करें (Please enter some text)' });
    }

    const cleanText = text.trim();
    const useLocal = engine === 'local';

    // Check LRU cache first to prevent redundant requests and make repeated text instant
    const cacheKey = getCacheKey(cleanText, voice || 'Kore', language || 'hi', engine || 'cloud');
    if (AUDIO_CACHE.has(cacheKey)) {
      console.log(`[Cache Hit] Serving audio from memory cache for key: ${cacheKey}`);
      return res.json(AUDIO_CACHE.get(cacheKey));
    }

    // Helper to run high-quality Edge TTS
    runEdgeTTS = async () => {
      let edgeVoice = 'hi-IN-SwaraNeural';
      let edgePitch = '+0%';
      let edgeRate = '+0%';

      const isSongMode = cleanText.length > 100;

      if (language === 'hi') {
        if (voice === 'Kore') {
          edgeVoice = 'hi-IN-SwaraNeural';
          edgePitch = isSongMode ? '+4%' : '+6%';
          edgeRate = isSongMode ? '-2%' : '+2%';
        } else if (voice === 'Aoede') {
          edgeVoice = 'hi-IN-SwaraNeural';
          edgePitch = isSongMode ? '+1%' : '+0%';
          edgeRate = isSongMode ? '-2%' : '+1%';
        } else if (voice === 'Kavya') {
          edgeVoice = 'hi-IN-SwaraNeural';
          edgePitch = isSongMode ? '-1%' : '-2%';
          edgeRate = isSongMode ? '-3%' : '-3%';
        } else if (voice === 'Nisha') {
          edgeVoice = 'hi-IN-SwaraNeural';
          edgePitch = isSongMode ? '-3%' : '-4%';
          edgeRate = isSongMode ? '-4%' : '-3%';
        } else if (voice === 'Ananya') {
          edgeVoice = 'hi-IN-SwaraNeural';
          edgePitch = isSongMode ? '+3%' : '+3%';
          edgeRate = isSongMode ? '-2%' : '+2%';
        } else if (voice === 'Puck') {
          edgeVoice = 'hi-IN-SwaraNeural';
          edgePitch = isSongMode ? '+10%' : '+14%';
          edgeRate = isSongMode ? '-1%' : '+4%';
        } else if (voice === 'Zephyr') {
          edgeVoice = 'hi-IN-MadhurNeural';
          edgePitch = isSongMode ? '+1%' : '+0%';
          edgeRate = isSongMode ? '-2%' : '+1%';
        } else if (voice === 'Aarav') {
          edgeVoice = 'hi-IN-MadhurNeural';
          edgePitch = isSongMode ? '+2%' : '+2%';
          edgeRate = isSongMode ? '-1%' : '+8%';
        } else if (voice === 'Rohan') {
          edgeVoice = 'hi-IN-MadhurNeural';
          edgePitch = isSongMode ? '+0%' : '-2%';
          edgeRate = isSongMode ? '-2%' : '+2%';
        } else if (voice === 'Fenrir') {
          edgeVoice = 'hi-IN-MadhurNeural';
          edgePitch = isSongMode ? '-4%' : '-6%';
          edgeRate = isSongMode ? '-4%' : '-2%';
        } else if (voice === 'Charon') {
          edgeVoice = 'hi-IN-MadhurNeural';
          edgePitch = isSongMode ? '-8%' : '-12%';
          edgeRate = isSongMode ? '-5%' : '-4%';
        } else if (voice === 'Chiku') {
          edgeVoice = 'hi-IN-SwaraNeural';
          edgePitch = isSongMode ? '+15%' : '+22%';
          edgeRate = isSongMode ? '-1%' : '+8%';
        }
      } else {
        // English
        if (voice === 'Kore') {
          edgeVoice = 'en-US-JennyNeural';
          edgePitch = isSongMode ? '+5%' : '+10%';
          edgeRate = isSongMode ? '-2%' : '+3%';
        } else if (voice === 'Aoede') {
          edgeVoice = 'en-US-AriaNeural';
          edgePitch = isSongMode ? '+3%' : '+0%';
          edgeRate = isSongMode ? '-3%' : '+0%';
        } else if (voice === 'Kavya') {
          edgeVoice = 'en-IN-NeerjaNeural';
          edgePitch = isSongMode ? '+2%' : '+0%';
          edgeRate = isSongMode ? '-4%' : '-2%';
        } else if (voice === 'Nisha') {
          edgeVoice = 'en-US-AriaNeural';
          edgePitch = isSongMode ? '-2%' : '-5%';
          edgeRate = isSongMode ? '-4%' : '-5%';
        } else if (voice === 'Ananya') {
          edgeVoice = 'en-US-EmmaNeural';
          edgePitch = isSongMode ? '+2%' : '+0%';
          edgeRate = isSongMode ? '-4%' : '-3%';
        } else if (voice === 'Puck') {
          edgeVoice = 'en-US-AnaNeural';
          edgePitch = isSongMode ? '+5%' : '+5%';
          edgeRate = isSongMode ? '-2%' : '+5%';
        } else if (voice === 'Zephyr') {
          edgeVoice = 'en-US-GuyNeural';
          edgePitch = isSongMode ? '+2%' : '+0%';
          edgeRate = isSongMode ? '-3%' : '+0%';
        } else if (voice === 'Aarav') {
          edgeVoice = 'en-IN-PrabhatNeural';
          edgePitch = isSongMode ? '+2%' : '+0%';
          edgeRate = isSongMode ? '-3%' : '+10%';
        } else if (voice === 'Rohan') {
          edgeVoice = 'en-US-AndrewNeural';
          edgePitch = isSongMode ? '+2%' : '+0%';
          edgeRate = isSongMode ? '-3%' : '+5%';
        } else if (voice === 'Fenrir') {
          edgeVoice = 'en-US-ChristopherNeural';
          edgePitch = isSongMode ? '-5%' : '-10%';
          edgeRate = isSongMode ? '-4%' : '-5%';
        } else if (voice === 'Charon') {
          edgeVoice = 'en-US-SteffanNeural';
          edgePitch = isSongMode ? '-8%' : '-15%';
          edgeRate = isSongMode ? '-5%' : '-10%';
        } else if (voice === 'Chiku') {
          edgeVoice = 'en-US-AnaNeural';
          edgePitch = isSongMode ? '+20%' : '+30%';
          edgeRate = isSongMode ? '-1%' : '+15%';
        }
      }

      console.log(`Generating Edge TTS. Text: "${cleanText.substring(0, 30)}...", Voice: ${edgeVoice}, Pitch: ${edgePitch}, Rate: ${edgeRate}`);
      
      try {
        // Split text into highly-optimal chunks (up to 1000 chars) for fast parallel streaming and complete robustness against network lag
        const chunks = splitTextIntoChunks(cleanText, 1000);
        console.log(`Generating Edge TTS for ${chunks.length} chunks...`);
        
        // Concurrency limit of 5 chunks per active request to balance maximum throughput and solid connection stability
        const chunkBuffers = await pLimit(chunks, 5, async (chunkText) => {
          const chunkKey = getChunkCacheKey(chunkText, edgeVoice, edgePitch, edgeRate, 'edge');
          if (CHUNK_CACHE.has(chunkKey)) {
            console.log(`[Chunk Cache Hit] Serving cached audio for Edge TTS chunk: "${chunkText.substring(0, 20)}..."`);
            return CHUNK_CACHE.get(chunkKey)!;
          }

          try {
            const buffer = await retryWithBackoff(() => customEdgeTts(chunkText, {
              voice: edgeVoice,
              pitch: edgePitch,
              rate: edgeRate,
            }), 2, 500);
            cacheChunk(chunkKey, buffer);
            return buffer;
          } catch (chunkErr: any) {
            console.warn(`Direct customEdgeTts failed for chunk: "${chunkText.substring(0, 30)}...". Falling back to Google Translate for this chunk.`, chunkErr.message || chunkErr);
            
            // Queue Google Translate requests using global pool to keep them synchronized and prevent 429 rate limiting
            const subBuffers = await globalGoogleTtsPool.run(async () => {
              const subChunks = splitTextIntoChunks(chunkText, 180);
              const subBuffersLocal: Buffer[] = [];
              const googleLang = language || 'en';
              for (const subChunk of subChunks) {
                const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${googleLang}&client=tw-ob&q=${encodeURIComponent(subChunk)}`;
                const fetchRes = await fetch(url, {
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, logo/1.0) Chrome/143.0.0.0 Safari/537.36'
                  }
                });
                if (!fetchRes.ok) {
                  throw new Error(`Google Translate TTS returned status ${fetchRes.status}`);
                }
                const arrayBuffer = await fetchRes.arrayBuffer();
                subBuffersLocal.push(Buffer.from(arrayBuffer));
              }
              return subBuffersLocal;
            });
            const mergedSubBuffer = Buffer.concat(subBuffers);
            cacheChunk(chunkKey, mergedSubBuffer);
            return mergedSubBuffer;
          }
        });

        const mergedBuffer = Buffer.concat(chunkBuffers);

        const result = {
          audio: mergedBuffer.toString('base64'),
          mimeType: 'audio/mpeg',
          isLocal: true
        };

        // Cache successful generation
        cacheAudio(cacheKey, result);
        return result;
      } catch (err: any) {
        console.warn('Direct customEdgeTts failed. Error:', err.message || err);

        // Step 2: Fallback to Gemini Cloud TTS if API key is present
        if (process.env.GEMINI_API_KEY) {
          console.log('Falling back to high-quality Gemini TTS on the server...');
          try {
            const ai = new GoogleGenAI({
              apiKey: process.env.GEMINI_API_KEY,
              httpOptions: {
                headers: {
                  'User-Agent': 'aistudio-build',
                },
              },
            });

            const geminiVoice = getGeminiVoice(voice || 'Puck');
            const response = await ai.models.generateContent({
              model: 'gemini-3.1-flash-tts-preview',
              contents: cleanText,
              config: {
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: geminiVoice,
                    },
                  },
                },
                responseModalities: ['AUDIO'],
              },
            });

            const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
            if (part && part.inlineData) {
              const originalMimeType = part.inlineData.mimeType || 'audio/x-linear16';
              let base64Data = part.inlineData.data;
              let finalMimeType = originalMimeType;

              if (originalMimeType.includes('linear16') || originalMimeType.includes('pcm') || originalMimeType.includes('l16')) {
                const pcmBuffer = Buffer.from(base64Data, 'base64');
                let sampleRate = 24000;
                const rateMatch = originalMimeType.match(/rate=(\d+)/);
                if (rateMatch && rateMatch[1]) {
                  sampleRate = parseInt(rateMatch[1], 10);
                }
                const wavBuffer = addWavHeader(pcmBuffer, sampleRate);
                base64Data = wavBuffer.toString('base64');
                finalMimeType = 'audio/wav';
              }

              const result = {
                audio: base64Data,
                mimeType: finalMimeType,
                isLocal: true,
                warning: 'Microsoft Edge Speech service was temporarily unavailable. Switched to high-quality Gemini TTS voice automatically.'
              };

              cacheAudio(cacheKey, result);
              return result;
            }
          } catch (geminiErr: any) {
            console.error('Fallback Gemini TTS failed:', geminiErr);
          }
        }

        // Step 3: Fallback to Google Translate TTS (completely free and unlimited, guaranteed to succeed)
        console.log('Falling back to free, unlimited Google Translate TTS...');
        try {
          const googleLang = language || 'en';
          
          const resultBuffer = await globalGoogleTtsPool.run(async () => {
            const googleChunks = splitTextIntoChunks(cleanText, 180);
            const subBuffers: Buffer[] = [];
            for (const subChunk of googleChunks) {
              const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${googleLang}&client=tw-ob&q=${encodeURIComponent(subChunk)}`;
              const fetchRes = await fetch(url, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'
                }
              });
              if (!fetchRes.ok) {
                throw new Error(`Google Translate TTS returned status ${fetchRes.status}`);
              }
              const arrayBuffer = await fetchRes.arrayBuffer();
              subBuffers.push(Buffer.from(arrayBuffer));
            }
            return Buffer.concat(subBuffers);
          });

          const result = {
            audio: resultBuffer.toString('base64'),
            mimeType: 'audio/mpeg',
            isLocal: true,
            warning: 'Microsoft Edge Speech service was temporarily unavailable. Switched to free basic translation voice automatically.'
          };

          cacheAudio(cacheKey, result);
          return result;
        } catch (googleErr: any) {
          console.error('Fallback Google Translate TTS failed:', googleErr);
          throw new Error('All speech generation services failed to connect. Please check your network and try again.');
        }
      }
    };

    if (useLocal) {
      const localResult = await runEdgeTTS();
      return res.json(localResult);
    }

    // Standard Gemini Cloud AI Mode
    if (!process.env.GEMINI_API_KEY) {
      // Automatic fallback to high quality Local voice if API key is missing
      console.log('Gemini API key missing. Switched to high-quality Edge TTS.');
      const localResult = await runEdgeTTS();
      return res.json({
        ...localResult,
        warning: localResult.warning || 'Gemini API Key missing. Switched to high-quality Premium Voice automatically.'
      });
    }

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    // CRITICAL API QUOTA SAVER: Split into larger 3500-character chunks for Gemini (conserve 10 requests/minute free limits)
    const chunks = splitTextIntoChunks(cleanText, 3500);
    console.log(`Generating Gemini Cloud TTS for ${chunks.length} chunks in parallel (max 2 concurrency)...`);
    
    let pcmBuffers: Buffer[];
    try {
      pcmBuffers = await pLimit(chunks, 2, async (chunkText) => {
        const resolvedGeminiVoice = getGeminiVoice(voice || 'Puck');
        const chunkKey = getChunkCacheKey(chunkText, resolvedGeminiVoice, '', '', 'gemini');
        if (CHUNK_CACHE.has(chunkKey)) {
          console.log(`[Chunk Cache Hit] Serving cached audio for Gemini chunk: "${chunkText.substring(0, 20)}..."`);
          return CHUNK_CACHE.get(chunkKey)!;
        }

        const buffer = await retryWithBackoff(async () => {
          const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-tts-preview',
            contents: chunkText,
            config: {
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: resolvedGeminiVoice,
                  },
                },
              },
              responseModalities: ['AUDIO'],
            },
          });

          const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
          if (!part || !part.inlineData) {
            throw new Error('Gemini empty response on a chunk');
          }
          return Buffer.from(part.inlineData.data, 'base64');
        }, 2, 800); // 2 retries, 800ms initial backoff delay
        
        cacheChunk(chunkKey, buffer);
        return buffer;
      });
    } catch (geminiErr: any) {
      console.warn('Direct Gemini Cloud TTS failed, falling back to parallelized Edge TTS...', geminiErr);
      const localResult = await runEdgeTTS();
      return res.json({
        ...localResult,
        warning: 'Gemini Cloud limit exceeded or unavailable. Switched to high-quality Premium Voice automatically.'
      });
    }

    const combinedPcmBuffer = Buffer.concat(pcmBuffers);
    const wavBuffer = addWavHeader(combinedPcmBuffer, 24000);

    const result = {
      audio: wavBuffer.toString('base64'),
      mimeType: 'audio/wav',
    };

    cacheAudio(cacheKey, result);
    res.json(result);
  } catch (error: any) {
    console.error('Error generating audio on Gemini Cloud:', error);
    
    // Seamless automatic fallback to high-quality premium local voice for unlimited access when quota is reached or errors occur!
    console.log('Automatically falling back to unlimited high-quality Edge TTS...');
    try {
      const localResult = await runEdgeTTS();
      return res.json({
        ...localResult,
        warning: localResult.warning || 'जेमिनी क्लाउड सीमा समाप्त होने पर उच्च-गुणवत्ता वाली प्रीमियम आवाज़ स्वतः सक्रिय कर दी गई है! (Unlimited Active: Switched to premium voice automatically.)'
      });
    } catch (fallbackError: any) {
      console.error('Fallback failed:', fallbackError);
      return res.status(500).json({ 
        error: 'आवाज़ तैयार करने में समस्या आई। कृपया फिर से प्रयास करें। (Voice generation failed. Please try again.)' 
      });
    }
  }
});

// Serve Vite SPA in development / production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
} else {
  // Dev mode: use Vite middleware
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on port ${port}`);
});
