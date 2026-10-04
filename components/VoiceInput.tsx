"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = any;

const getCtor = (): (new () => Rec) | null =>
  typeof window === "undefined" ? null : ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null);

/**
 * Диктовка: говорите — текст дописывается в описание. Распознавание делает сам браузер
 * (Safari на iPhone, Chrome на Android/ПК). Если браузер не умеет — кнопки просто нет.
 */
export function VoiceButton({ onText }: { onText: (text: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [on, setOn] = useState(false);
  const rec = useRef<Rec>(null);
  const cb = useRef(onText);
  cb.current = onText;

  useEffect(() => {
    setSupported(Boolean(getCtor()));
    return () => rec.current?.abort?.();
  }, []);
  if (!supported) return null;

  function toggle() {
    if (on) {
      rec.current?.stop();
      return;
    }
    const Ctor = getCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "ru-RU";
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e: any) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript;
      if (text.trim()) cb.current(text.trim());
    };
    r.onerror = (e: any) => {
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") alert("Разрешите доступ к микрофону, чтобы диктовать.");
      setOn(false);
    };
    r.onend = () => setOn(false);
    rec.current = r;
    try {
      r.start();
      setOn(true);
    } catch {
      setOn(false);
    }
  }

  return (
    <button type="button" className={`voiceBtn ${on ? "on" : ""}`} onClick={toggle} aria-label={on ? "Остановить диктовку" : "Надиктовать"}>
      <Icon name="audio" size={18} /> {on ? "Слушаю… нажмите, чтобы закончить" : "Надиктовать"}
    </button>
  );
}

/** Дописывает фразу к тексту с пробелом и заглавной буквой. */
export const appendSpoken = (prev: string, text: string) => {
  const t = text.charAt(0).toUpperCase() + text.slice(1);
  if (!prev.trim()) return t;
  return `${prev.trimEnd()}${/[.!?…]$/.test(prev.trim()) ? " " : ". "}${t}`;
};
