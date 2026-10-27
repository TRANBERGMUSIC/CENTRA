/**
 * Speech to text for Assist, using the system's speech recognition (Apple's, in the Mac app) in Danish.
 * Before listening it asks for the microphone itself, so macOS shows its permission prompt and a
 * refusal can be told apart from a recognition problem. Every way it can stop early ends in a
 * plain explanation and, where it helps, a button straight to the right pane in System Settings.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const SR: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : undefined;
const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);
export const MAC_DICTATION_TIP = 'Indtil da kan du tale med Mac\'ens egen diktering: tryk to gange på fn-tasten (🌐) og tal. Teksten kommer direkte i feltet.';

export type DictationProblem = { title: string; text: string; settings?: string; code: string };

const PANES = {
  mic: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  speech: 'x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition',
  keyboard: 'x-apple.systempreferences:com.apple.preference.keyboard?Dictation',
  sound: 'x-apple.systempreferences:com.apple.preference.sound?input',
};

/** Turns an error code from the browser or WebKit into something a person can act on. */
export function explainDictation(code: string): DictationProblem {
  switch (code) {
    case 'mic-denied': case 'not-allowed':
      return { code, title: 'CENTRA må ikke bruge mikrofonen', text: `Slå CENTRA til under Systemindstillinger → Anonymitet og sikkerhed → Mikrofon, og genstart CENTRA. ${MAC_DICTATION_TIP}`, settings: isMac ? PANES.mic : undefined };
    case 'service-not-allowed':
      return { code, title: 'Talegenkendelse er slået fra', text: `Slå CENTRA til under Systemindstillinger → Anonymitet og sikkerhed → Talegenkendelse. Diktering skal også være slået til under Tastatur. ${MAC_DICTATION_TIP}`, settings: isMac ? PANES.speech : undefined };
    case 'no-mic': case 'audio-capture':
      return { code, title: 'Ingen mikrofon fundet', text: 'Tjek at en mikrofon er valgt under Systemindstillinger → Lyd → Input.', settings: isMac ? PANES.sound : undefined };
    case 'no-speech':
      return { code, title: 'Jeg hørte ikke noget', text: 'Tal lidt tættere på, og tjek at den rigtige mikrofon er valgt under Systemindstillinger → Lyd → Input.', settings: isMac ? PANES.sound : undefined };
    case 'network':
      return { code, title: 'Talegenkendelse kræver internet', text: `Apple laver talen om til tekst, så Mac'en skal være online. ${MAC_DICTATION_TIP}` };
    case 'language-not-supported':
      return { code, title: 'Dansk tale er ikke slået til', text: `Tilføj dansk under Systemindstillinger → Tastatur → Diktering → Sprog. ${MAC_DICTATION_TIP}`, settings: isMac ? PANES.keyboard : undefined };
    case 'aborted':
      return { code, title: 'macOS afbrød talegenkendelsen', text: `Det sker typisk, når CENTRA ikke har fået lov til talegenkendelse eller mikrofon. Tjek begge under Systemindstillinger → Anonymitet og sikkerhed. ${MAC_DICTATION_TIP}`, settings: isMac ? PANES.speech : undefined };
    case 'unsupported':
      return { code, title: 'Tale virker ikke her', text: MAC_DICTATION_TIP };
    default:
      return { code, title: 'Talegenkendelsen stoppede med det samme', text: `Prøv igen. Virker det stadig ikke, kan du tale med Mac'ens egen diktering: tryk to gange på fn-tasten (🌐) og tal. Skriv gerne fejlkoden til mig: ${code}`, settings: isMac ? PANES.keyboard : undefined };
  }
}

/** Asks for the microphone once, so macOS shows its prompt; releases it again right away. */
async function micCheck(): Promise<string | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null; // let speech recognition ask on its own
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    return null;
  } catch (e) {
    const n = (e as DOMException)?.name;
    return n === 'NotAllowedError' || n === 'SecurityError' ? 'mic-denied' : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'no-mic' : null;
  }
}

export function useDictation(onText: (text: string, final: boolean) => void, onProblem: (p: DictationProblem) => void) {
  const [listening, setListening] = useState(false);
  const rec = useRef<any>(null);
  const starting = useRef(false);
  const userStop = useRef(false);
  const cb = useRef(onText); cb.current = onText;
  const un = useRef(onProblem); un.current = onProblem;

  const stop = useCallback(() => { userStop.current = true; rec.current?.stop(); }, []);
  const start = useCallback(async (lang = 'da-DK', retried = false) => {
    if (!SR) return un.current(explainDictation('unsupported'));
    if (starting.current) return;
    starting.current = true;
    userStop.current = false;
    setListening(true);
    const denied = await micCheck();
    if (denied) { starting.current = false; setListening(false); return un.current(explainDictation(denied)); }
    try {
      const r = new SR();
      r.lang = lang; r.interimResults = true; r.continuous = true;
      let finalText = '', heard = false, error = '';
      const began = Date.now();
      r.onresult = (ev: any) => {
        heard = true;
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const t = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) finalText += t; else interim += t;
        }
        cb.current((finalText + interim).trim(), false);
      };
      r.onerror = (ev: any) => { error = ev.error || 'unknown'; };
      r.onend = () => {
        rec.current = null;
        setListening(false);
        if (heard) return cb.current(finalText.trim(), true);
        if (userStop.current) return; // you pressed the button again
        // Danish not available on this Mac: try the system language once before giving up.
        if (error === 'language-not-supported' && !retried && lang !== navigator.language) return void start(navigator.language, true);
        // Some WebKit versions end a continuous session at once: retry once in single-phrase mode.
        if (!error && Date.now() - began < 1500 && !retried) return void startSingle(lang);
        un.current(explainDictation(error || 'ended-at-once'));
      };
      r.start();
      rec.current = r;
    } catch (e) {
      setListening(false);
      un.current(explainDictation((e as Error)?.name || 'start-failed'));
    } finally {
      starting.current = false;
    }

    function startSingle(l: string) {
      try {
        const r = new SR();
        r.lang = l; r.interimResults = true; r.continuous = false;
        let text = '', err = '';
        r.onresult = (ev: any) => { text = Array.from(ev.results as ArrayLike<any>).map((x: any) => x[0].transcript).join(''); cb.current(text.trim(), false); };
        r.onerror = (ev: any) => { err = ev.error || 'unknown'; };
        r.onend = () => { rec.current = null; setListening(false); if (text) cb.current(text.trim(), true); else if (!userStop.current) un.current(explainDictation(err || 'ended-at-once')); };
        r.start(); rec.current = r; setListening(true);
      } catch (e) { setListening(false); un.current(explainDictation((e as Error)?.name || 'start-failed')); }
    }
  }, []);

  useEffect(() => () => { userStop.current = true; rec.current?.abort?.(); }, []);
  return { listening, start: () => void start(), stop, toggle: () => (rec.current ? stop() : void start()) };
}
