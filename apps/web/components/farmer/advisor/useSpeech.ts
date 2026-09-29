"use client";

/**
 * Web Speech API voice input (SpeechRecognition / webkitSpeechRecognition).
 * Language follows the UI locale (e.g. bn → bn-BD, vi → vi-VN). Degrades
 * gracefully: `supported` is false where the API is missing (Firefox, iOS WebView).
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type Ctor = new () => RecognitionLike;

export function useSpeech(lang: string, onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<RecognitionLike | null>(null);
  const cb = useRef(onFinal);
  cb.current = onFinal;

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
    setSupported(!!(w.SpeechRecognition ?? w.webkitSpeechRecognition));
    return () => rec.current?.abort();
  }, []);

  const start = useCallback(() => {
    const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
    const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!C) return setSupported(false);
    rec.current?.abort();
    const r = new C();
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    let finalText = "";
    r.onresult = (e) => {
      let tmp = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) finalText += res[0]!.transcript;
        else tmp += res[0]!.transcript;
      }
      setInterim(finalText + tmp);
    };
    r.onerror = (e) => {
      setError(e.error);
      setListening(false);
    };
    r.onend = () => {
      setListening(false);
      setInterim("");
      if (finalText.trim()) cb.current(finalText.trim());
    };
    rec.current = r;
    setError(null);
    setListening(true);
    try {
      r.start();
    } catch {
      setListening(false);
    }
  }, [lang]);

  const stop = useCallback(() => rec.current?.stop(), []);

  return { supported, listening, interim, error, start, stop };
}
