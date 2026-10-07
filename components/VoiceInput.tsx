"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = any;

const getCtor = (): (new () => Rec) | null =>
  typeof window === "undefined" ? null : ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null);

const KEYBOARD_HINT = "Можно нажать на поле описания и продиктовать через микрофон на клавиатуре.";

/**
 * Диктовка: говорите — текст дописывается в описание. Распознавание делает сам браузер
 * (Safari на iPhone, Chrome на Android/ПК). Если браузер не умеет — кнопки просто нет.
 *
 * Safari на iPhone часто не помечает фразу как «окончательную» и просто завершает распознавание,
 * поэтому мы держим промежуточный текст и дописываем его, когда распознавание закончилось
 * (в том числе по нажатию «закончить»). Так ничего из сказанного не теряется.
 */
export function VoiceButton({ onText }: { onText: (text: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [on, setOn] = useState(false);
  const [live, setLive] = useState("");
  const [note, setNote] = useState("");
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
      try {
        rec.current?.stop();
      } catch {
        /* уже остановлено */
      }
      return;
    }
    const Ctor = getCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "ru-RU";
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    let sentUpTo = 0; // сколько результатов уже дописано в текст
    let pending = ""; // распознанное, но ещё не дописанное
    let gotAny = false;
    let errored = false;
    let ended = false;

    const commit = (text: string) => {
      const t = text.replace(/\s+/g, " ").trim();
      if (!t) return;
      gotAny = true;
      cb.current(t);
    };

    r.onresult = (e: any) => {
      if (ended) return;
      let finals = "";
      let interim = "";
      for (let i = sentUpTo; i < e.results.length; i++) {
        const res = e.results[i];
        const tr = res[0]?.transcript ?? "";
        if (res.isFinal && i === sentUpTo) {
          finals += ` ${tr}`;
          sentUpTo = i + 1;
        } else interim += ` ${tr}`;
      }
      if (finals.trim()) commit(finals);
      pending = interim.trim();
      setLive(pending);
    };
    r.onerror = (e: any) => {
      const code = e?.error;
      if (code === "aborted") return;
      if (code === "no-speech") {
        setNote("Не расслышал. Нажмите ещё раз и говорите чуть громче.");
        return;
      }
      errored = true;
      if (code === "not-allowed" || code === "service-not-allowed")
        setNote(`Нет доступа к распознаванию речи. Разрешите микрофон в настройках браузера. ${KEYBOARD_HINT}`);
      else if (code === "network") setNote(`Распознавание речи требует интернет. ${KEYBOARD_HINT}`);
      else if (code === "audio-capture") setNote(`Микрофон недоступен. ${KEYBOARD_HINT}`);
      else setNote(`Не получилось распознать речь. ${KEYBOARD_HINT}`);
    };
    r.onend = () => {
      if (ended) return;
      ended = true;
      if (pending) commit(pending);
      pending = "";
      setLive("");
      setOn(false);
      if (!gotAny && !errored) setNote((n) => n || `Текст не распознан. ${KEYBOARD_HINT}`);
    };
    rec.current = r;
    setNote("");
    setLive("");
    try {
      r.start();
      setOn(true);
    } catch {
      setOn(false);
      setNote(`Не удалось включить диктовку. ${KEYBOARD_HINT}`);
    }
  }

  return (
    <>
      <button type="button" className={`voiceBtn ${on ? "on" : ""}`} onClick={toggle} aria-label={on ? "Остановить диктовку" : "Надиктовать"}>
        <Icon name="audio" size={18} /> {on ? "Слушаю… нажмите, чтобы закончить" : "Надиктовать"}
      </button>
      {on && live && <span className="voiceLive">{live}</span>}
      {!on && note && <span className="voiceNote">{note}</span>}
    </>
  );
}

/** Дописывает фразу к тексту с пробелом и заглавной буквой. */
export const appendSpoken = (prev: string, text: string) => {
  const t = text.charAt(0).toUpperCase() + text.slice(1);
  if (!prev.trim()) return t;
  return `${prev.trimEnd()}${/[.!?…]$/.test(prev.trim()) ? " " : ". "}${t}`;
};
