import { WebSocket } from 'ws';
import crypto from 'crypto';
import fs from 'fs';

const EDGE_API_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const EDGE_VERSION = "1-132.0.2957.140";
const WINDOWS_FILE_TIME_EPOCH = BigInt("11644473600");

function generateSecMsGecToken(): string {
  const seconds = BigInt(Math.floor(Date.now() / 1000 + Number(WINDOWS_FILE_TIME_EPOCH)));
  const ticks = seconds * BigInt("10000000");
  const baseVal = ticks - ticks % BigInt("3000000000");
  const strToHash = baseVal.toString() + EDGE_API_TOKEN;
  
  const hash = crypto.createHash('sha256').update(strToHash).digest('hex');
  return hash.toUpperCase();
}

interface CustomTtsOptions {
  voice?: string;
  volume?: string;
  rate?: string;
  pitch?: string;
}

export function customEdgeTts(text: string, options: CustomTtsOptions = {}): Promise<Buffer> {
  const { voice = 'en-GB-SoniaNeural', volume = '+0%', rate = '+0%', pitch = '+0%' } = options;

  return new Promise<Buffer>((resolve, reject) => {
    const connectionId = crypto.randomUUID().replaceAll('-', '');
    const secMsGec = generateSecMsGecToken();
    const fullUrl = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4&ConnectionId=${connectionId}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${EDGE_VERSION}`;

    console.log('Connecting to WebSocket with URL:', fullUrl);

    const ws = new WebSocket(fullUrl, {
      host: 'speech.platform.bing.com',
      origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
        'Sec-MS-GEC': secMsGec,
        'Sec-MS-GEC-Version': EDGE_VERSION
      }
    });

    const audioData: Buffer[] = [];
    ws.on('message', (rawData, isBinary) => {
      if (!isBinary) {
        const data = rawData.toString('utf8');
        if (data.includes('turn.end')) {
          console.log('Turn ended. Resolving audio with length:', audioData.reduce((acc, b) => acc + b.length, 0));
          resolve(Buffer.concat(audioData));
          ws.close();
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
      console.error('WebSocket Error:', err);
      reject(err);
    });

    ws.on('close', (code, reason) => {
      console.log(`WebSocket closed: code ${code}, reason: ${reason.toString()}`);
      if (audioData.length > 0) {
        resolve(Buffer.concat(audioData));
      } else {
        reject(new Error(`WebSocket connection closed: code ${code}, reason: ${reason.toString()}`));
      }
    });

    const speechConfig = JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
            outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
          }
        }
      }
    });

    const configMessage = `X-Timestamp:${Date()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${speechConfig}`;

    ws.on('open', () => {
      console.log('WebSocket connection opened successfully. Sending config...');
      ws.send(configMessage, { compress: true }, (configError) => {
        if (configError) {
          reject(configError);
          return;
        }

        const requestId = crypto.randomUUID().replaceAll('-', '');
        const ssmlMessage = `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\n`
          + `X-Timestamp:${Date()}Z\r\nPath:ssml\r\n\r\n`
          + `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>`
          + `<voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>`
          + `${text}</prosody></voice></speak>`;

        console.log('Sending SSML message...');
        ws.send(ssmlMessage, { compress: true }, (ssmlError) => {
          if (ssmlError) {
            reject(ssmlError);
          }
        });
      });
    });
  });
}

async function test() {
  try {
    const res = await customEdgeTts("Hello, this is a test of our powerful newly implemented Edge TTS engine with secure token validation.");
    fs.writeFileSync('/tmp/test-output.mp3', res);
    console.log("SUCCESS! Audio file written to /tmp/test-output.mp3");
    process.exit(0);
  } catch (err) {
    console.error("FAILED!", err);
    process.exit(1);
  }
}

test();
