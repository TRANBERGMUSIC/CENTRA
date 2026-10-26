/**
 * Speech to text for Assist. Uses the system's speech recognition in Danish when the web view offers
 * it; otherwise the Mac's own dictation (fn fn) writes straight into the text field.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const SR: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : undefined;
export const MAC_DICTATION_TIP = 'Tal i stedet med Mac\'ens egen diktering: tryk to gange på fn-tasten (🌐), og tal. Teksten kommer direkte i feltet. Slå den til under Systemindstillinger → Tastatur → Diktering, hvis der ikke sker noget.';

export function useDictation(onText: (text: string, final: boolean) => void, onUnavailable: () => void) {
  const [listening, setListening] = useState(false);
  const rec = useRef<any>(null);
  const cb = useRef(onText); cb.current = onText;
  const un = useRef(onUnavailable); un.current = onUnavailable;

  const stop = useCallback(() => { rec.current?.stop(); }, []);
  const start = useCallback(() => {
    if (!SR) return un.current();
    try {
      const r = new SR();
      r.lang = 'da-DK'; r.interimResults = true; r.continuous = true;
      let finalText = '';
      r.onresult = (ev: any) => {
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const t = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) finalText += t; else interim += t;
        }
        cb.current((finalText + interim).trim(), false);
      };
      r.onerror = (ev: any) => {
        setListening(false);
        if (['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'].includes(ev.error)) un.current();
      };
      r.onend = () => { setListening(false); cb.current(finalText.trim(), true); rec.current = null; };
      r.start();
      rec.current = r;
      setListening(true);
    } catch {
      setListening(false);
      un.current();
    }
  }, []);

  useEffect(() => () => rec.current?.abort?.(), []);
  return { listening, start, stop, toggle: () => (rec.current ? stop() : start()) };
}
