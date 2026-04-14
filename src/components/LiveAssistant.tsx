import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";
import { Button } from '@/components/ui/button';
import { Mic, MicOff, Loader2, Sparkles, Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LiveAssistantProps {
  onDeckCreated: (deck: any) => void;
}

export function LiveAssistant({ onDeckCreated }: LiveAssistantProps) {
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcription, setTranscription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<any>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const isPlayingRef = useRef(false);

  const startSession = async () => {
    setIsConnecting(true);
    setError(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      const session = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: `You are Jarvis, the NEET Prep AI Assistant. Your goal is to help users create high-quality study decks for the NEET exam.
          You communicate via voice. Discuss topics, explain concepts, and suggest flashcard ideas.
          When the user is ready to create a deck, you should provide a JSON response containing the deck title, description, and a list of flashcards.
          
          Format for creating a deck (send this as a text part in your response):
          {
            "type": "create_deck",
            "title": "Deck Title",
            "description": "Deck Description",
            "cards": [
              { "question": "...", "answer": "...", "type": "theory" | "question" }
            ]
          }
          
          Always confirm with the user before creating the deck.`,
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setIsConnecting(false);
            setIsActive(true);
            startMic();
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle audio output
            const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData) {
              const binary = atob(audioData);
              const buffer = new Int16Array(binary.length / 2);
              for (let i = 0; i < buffer.length; i++) {
                buffer[i] = (binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8));
              }
              audioQueueRef.current.push(buffer);
              if (!isPlayingRef.current) {
                playNextInQueue();
              }
            }

            // Handle transcription
            const text = message.serverContent?.modelTurn?.parts?.[0]?.text;
            if (text) {
              // Check for deck creation JSON
              const jsonMatch = text.match(/\{[\s\S]*"type":\s*"create_deck"[\s\S]*\}/);
              if (jsonMatch) {
                try {
                  const deckData = JSON.parse(jsonMatch[0]);
                  onDeckCreated(deckData);
                } catch (e) {
                  console.error("Failed to parse deck JSON", e);
                }
              }
            }

            if (message.serverContent?.interrupted) {
              audioQueueRef.current = [];
              isPlayingRef.current = false;
            }
          },
          onclose: () => {
            stopSession();
          },
          onerror: (err) => {
            console.error("Live API Error:", err);
            setError("Connection error. Please try again.");
            stopSession();
          }
        }
      });

      sessionRef.current = session;
    } catch (err) {
      console.error("Failed to connect:", err);
      setError("Failed to start session. Check your microphone permissions.");
      setIsConnecting(false);
    }
  };

  const startMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!sessionRef.current) return;

        const inputData = e.inputBuffer.getChannelData(0);
        // Convert to 16-bit PCM
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
        }

        // Convert to Base64
        const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
        sessionRef.current.sendRealtimeInput({
          audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
        });
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
    } catch (err) {
      console.error("Mic error:", err);
      setError("Microphone access denied.");
    }
  };

  const playNextInQueue = async () => {
    if (audioQueueRef.current.length === 0 || !audioContextRef.current) {
      isPlayingRef.current = false;
      setIsSpeaking(false);
      return;
    }

    isPlayingRef.current = true;
    setIsSpeaking(true);
    const pcmData = audioQueueRef.current.shift()!;
    
    const audioBuffer = audioContextRef.current.createBuffer(1, pcmData.length, 24000);
    const channelData = audioBuffer.getChannelData(0);
    for (let i = 0; i < pcmData.length; i++) {
      channelData[i] = pcmData[i] / 0x7FFF;
    }

    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContextRef.current.destination);
    source.onended = playNextInQueue;
    source.start();
  };

  const stopSession = () => {
    setIsActive(false);
    setIsConnecting(false);
    setIsSpeaking(false);
    
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    audioQueueRef.current = [];
    isPlayingRef.current = false;
  };

  useEffect(() => {
    startSession();
    return () => stopSession();
  }, []);

  return (
    <div className="flex flex-col items-center justify-center space-y-8 py-12 px-6 h-full">
      <div className="relative">
        <div className={cn(
          "w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500",
          isActive ? "bg-teal-600 shadow-2xl shadow-teal-500/50" : "bg-slate-100",
          isSpeaking && "scale-110"
        )}>
          {isConnecting ? (
            <Loader2 className="w-12 h-12 text-teal-600 animate-spin" />
          ) : isActive ? (
            <Mic className="w-12 h-12 text-white animate-pulse" />
          ) : (
            <MicOff className="w-12 h-12 text-slate-400" />
          )}
        </div>
        
        {isSpeaking && (
          <div className="absolute -inset-4 rounded-full border-4 border-teal-400/30 animate-ping" />
        )}
      </div>

      <div className="text-center space-y-2">
        <h3 className="text-xl font-bold text-slate-900">
          {isActive ? "Jarvis is Listening..." : isConnecting ? "Connecting to Jarvis..." : "Jarvis AI"}
        </h3>
        <p className="text-slate-500 text-sm max-w-xs mx-auto">
          {isActive 
            ? "Talk to me about any NEET topic. I'll help you build your study deck."
            : isConnecting ? "Please wait while I wake up..." : "Click below to reconnect."}
        </p>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 text-xs p-3 rounded-lg border border-red-100">
          {error}
        </div>
      )}

      <div className="pt-4">
        {!isActive && !isConnecting ? (
          <Button 
            size="lg" 
            className="rounded-full px-8 bg-teal-600 hover:bg-teal-700 h-14 text-base font-semibold shadow-lg shadow-teal-200"
            onClick={startSession}
          >
            Reconnect to Jarvis
          </Button>
        ) : (
          <Button 
            variant="outline" 
            size="lg" 
            className="rounded-full px-8 h-14 text-base font-semibold border-red-200 text-red-600 hover:bg-red-50"
            onClick={stopSession}
            disabled={isConnecting}
          >
            End Session
          </Button>
        )}
      </div>

      {isActive && (
        <div className="flex items-center gap-2 text-xs font-medium text-teal-600 bg-teal-50 px-3 py-1.5 rounded-full animate-bounce">
          <Sparkles className="w-3 h-3" />
          Live Session Active
        </div>
      )}
    </div>
  );
}
