import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Volume2, 
  Trash2, 
  Download, 
  Play, 
  Pause, 
  RefreshCw, 
  Globe, 
  User, 
  Sparkles, 
  VolumeX,
  Check,
  Languages,
  Keyboard,
  Music,
  Home,
  Sliders,
  PenTool,
  CheckCircle,
  HelpCircle,
  TrendingUp,
  Heart,
  FileText,
  SlidersHorizontal,
  ChevronRight,
  Mic,
  AlertCircle,
  Disc,
  Clock,
  Music4,
  Zap
} from 'lucide-react';
import { SongSynthesizer, MusicStyle } from './audioSynth';

const getApiUrl = (path: string): string => {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.run.app')) {
    return path;
  }
  // Fallback to our real hosted Google Cloud Run backend for other platforms like Netlify
  const CLOUD_RUN_URL = 'https://ais-pre-gnh6lak3hu3kg7lxscy334-672646129889.asia-east1.run.app';
  return `${CLOUD_RUN_URL}${path}`;
};

// prebuilt voices metadata
interface VoiceCharacter {
  id: string;
  nameKey: string;
  gender: 'female' | 'male';
  pitch: 'thin' | 'deep' | 'standard';
  color: string;
}

const VOICES: VoiceCharacter[] = [
  { id: 'Kore', nameKey: 'Kore', gender: 'female', pitch: 'thin', color: 'bg-rose-50 border-rose-200 text-rose-700' },
  { id: 'Aoede', nameKey: 'Aoede', gender: 'female', pitch: 'standard', color: 'bg-pink-50 border-pink-200 text-pink-700' },
  { id: 'Kavya', nameKey: 'Kavya', gender: 'female', pitch: 'standard', color: 'bg-teal-50 border-teal-200 text-teal-700' },
  { id: 'Nisha', nameKey: 'Nisha', gender: 'female', pitch: 'deep', color: 'bg-purple-50 border-purple-200 text-purple-700' },
  { id: 'Ananya', nameKey: 'Ananya', gender: 'female', pitch: 'thin', color: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  { id: 'Puck', nameKey: 'Puck', gender: 'male', pitch: 'thin', color: 'bg-amber-50 border-amber-200 text-amber-700' },
  { id: 'Zephyr', nameKey: 'Zephyr', gender: 'male', pitch: 'standard', color: 'bg-blue-50 border-blue-200 text-blue-700' },
  { id: 'Aarav', nameKey: 'Aarav', gender: 'male', pitch: 'standard', color: 'bg-cyan-50 border-cyan-200 text-cyan-700' },
  { id: 'Rohan', nameKey: 'Rohan', gender: 'male', pitch: 'deep', color: 'bg-orange-50 border-orange-200 text-orange-700' },
  { id: 'Fenrir', nameKey: 'Fenrir', gender: 'male', pitch: 'deep', color: 'bg-violet-50 border-violet-200 text-violet-700' },
  { id: 'Charon', nameKey: 'Charon', gender: 'male', pitch: 'deep', color: 'bg-slate-50 border-slate-200 text-slate-700' },
  { id: 'Chiku', nameKey: 'Chiku', gender: 'male', pitch: 'thin', color: 'bg-yellow-50 border-yellow-200 text-yellow-700' },
];

const TRANSLATIONS = {
  hi: {
    title: "Nitish Voice",
    subtitle: "लिखे हुए शब्दों को सुंदर प्राकृतिक आवाज़ों में बदलें",
    homeTab: "मुख्य पेज",
    voiceTab: "आवाज़ जनरेटर",
    songTab: "गीत और संगीत स्टूडियो",
    placeholder: "अपना टेक्स्ट यहाँ लिखें या पेस्ट करें...",
    clearTooltip: "टेक्स्ट साफ करें",
    generateBtn: "आवाज़ बनाएं",
    generating: "आवाज़ तैयार हो रही है...",
    downloadBtn: "डाउनलोड करें",
    voiceLabel: "आवाज़ का करैक्टर चुनें",
    langLabel: "भाषा",
    successMsg: "आवाज़ सफलतापूर्वक तैयार हो गई!",
    emptyWarning: "कृपया आवाज़ बनाने के लिए पहले कुछ टेक्स्ट लिखें।",
    errorMsg: "आवाज़ तैयार करने में त्रुटि हुई। कृपया फिर से प्रयास करें।",
    characterSection: "आवाज़ के पात्र (करैक्टर)",
    quickPhrases: "त्वरित वाक्य (जांचने के लिए क्लिक करें)",
    phrase1: "नमस्ते, आपका स्वागत है! यह ऐप बहुत ही सरल और सुंदर है।",
    phrase2: "कृपया इस आवाज़ को सुनें और डाउनलोड बटन दबाकर सेव करें।",
    phrase3: "आज का मौसम बहुत सुहाना है, चलिए बाहर घूमने चलते हैं।",
    phrase4: "चैनल को सब्सक्राइब करें और वीडियो को लाइक करना न भूलें।",
    characters: {
      Aoede: { name: "आओडी (Aoede)", desc: "लड़की — स्पष्ट और मधुर", type: "लड़की", tone: "सामान्य आवाज़" },
      Kore: { name: "कोरे (Kore)", desc: "लड़की — कोमल और पतली", type: "लड़की", tone: "पतली आवाज़" },
      Kavya: { name: "काव्या (Kavya)", desc: "लड़की 🌟 कहानी सुनाने के लिए सर्वोत्तम (Storyteller)", type: "लड़की", tone: "भावुक कहानीकार" },
      Nisha: { name: "निशा (Nisha)", desc: "लड़की 🎙️ पॉडकास्ट और गहरी आवाज़ (Podcast & Shayari)", type: "लड़की", tone: "गहरी/शालीन" },
      Ananya: { name: "अनन्या (Ananya)", desc: "लड़की 🎓 पढ़ाई और ट्यूटोरियल के लिए (Education)", type: "लड़की", tone: "स्पष्ट व्याख्याकार" },
      Zephyr: { name: "ज़ेफिर (Zephyr)", desc: "लड़का — अनुकूल और स्पष्ट", type: "लड़का", tone: "सामान्य आवाज़" },
      Puck: { name: "पक (Puck)", desc: "लड़का — चंचल और पतली", type: "लड़का", tone: "पतली आवाज़" },
      Aarav: { name: "आरव (Aarav)", desc: "लड़का ⚡ टेक, फैक्ट्स और तेज़ आवाज़ (Tech & Facts)", type: "लड़का", tone: "हाई-एनर्जी/तेज़" },
      Rohan: { name: "रोहन (Rohan)", desc: "लड़का 🔥 दमदार और जोशीली आवाज़ (Motivation)", type: "लड़का", tone: "जोशीली/प्रेरक" },
      Fenrir: { name: "फेनिर (Fenrir)", desc: "पुरुष — मोटी और भारी", type: "पुरुष", tone: "मोटी आवाज़" },
      Charon: { name: "कैरन (Charon)", desc: "पुरुष — गंभीर और गहरी", type: "पुरुष", tone: "भारी आवाज़" },
      Chiku: { name: "चीकू (Chiku)", desc: "कार्टून 🎭 चुलबुली कॉमेडी आवाज़ (Comedy & Kids)", type: "कार्टून", tone: "हास्य/कार्टून" },
    },
    pitchLabels: {
      thin: "पतली आवाज़",
      standard: "सामान्य आवाज़",
      deep: "मोटी आवाज़"
    },
    genderLabels: {
      female: "लड़की",
      male: "लड़का/पुरुष"
    },
    engineLabel: "आवाज़ का इंजन (Voice Engine)",
    geminiCloud: "जेमिनी क्लाउड AI",
    browserLocal: "प्रीमियम फ्री (असीमित ⚡)",
    localBadge: "प्रीमियम फ्री मोड सक्रिय: बिना किसी लिमिट के स्टूडियो-गुणवत्ता वाली आवाज़ असीमित बार तैयार करें और डाउनलोड करें!",
    limitExceededFallback: "जेमिनी की दैनिक सीमा समाप्त हो गई है। आपके लिए असीमित और उच्च-गुणवत्ता वाला 'प्रीमियम फ्री' मोड स्वतः सक्रिय कर दिया गया है!"
  },
  en: {
    title: "Nitish Voice",
    subtitle: "Convert your written text into beautiful natural speech",
    homeTab: "Home",
    voiceTab: "AI Voice Generator",
    songTab: "AI Song & Beats Studio",
    placeholder: "Type or paste your text here...",
    clearTooltip: "Clear text",
    generateBtn: "Generate Voice",
    generating: "Generating voice...",
    downloadBtn: "Download MP3",
    voiceLabel: "Select Voice Character",
    langLabel: "Language",
    successMsg: "Voice generated successfully!",
    emptyWarning: "Please write some text to generate voice.",
    errorMsg: "Error generating voice. Please try again.",
    characterSection: "Voice Characters",
    quickPhrases: "Quick Phrases (Click to try)",
    phrase1: "Hello, welcome! This app is extremely simple and clean.",
    phrase2: "Please listen to this voice and download the audio file.",
    phrase3: "The weather is beautiful today, let's go for a walk.",
    phrase4: "Don't forget to like this video and subscribe to our channel.",
    characters: {
      Aoede: { name: "Aoede", desc: "Girl — Clear & sweet", type: "Girl", tone: "Standard" },
      Kore: { name: "Kore", desc: "Girl — Soft & thin/high-pitch", type: "Girl", tone: "Thin Voice" },
      Kavya: { name: "Kavya", desc: "Girl 🌟 Perfect for Storytelling & Drama", type: "Girl", tone: "Narrative" },
      Nisha: { name: "Nisha", desc: "Girl 🎙️ Soothing deep podcast voice", type: "Girl", tone: "Podcast" },
      Ananya: { name: "Ananya", desc: "Girl 🎓 Polished clear voice for Tutorials/Education", type: "Girl", tone: "Tutorial" },
      Zephyr: { name: "Zephyr", desc: "Boy — Friendly & natural", type: "Boy", tone: "Standard" },
      Puck: { name: "Puck", desc: "Boy — Playful & youthful thin voice", type: "Boy", tone: "Thin Voice" },
      Aarav: { name: "Aarav", desc: "Boy ⚡ Rapid energetic voice for Tech & Facts", type: "Boy", tone: "High-Energy" },
      Rohan: { name: "Rohan", desc: "Boy 🔥 Powerful motivational voice", type: "Boy", tone: "Motivational" },
      Fenrir: { name: "Fenrir", desc: "Man — Heavy & deep masculine voice", type: "Man", tone: "Deep Voice" },
      Charon: { name: "Charon", desc: "Man — Mature & deep serious voice", type: "Man", tone: "Deep Voice" },
      Chiku: { name: "Chiku", desc: "Cartoon 🎭 Funny high-pitched comedy voice", type: "Cartoon", tone: "Cartoon" },
    },
    pitchLabels: {
      thin: "Thin Voice",
      standard: "Standard Voice",
      deep: "Deep Voice"
    },
    genderLabels: {
      female: "Girl",
      male: "Boy/Man"
    },
    engineLabel: "Voice Engine",
    geminiCloud: "Gemini Cloud AI",
    browserLocal: "Premium Free (Unlimited ⚡)",
    localBadge: "Premium Free mode active: Generate and download studio-quality neural voices with zero limits!",
    limitExceededFallback: "Gemini limit exceeded. Switched to 'Premium Free' mode automatically for unlimited generation!"
  }
};

// Helper function to safely convert Base64 string to a Blob without fetching data URLs
function base64ToBlob(base64: string, mimeType: string): Blob {
  const cleanBase64 = base64.replace(/\s/g, '');
  const byteCharacters = atob(cleanBase64);
  const byteNumbers = new Uint8Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  return new Blob([byteNumbers], { type: mimeType });
}

// Helper to get short preview text for voice characters
const getSampleText = (voiceId: string, lang: 'hi' | 'en') => {
  if (lang === 'hi') {
    switch (voiceId) {
      case 'Kore': return 'नमस्ते! मैं कोरे हूँ। मेरी कोमल और पतली आवाज़ है।';
      case 'Aoede': return 'नमस्ते! मैं आओडी हूँ। मेरी स्पष्ट और मधुर आवाज़ है।';
      case 'Kavya': return 'नमस्कार दोस्तों, एक राजा की कहानी में आपका स्वागत है।';
      case 'Nisha': return 'स्वागत है आपका हमारे विशेष पॉडकास्ट में। आज हम बात करेंगे जीवन के बारे में।';
      case 'Ananya': return 'नमस्ते, आज के इस अध्याय में हम विज्ञान के बारे में पढ़ेंगे।';
      case 'Puck': return 'नमस्ते! मैं पक हूँ। मेरी चंचल और पतली आवाज़ है।';
      case 'Zephyr': return 'नमस्ते! मैं ज़ेफिर हूँ। मेरी अनुकूल और स्पष्ट आवाज़ है।';
      case 'Aarav': return 'क्या आपको पता है? आज के इस शॉट में हम तीन ऐसे फैक्ट्स जानेंगे जो आपने कभी नहीं सुने होंगे!';
      case 'Rohan': return 'अगर आप थक गए हैं तो रुकिए मत! उठिए, आगे बढ़िए और अपने सपनों को पूरा कीजिए!';
      case 'Fenrir': return 'नमस्ते! मैं फेनिर हूँ। मेरी मोटी और भारी आवाज़ है।';
      case 'Charon': return 'नमस्ते! मैं कैरन हूँ। मेरी गंभीर और गहरी आवाज़ है।';
      case 'Chiku': return 'अरे भैया! हमारी आवाज़ सुनो, कितनी मज़ेदार कॉमेडी और कार्टून वाली आवाज़ है ना!';
      default: return 'नमस्ते! मैं आपकी नई एआई आवाज़ हूँ।';
    }
  } else {
    switch (voiceId) {
      case 'Kore': return 'Hello! I am Kore. This is my soft and thin voice.';
      case 'Aoede': return 'Hello! I am Aoede. This is my clear and sweet voice.';
      case 'Kavya': return 'Hello everyone, welcome to our classic bedtime stories channel.';
      case 'Nisha': return 'Welcome back to our weekly podcast. Let us dive into today’s discussion.';
      case 'Ananya': return 'Hello students, today we will learn about the solar system.';
      case 'Puck': return 'Hello! I am Puck. This is my playful and youthful voice.';
      case 'Zephyr': return 'Hello! I am Zephyr. This is my friendly and natural voice.';
      case 'Aarav': return 'Hey guys! In today’s video, we are going to look at the top three coolest new gadgets.';
      case 'Rohan': return 'Believe in yourself! If you can dream it, you can achieve it. Keep pushing!';
      case 'Fenrir': return 'Hello! I am Fenrir. This is my deep and heavy voice.';
      case 'Charon': return 'Hello! I am Charon. This is my mature and serious voice.';
      case 'Chiku': return 'Yahoo! Check out my super funny and playful cartoon voice!';
      default: return 'Hello! I am your AI voice helper.';
    }
  }
};

export default function App() {
  const [lang, setLang] = useState<'hi' | 'en'>('hi');
  const [activeTab, setActiveTab] = useState<'voice' | 'song'>('voice');
  
  // Voice generator tab states
  const [text, setText] = useState<string>('');
  const [selectedVoice, setSelectedVoice] = useState<string>('Kore');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationProgress, setGenerationProgress] = useState<number>(0);
  const [engine, setEngine] = useState<'cloud' | 'local'>('local');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioMimeType, setAudioMimeType] = useState<string>('audio/wav');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);

  // Preview character audio states
  const [previewVoice, setPreviewVoice] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [showSecretVoices, setShowSecretVoices] = useState<boolean>(false);

  // --- AI SONG CREATOR STATES ---
  const [songPrompt, setSongPrompt] = useState<string>('');
  const [songStyle, setSongStyle] = useState<MusicStyle>('dance');
  const [songDuration, setSongDuration] = useState<'short' | 'medium' | 'long'>('medium');
  const [songVoice, setSongVoice] = useState<string>('Kavya');
  const [isGeneratingSong, setIsGeneratingSong] = useState<boolean>(false);
  const [generatedSong, setGeneratedSong] = useState<{
    title: string;
    vibeDescription: string;
    lyricsSections: { type: string; text: string }[];
    vocalsText: string;
  } | null>(null);
  const [isSynthesizingVocals, setIsSynthesizingVocals] = useState<boolean>(false);
  const [songVocalsUrl, setSongVocalsUrl] = useState<string | null>(null);
  
  // Mixer states
  const [songMusicVolume, setSongMusicVolume] = useState<number>(0.4);
  const [songVocalsVolume, setSongVocalsVolume] = useState<number>(0.8);
  const [isSongPlaying, setIsSongPlaying] = useState<boolean>(false);
  const [recordedSongUrl, setRecordedSongUrl] = useState<string | null>(null);
  const [songError, setSongError] = useState<string | null>(null);
  const [isCreatingAndPlaying, setIsCreatingAndPlaying] = useState<boolean>(false);
  const [showLyricsDropdown, setShowLyricsDropdown] = useState<boolean>(false);

  // References
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  
  // Web Audio Mixer Refs
  const synthRef = useRef<SongSynthesizer | null>(null);
  const mixerCtxRef = useRef<AudioContext | null>(null);
  const vocalsSourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const vocalsGainNodeRef = useRef<GainNode | null>(null);
  const mixDestinationNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const songAudioElementRef = useRef<HTMLAudioElement | null>(null);

  const t = TRANSLATIONS[lang];

  // Initialize backing track synthesizer
  useEffect(() => {
    synthRef.current = new SongSynthesizer();
    return () => {
      if (synthRef.current) {
        synthRef.current.stop();
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop(); } catch (e) {}
      }
    };
  }, []);

  // Update music synthesizer volume live when slider changes
  useEffect(() => {
    if (synthRef.current) {
      synthRef.current.setVolume(songMusicVolume);
    }
  }, [songMusicVolume]);

  // Update vocals gain live when slider changes
  useEffect(() => {
    if (vocalsGainNodeRef.current && mixerCtxRef.current) {
      vocalsGainNodeRef.current.gain.setValueAtTime(songVocalsVolume, mixerCtxRef.current.currentTime);
    }
  }, [songVocalsVolume]);

  // Clean up preview audio on unmount
  useEffect(() => {
    return () => {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
      }
    };
  }, []);

  // Keep voice text empty by default so user can write instantly without clashing templates
  useEffect(() => {
    if (!text) {
      setText('');
    }
  }, [lang]);

  // Handle auto-playing main TTS
  useEffect(() => {
    if (audioUrl && audioRef.current) {
      audioRef.current.load();
      audioRef.current.play()
        .then(() => setIsPlaying(true))
        .catch((e) => {
          console.log("Auto-play blocked or failed:", e);
        });
    }
  }, [audioUrl]);

  // Revoke object URLs to avoid memory leaks
  useEffect(() => {
    const activeUrl = audioUrl;
    return () => {
      if (activeUrl) {
        URL.revokeObjectURL(activeUrl);
      }
    };
  }, [audioUrl]);

  useEffect(() => {
    const activeVocalsUrl = songVocalsUrl;
    return () => {
      if (activeVocalsUrl) {
        URL.revokeObjectURL(activeVocalsUrl);
      }
    };
  }, [songVocalsUrl]);

  useEffect(() => {
    const activeRecordUrl = recordedSongUrl;
    return () => {
      if (activeRecordUrl) {
        URL.revokeObjectURL(activeRecordUrl);
      }
    };
  }, [recordedSongUrl]);

  // Audio handlers for Voice Generator
  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        setPreviewVoice(null);
      }
      audioRef.current.play()
        .then(() => setIsPlaying(true))
        .catch((err) => {
          console.error("Audio playback error:", err);
          setError("प्लेबैक में समस्या आई (Playback failed)");
        });
    }
  };

  const playPreview = async (e: React.MouseEvent, voiceId: string) => {
    e.stopPropagation();
    
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }

    if (previewVoice === voiceId) {
      if (previewAudioRef.current && !previewAudioRef.current.paused) {
        previewAudioRef.current.pause();
      }
      setPreviewVoice(null);
      return;
    }

    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
      setPreviewVoice(null);
    }

    setSelectedVoice(voiceId);
    setSuccess(false);
    setPreviewLoading(voiceId);
    setError(null);

    const sampleText = getSampleText(voiceId, lang);

    try {
      const response = await fetch(getApiUrl('/api/tts'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: sampleText,
          voice: voiceId,
          language: lang,
          engine: engine,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error);
      }

      const blob = base64ToBlob(data.audio, data.mimeType || 'audio/mpeg');
      const blobUrl = URL.createObjectURL(blob);

      const audio = new Audio(blobUrl);
      previewAudioRef.current = audio;
      
      audio.onended = () => {
        setPreviewVoice(null);
        URL.revokeObjectURL(blobUrl);
      };

      audio.onerror = () => {
        setPreviewVoice(null);
        setError("प्रीव्यू लोड करने में समस्या आई (Preview playback failed)");
      };

      await audio.play();
      setPreviewVoice(voiceId);

    } catch (err: any) {
      console.error(err);
      setError(err.message || "प्रीव्यू तैयार करने में समस्या आई (Failed to generate preview)");
    } finally {
      setPreviewLoading(null);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Generate Voice for Voice Tab
  const generateVoice = async () => {
    if (!text.trim()) {
      setError(t.emptyWarning);
      return;
    }

    setIsGenerating(true);
    setGenerationProgress(1); // Reset and start from 1%
    setError(null);
    setWarning(null);
    setSuccess(false);

    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }

    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      setPreviewVoice(null);
    }

    // Smooth progressive percentage incrementer
    let progressVal = 1;
    const progressInterval = setInterval(() => {
      if (progressVal < 40) {
        progressVal += Math.floor(Math.random() * 6) + 4; // fast start
      } else if (progressVal < 75) {
        progressVal += Math.floor(Math.random() * 3) + 2; // steady climb
      } else if (progressVal < 95) {
        progressVal += 1; // slow down as it gets closer
      } else if (progressVal < 99) {
        // dynamic slow drag at the end
        if (Math.random() > 0.6) {
          progressVal += 1;
        }
      }
      if (progressVal > 99) {
        progressVal = 99;
      }
      setGenerationProgress(progressVal);
    }, 100);

    try {
      const response = await fetch(getApiUrl('/api/tts'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
          voice: selectedVoice,
          language: lang,
          engine: engine,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t.errorMsg);
      }

      // Complete progress smoothly to 100%
      clearInterval(progressInterval);
      setGenerationProgress(100);

      const blob = base64ToBlob(data.audio, data.mimeType || 'audio/mpeg');
      const blobUrl = URL.createObjectURL(blob);
      
      // Let the user admire the "100% Complete" state for a split second
      await new Promise(resolve => setTimeout(resolve, 400));

      setAudioUrl(blobUrl);
      setAudioMimeType(data.mimeType || 'audio/mpeg');
      setSuccess(true);

      if (data.warning) {
        setWarning(data.warning);
      }

    } catch (err: any) {
      clearInterval(progressInterval);
      console.error(err);
      setError(err.message || t.errorMsg);
    } finally {
      clearInterval(progressInterval);
      setIsGenerating(false);
    }
  };

  const triggerDownload = () => {
    if (!audioUrl) return;
    const a = document.createElement('a');
    a.href = audioUrl;
    const ext = audioMimeType.includes('wav') ? 'wav' : 'mp3';
    a.download = `voice-${selectedVoice}-${lang}-${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // --- SONG STUDIO ACTIONS ---

  // Complete one-click generation, synthesis, and synchronized playback!
  const handleCreateAndPlaySong = async () => {
    if (!songPrompt.trim()) {
      setSongError(lang === 'hi' ? "कृपया गीत का कोई विषय दर्ज करें!" : "Please write a song topic!");
      return;
    }

    setIsCreatingAndPlaying(true);
    setIsGeneratingSong(true);
    setSongError(null);
    setGeneratedSong(null);
    setSongVocalsUrl(null);
    setRecordedSongUrl(null);
    setIsSongPlaying(false);

    if (songAudioElementRef.current) {
      songAudioElementRef.current.pause();
      songAudioElementRef.current = null;
    }
    if (synthRef.current) {
      synthRef.current.stop();
    }

    try {
      // 1. Compose lyrics matching prompt
      const res = await fetch(getApiUrl('/api/generate-song'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: songPrompt,
          style: songStyle,
          duration: songDuration,
          language: lang
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Lyrics generation failed");
      }

      setGeneratedSong(data);

      // 2. Synthesize AI singer vocal track immediately
      setIsGeneratingSong(false); // Done with stage 1
      setIsSynthesizingVocals(true);

      const resTts = await fetch(getApiUrl('/api/tts'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: data.vocalsText,
          voice: songVoice,
          language: lang,
          engine: engine
        })
      });

      const dataTts = await resTts.json();
      if (!resTts.ok) {
        throw new Error(dataTts.error || "Vocals synthesis failed");
      }

      const blob = base64ToBlob(dataTts.audio, dataTts.mimeType || 'audio/mpeg');
      const blobUrl = URL.createObjectURL(blob);
      setSongVocalsUrl(blobUrl);
      setIsSynthesizingVocals(false); // Done with stage 2

      // 3. Auto-play the complete synchronized song mix!
      if (!mixerCtxRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        mixerCtxRef.current = new AudioContextClass({ sampleRate: 44100 });
      }

      const ctx = mixerCtxRef.current;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      if (!mixDestinationNodeRef.current) {
        mixDestinationNodeRef.current = ctx.createMediaStreamDestination();
      }

      const audio = new Audio(blobUrl);
      songAudioElementRef.current = audio;

      const source = ctx.createMediaElementSource(audio);
      const gain = ctx.createGain();

      source.connect(gain);
      gain.connect(ctx.destination);
      gain.connect(mixDestinationNodeRef.current);

      vocalsSourceNodeRef.current = source;
      vocalsGainNodeRef.current = gain;

      audio.onended = () => {
        stopSongPlayback();
      };

      // Set initial volumes
      vocalsGainNodeRef.current?.gain.setValueAtTime(songVocalsVolume, ctx.currentTime);

      const synthGain = ctx.createGain();
      synthGain.gain.setValueAtTime(songMusicVolume, ctx.currentTime);
      synthGain.connect(ctx.destination);
      synthGain.connect(mixDestinationNodeRef.current);

      if (synthRef.current) {
        synthRef.current.start(songStyle, ctx, synthGain);
      }

      recordedChunksRef.current = [];
      try {
        mediaRecorderRef.current = new MediaRecorder(mixDestinationNodeRef.current.stream, { mimeType: 'audio/webm;codecs=opus' });
      } catch (e) {
        mediaRecorderRef.current = new MediaRecorder(mixDestinationNodeRef.current.stream);
      }

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setRecordedSongUrl(url);
      };

      mediaRecorderRef.current.start();
      await audio.play();
      setIsSongPlaying(true);

    } catch (err: any) {
      console.error("Complete song automation error:", err);
      setSongError(err.message || (lang === 'hi' ? "गाने की धुन और आवाज़ तैयार करने में समस्या आई।" : "Failed to compose or play full song mix."));
    } finally {
      setIsGeneratingSong(false);
      setIsSynthesizingVocals(false);
      setIsCreatingAndPlaying(false);
    }
  };

  // Phase 1: Call server lyrics generation
  const handleGenerateSongLyrics = async () => {
    if (!songPrompt.trim()) {
      setSongError(lang === 'hi' ? "कृपया गीत का कोई विषय दर्ज करें!" : "Please write a song topic!");
      return;
    }

    setIsGeneratingSong(true);
    setSongError(null);
    setGeneratedSong(null);
    setSongVocalsUrl(null);
    setRecordedSongUrl(null);
    setIsSongPlaying(false);
    if (songAudioElementRef.current) {
      songAudioElementRef.current.pause();
      songAudioElementRef.current = null;
    }
    if (synthRef.current) {
      synthRef.current.stop();
    }

    try {
      const res = await fetch(getApiUrl('/api/generate-song'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: songPrompt,
          style: songStyle,
          duration: songDuration,
          language: lang
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Lyrics generation failed");
      }

      setGeneratedSong(data);
    } catch (err: any) {
      console.error("Song Lyrics Error:", err);
      setSongError(err.message || (lang === 'hi' ? "गीत लिखने में समस्या आई। कृपया पुनः प्रयास करें।" : "Failed to compose song. Please try again."));
    } finally {
      setIsGeneratingSong(false);
    }
  };

  // Update generated lyrics in real time if user edits them
  const handleLyricsChange = (sectionIdx: number, newText: string) => {
    if (!generatedSong) return;
    const updatedSections = [...generatedSong.lyricsSections];
    updatedSections[sectionIdx].text = newText;

    // recompile vocalsText
    const newVocalsText = updatedSections
      .map(s => s.text)
      .join(' ');

    setGeneratedSong({
      ...generatedSong,
      lyricsSections: updatedSections,
      vocalsText: newVocalsText
    });
    
    // clear previous synthesized vocals as lyrics changed
    setSongVocalsUrl(null);
    setRecordedSongUrl(null);
  };

  // Phase 2: Synthesize vocals using existing TTS API
  const handleSynthesizeVocals = async () => {
    if (!generatedSong) return;

    setIsSynthesizingVocals(true);
    setSongError(null);
    setRecordedSongUrl(null);

    try {
      const res = await fetch(getApiUrl('/api/tts'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: generatedSong.vocalsText,
          voice: songVoice,
          language: lang,
          engine: engine // reuse local/cloud engine
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Vocals synthesis failed");
      }

      const blob = base64ToBlob(data.audio, data.mimeType || 'audio/mpeg');
      const blobUrl = URL.createObjectURL(blob);
      setSongVocalsUrl(blobUrl);

      // Reset audio element to bind to new vocals
      if (songAudioElementRef.current) {
        songAudioElementRef.current.pause();
        songAudioElementRef.current = null;
      }
    } catch (err: any) {
      console.error("Vocals Synthesis Error:", err);
      setSongError(lang === 'hi' ? "आवाज़ संश्लेषित करने में त्रुटि।" : "Vocals synthesis error.");
    } finally {
      setIsSynthesizingVocals(false);
    }
  };

  // Phase 3: Play mixed backing synthesizer + vocal track
  const handlePlaySongMix = async () => {
    if (!songVocalsUrl) return;

    if (isSongPlaying) {
      stopSongPlayback();
      return;
    }

    try {
      // Lazy init mixer AudioContext
      if (!mixerCtxRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        mixerCtxRef.current = new AudioContextClass({ sampleRate: 44100 });
      }

      const ctx = mixerCtxRef.current;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      // Prepare recording destination node
      if (!mixDestinationNodeRef.current) {
        mixDestinationNodeRef.current = ctx.createMediaStreamDestination();
      }

      // Set up vocals audio element if not exist
      if (!songAudioElementRef.current) {
        const audio = new Audio(songVocalsUrl);
        songAudioElementRef.current = audio;

        // Route: Audio Element -> Gain Node -> destination (speakers) & recorder destination
        const source = ctx.createMediaElementSource(audio);
        const gain = ctx.createGain();

        source.connect(gain);
        gain.connect(ctx.destination);
        gain.connect(mixDestinationNodeRef.current);

        vocalsSourceNodeRef.current = source;
        vocalsGainNodeRef.current = gain;

        // bind ending trigger
        audio.onended = () => {
          stopSongPlayback();
        };
      }

      // Set volumes
      vocalsGainNodeRef.current?.gain.setValueAtTime(songVocalsVolume, ctx.currentTime);

      // Connect synthesizer to speakers and recorder
      const synthGain = ctx.createGain();
      synthGain.gain.setValueAtTime(songMusicVolume, ctx.currentTime);
      synthGain.connect(ctx.destination);
      synthGain.connect(mixDestinationNodeRef.current);

      if (synthRef.current) {
        synthRef.current.start(songStyle, ctx, synthGain);
      }

      // Initialize recorder automatically in background for complete song mix
      recordedChunksRef.current = [];
      let mimeOptions = {};
      try {
        mediaRecorderRef.current = new MediaRecorder(mixDestinationNodeRef.current.stream, { mimeType: 'audio/webm;codecs=opus' });
      } catch (e) {
        mediaRecorderRef.current = new MediaRecorder(mixDestinationNodeRef.current.stream);
      }

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setRecordedSongUrl(url);
      };

      // Start playbacks
      mediaRecorderRef.current.start();
      await songAudioElementRef.current.play();
      setIsSongPlaying(true);

    } catch (err: any) {
      console.error("Playback start failed:", err);
      setSongError(lang === 'hi' ? "प्लेबैक शुरू करने में समस्या आई।" : "Playback start failed.");
    }
  };

  const stopSongPlayback = () => {
    if (songAudioElementRef.current) {
      songAudioElementRef.current.pause();
    }
    if (synthRef.current) {
      synthRef.current.stop();
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch (e) {}
    }
    setIsSongPlaying(false);
  };

  // Download song outputs
  const handleDownloadVocalsOnly = () => {
    if (!songVocalsUrl) return;
    const a = document.createElement('a');
    a.href = songVocalsUrl;
    a.download = `vocals-${songVoice}-${songStyle}-${Date.now()}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDownloadMixedSong = () => {
    if (!recordedSongUrl) return;
    const a = document.createElement('a');
    a.href = recordedSongUrl;
    a.download = `song-mix-${songStyle}-${Date.now()}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const memoizedVoicesGrid = useMemo(() => {
    if (!showSecretVoices) return null;
    return (
      <div className="pt-3 border-t border-slate-200/50 space-y-3" id="character_select_area">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" id="voice_characters_grid">
          {VOICES.map((v) => {
            const charInfo = t.characters[v.id as keyof typeof t.characters] || { name: v.id, desc: '', tone: '' };
            const isSelected = selectedVoice === v.id;
            
            return (
              <div
                key={v.id}
                id={`voice_card_${v.id}`}
                onClick={() => {
                  setSelectedVoice(v.id);
                  setSuccess(false);
                }}
                role="button"
                tabIndex={0}
                className={`p-3 rounded-xl border text-left transition-all duration-200 flex flex-col justify-between h-24 relative overflow-hidden group cursor-pointer ${
                  isSelected
                    ? 'border-indigo-600 bg-indigo-50/20 shadow-xs ring-2 ring-indigo-600/10'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-xs'
                }`}
              >
                <div className="flex justify-between items-start w-full">
                  <div className={`px-1.5 py-0.5 rounded font-extrabold text-[10px] uppercase ${v.color}`}>
                    {v.id.substring(0, 2)}
                  </div>
                  {isSelected ? (
                    <span className="p-0.5 bg-indigo-600 text-white rounded-full">
                      <Check className="w-2.5 h-2.5" />
                    </span>
                  ) : (
                    <span className="text-[9px] uppercase font-bold tracking-wider text-slate-400">
                      {t.pitchLabels[v.pitch]}
                    </span>
                  )}
                </div>

                <div className="mt-1 flex items-center gap-1.5">
                  <button
                    id={`preview_btn_${v.id}`}
                    onClick={(e) => playPreview(e, v.id)}
                    className={`w-5 h-5 rounded-full flex items-center justify-center transition-all shrink-0 ${
                      previewVoice === v.id
                        ? 'bg-indigo-600 text-white shadow-md scale-105'
                        : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-600'
                    }`}
                    title="आवाज़ सुनें"
                  >
                    {previewLoading === v.id ? (
                      <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                    ) : previewVoice === v.id ? (
                      <Pause className="w-2.5 h-2.5 fill-current" />
                    ) : (
                      <Play className="w-2 h-2 fill-current ml-0.5" />
                    )}
                  </button>
                  <div className="truncate">
                    <div className="font-bold text-slate-900 text-xs truncate leading-tight">{charInfo.name}</div>
                    <div className="text-[10px] text-slate-400 truncate leading-tight mt-0.5">{charInfo.tone}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }, [showSecretVoices, selectedVoice, previewVoice, previewLoading, lang, t, playPreview]);


  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col justify-between selection:bg-indigo-100 selection:text-indigo-900" id="app_root">
      
      {/* Invisible HTML5 Audio Element for Voice Generator */}
      {audioUrl && (
        <audio 
          ref={audioRef} 
          src={audioUrl}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleAudioEnded}
          onError={() => {
            console.error("Audio element playback error for URL:", audioUrl);
            setError("प्लेबैक में समस्या आई (Audio playback failed. Please try again.)");
          }}
        />
      )}

      {/* Modern Navigation Header Bar */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-100 px-4 py-3 shadow-xs" id="app_header">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-3">
          
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-indigo-600 text-white rounded-lg" id="header_logo">
              <Volume2 className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <span className="font-bold text-slate-950 text-base flex items-center gap-1.5">
                {t.title} <Sparkles className="w-3.5 h-3.5 text-amber-500 fill-amber-400" />
              </span>
            </div>
          </div>

          {/* Languages controls */}
          <div className="flex bg-slate-100 p-0.5 rounded-lg shrink-0" id="header_lang_toggle">
            <button
              id="header_lang_hi"
              onClick={() => setLang('hi')}
              className={`px-2 py-1 text-[10px] font-bold rounded-md transition-all ${
                lang === 'hi' ? 'bg-white text-slate-950 shadow-xs' : 'text-slate-500 hover:text-slate-950'
              }`}
            >
              हिन्दी
            </button>
            <button
              id="header_lang_en"
              onClick={() => setLang('en')}
              className={`px-2 py-1 text-[10px] font-bold rounded-md transition-all ${
                lang === 'en' ? 'bg-white text-slate-950 shadow-xs' : 'text-slate-500 hover:text-slate-950'
              }`}
            >
              EN
            </button>
          </div>

        </div>
      </header>

      {/* Main Screen Content Body */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-6 md:py-10 flex flex-col justify-start" id="app_main_content">
        
        <div className="bg-white border border-slate-100 shadow-xl rounded-2xl p-6 md:p-8 space-y-6 animate-fade-in" id="voice_screen">
            
            {/* Main Text input */}
            <div className="space-y-2" id="input_wrapper">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <PenTool className="w-3.5 h-3.5 text-indigo-600" />
                  {lang === 'hi' ? 'अपना टेक्स्ट लिखें' : 'Write text to speak'}
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-extrabold bg-indigo-50 text-indigo-700 px-2 py-1 rounded-md border border-indigo-100/50 shadow-xs" id="word_char_count_badge">
                    {lang === 'hi' 
                      ? `${text.trim() ? text.trim().split(/\s+/).length : 0} शब्द / ${text.length} अक्षर` 
                      : `${text.trim() ? text.trim().split(/\s+/).length : 0} words / ${text.length} chars`}
                  </span>
                  {text && (
                    <button
                      id="clear_text_btn"
                      onClick={() => setText('')}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                      title={t.clearTooltip}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <textarea
                id="voice_text_input"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (error) setError(null);
                }}
                placeholder={t.placeholder}
                rows={4}
                className="w-full p-4 text-slate-800 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 transition-all text-sm leading-relaxed"
              />
            </div>

            {/* Dynamic Real-time Percentage Progress Panel */}
            {isGenerating && (
              <div 
                className="p-5 bg-gradient-to-br from-indigo-50/70 to-purple-50/40 border border-indigo-100 rounded-2xl space-y-3 animate-pulse"
                id="generation_progress_card"
              >
                <div className="flex justify-between items-center text-xs font-bold text-indigo-950">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-indigo-600 animate-spin" />
                    <span>
                      {lang === 'hi' 
                        ? '🔒 उत्कृष्ट एआई आवाज तैयार हो रही है...' 
                        : '🔒 Generating Premium AI Voice...'}
                    </span>
                  </div>
                  <span className="text-sm font-black text-indigo-700 font-mono tracking-wider">
                    {generationProgress}%
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-slate-200/80 h-3 rounded-full overflow-hidden" id="progress_bar_outer">
                  <div 
                    className="bg-gradient-to-r from-indigo-500 via-purple-500 to-indigo-600 h-full rounded-full transition-all duration-150 ease-out"
                    style={{ width: `${generationProgress}%` }}
                    id="progress_bar_inner"
                  />
                </div>

                {/* Dynamic estimates based on progress percentage */}
                <div className="flex justify-between items-center text-[10px] text-slate-500 font-medium">
                  <span>
                    {lang === 'hi' 
                      ? 'अनुमानित समय: ~3 से 5 सेकंड' 
                      : 'Estimated time: ~3 to 5 seconds'}
                  </span>
                  <span>
                    {generationProgress === 100 
                      ? (lang === 'hi' ? '✨ पूरा हुआ!' : '✨ Completed!') 
                      : (lang === 'hi' ? 'प्रगति पर है...' : 'Processing...')}
                  </span>
                </div>
              </div>
            )}

            {/* Synthesis and Download controls (Now placed at the top, right below the prompt text input and phrases!) */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2 bg-slate-50/50 p-4 border border-slate-100 rounded-2xl" id="action_controls">
              
              <button
                id="generate_voice_submit"
                onClick={generateVoice}
                disabled={isGenerating || !text.trim()}
                className={`px-6 py-3 rounded-xl text-xs font-black flex items-center justify-center gap-2 transition-all cursor-pointer ${
                  isGenerating 
                    ? 'bg-indigo-100 text-indigo-400 cursor-not-allowed'
                    : !text.trim()
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md hover:shadow-lg active:scale-98'
                }`}
              >
                {isGenerating ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>{t.generating}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5 text-amber-300 fill-amber-300" />
                    <span>{t.generateBtn}</span>
                  </>
                )}
              </button>

              {/* Audio controller (if compiled) */}
              {audioUrl && (
                <div className="flex items-center gap-2 bg-white border border-slate-200 p-2 rounded-xl flex-1 justify-between shadow-xs" id="voice_player_bar">
                  <div className="flex items-center gap-2">
                    <button
                      id="voice_play_toggle"
                      onClick={togglePlay}
                      className="w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center shadow-xs transition-all cursor-pointer"
                    >
                      {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5 fill-current" />}
                    </button>
                    <div className="text-[10px] text-slate-500 font-bold min-w-[50px]">
                      {formatTime(currentTime)} / {formatTime(duration)}
                    </div>
                  </div>
                  <input
                    type="range"
                    id="voice_seek_bar"
                    min={0}
                    max={duration || 100}
                    value={currentTime}
                    onChange={handleSeek}
                    className="flex-1 max-w-[120px] sm:max-w-none h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                  />
                  <button
                    id="voice_download_btn"
                    onClick={triggerDownload}
                    className="p-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-xl transition-all cursor-pointer"
                    title={t.downloadBtn}
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

            </div>

            {/* Error / Warning display */}
            {error && (
              <div className="p-3.5 bg-rose-50 border border-rose-100 text-rose-800 text-xs rounded-xl flex items-center gap-2" id="error_banner">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {warning && (
              <div className="p-3.5 bg-amber-50 border border-amber-100 text-amber-800 text-xs rounded-xl flex items-center gap-2" id="warning_banner">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>{warning}</span>
              </div>
            )}

            {success && (
              <div className="p-3.5 bg-emerald-50 border border-emerald-100 text-emerald-800 text-xs rounded-xl flex items-center gap-2" id="success_banner">
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{t.successMsg}</span>
              </div>
            )}

            {/* Collapsible Secret Settings for character selection */}
            <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-4 space-y-3" id="secret_settings_container">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-indigo-100 text-indigo-700 rounded-lg">
                    <User className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-slate-800 uppercase tracking-wide">
                      {lang === 'hi' ? '🔒 खुफिया आवाज़ सेटिंग्स' : '🔒 Secret Voice Settings'}
                    </h4>
                    <p className="text-[10px] text-slate-500 font-medium">
                      {lang === 'hi' 
                        ? `चयनित: ${t.characters[selectedVoice as keyof typeof t.characters]?.name || selectedVoice}`
                        : `Selected: ${t.characters[selectedVoice as keyof typeof t.characters]?.name || selectedVoice}`}
                    </p>
                  </div>
                </div>
                <button
                  id="toggle_secret_voices_btn"
                  onClick={() => setShowSecretVoices(!showSecretVoices)}
                  className="px-4 py-2 bg-white hover:bg-slate-100 text-indigo-600 hover:text-indigo-700 border border-slate-200 text-[11px] font-black rounded-xl transition-all shadow-xs cursor-pointer"
                >
                  {showSecretVoices 
                    ? (lang === 'hi' ? 'सेटिंग्स छुपाएं' : 'Hide Settings') 
                    : (lang === 'hi' ? 'बदले / खोलें' : 'Change / Open')}
                </button>
              </div>

              {memoizedVoicesGrid}
            </div>

          </div>



      </main>

      {/* Footer copyright */}
      <footer className="py-6 border-t border-slate-100 text-center text-xs text-slate-400" id="app_footer">
        © 2026 {TRANSLATIONS[lang].title} · Powered by Google Gemini AI & Web Audio API
      </footer>
    </div>
  );
}
