import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  HelpCircle,
  MessageSquare,
  FileAudio,
  Mic,
  MicOff,
  User,
  ChevronRight,
  ArrowRight,
  VolumeX,
  Wifi,
  X
} from 'lucide-react';
import { Message, AppState, User as UserType } from './types';
import { AudioWave } from './components/AudioWave';
import jessicaPortrait from './assets/images/regenerated_image_1778468032658.png'
import jessicaLogo from './assets/images/regenerated_image_1778642997714.png'
import {
  connect,
  sendAudioChunk,
  getWebSocketUrl,
  WebSocketCallbacks,
} from './services/websocketService';
import {
  startMicCapture,
  stopMicCapture,
  createPlaybackContext,
  playAudioFragment,
  AudioCaptureHandle,
} from './services/audioService';

const JESSICA_FULL = jessicaPortrait;
const JESSICA_FACE = jessicaPortrait;

export default function App() {
  const [state, setState] = useState<AppState>('landing');
  const [user, setUser] = useState<UserType | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isJessicaSpeaking, setIsJessicaSpeaking] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showTranscription, setShowTranscription] = useState(false);
  const [lang, setLang] = useState<'es' | 'en'>('es');

  const [wsStatus, setWsStatus] = useState<'disconnected' | 'connecting' | 'ready'>('disconnected');
  const [wsError, setWsError] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const micHandleRef = useRef<AudioCaptureHandle | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const transcriptRef = useRef('');
  const scrollRef = useRef<HTMLParagraphElement>(null);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);
  const wsClosedByError = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const showWelcome = params.get('welcome') === '1';

    fetch('/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((userData) => {
        if (userData) {
          setUser(userData);

          if (showWelcome && userData.isNew) {
            setShowHelpModal(true);
          } else {
            setState('chat');
          }

          if (showWelcome) {
            window.history.replaceState({}, '', window.location.pathname);
          }
        }
      });
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isJessicaSpeaking, currentTranscript]);

  useEffect(() => {
    if (transcriptScrollRef.current) {
      transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight;
    }
  }, [messages, currentTranscript]);

  useEffect(() => {
    if (state !== 'chat') return;

    setWsStatus('connecting');
    setWsError('');
    wsClosedByError.current = false;

    const url = getWebSocketUrl();
    const ws = connect(url, {
      onReady: () => {
        setWsStatus('ready');
      },
      onTranscript: (text) => {
        transcriptRef.current += text;
        setCurrentTranscript(transcriptRef.current);
        setIsJessicaSpeaking(true);
      },
      onAudioChunk: (base64) => {
        if (playbackCtxRef.current) {
          playAudioFragment(playbackCtxRef.current, base64, nextStartTimeRef);
        }
      },
      onTurnComplete: () => {
        const text = transcriptRef.current.trim();
        if (text) {
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'assistant',
            content: text,
            timestamp: new Date(),
          }]);
        }
        transcriptRef.current = '';
        setCurrentTranscript('');
        setIsJessicaSpeaking(false);
      },
      onClose: () => {
        if (wsClosedByError.current) {
          wsClosedByError.current = false;
          return;
        }
        setWsStatus('disconnected');
      },
      onError: (err) => {
        wsClosedByError.current = true;
        setWsStatus('disconnected');
        setWsError(err);
      },
    });

    wsRef.current = ws;

    createPlaybackContext().then(ctx => {
      playbackCtxRef.current = ctx;
    });

    return () => {
      if (micHandleRef.current) {
        stopMicCapture(micHandleRef.current);
        micHandleRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
      if (playbackCtxRef.current) {
        playbackCtxRef.current.close();
        playbackCtxRef.current = null;
      }
      setIsStreaming(false);
      setIsJessicaSpeaking(false);
      setCurrentTranscript('');
      transcriptRef.current = '';
      nextStartTimeRef.current = 0;
      setWsStatus('disconnected');
    };
  }, [state]);

  const toggleMic = async () => {
    if (isStreaming) {
      if (micHandleRef.current) {
        stopMicCapture(micHandleRef.current);
        micHandleRef.current = null;
      }
      setIsStreaming(false);
      return;
    }

    if (!wsRef.current || wsStatus !== 'ready') return;

    if (!playbackCtxRef.current) {
      playbackCtxRef.current = await createPlaybackContext();
    }

    try {
      const handle = await startMicCapture((base64) => {
        if (wsRef.current) {
          sendAudioChunk(wsRef.current, base64);
        }
      });
      micHandleRef.current = handle;
      setIsStreaming(true);
    } catch (err) {
      console.error('[Mic] Error:', err);
    }
  };

  const translations = {
    es: {
      title: "Antes de comenzar",
      subtitle: "Ten en cuenta las siguientes recomendaciones",
      mic: "Permiso de micrófono",
      micDesc: "Acepta el acceso al micrófono cuando el navegador lo solicite.",
      quiet: "Entorno silencioso",
      quietDesc: "Usa la aplicación en un lugar sin ruido de fondo para mayor precisión.",
      wifi: "Conexión estable",
      wifiDesc: "Asegúrate de tener una buena conexión a internet antes de comenzar.",
      speak: "Habla claro y pausado",
      speakDesc: "Pronuncia con claridad y a un ritmo natural para mejores resultados.",
      button: "Entendido, comenzar",
      landing: {
        badge: "Tu Asistente Deportiva v.2.0",
        greeting: "Hola, soy",
        name: "Jessica.",
        description: "Tengo acceso a toda la información del mundo del fútbol en tiempo real. Análisis táctico, estadísticas globales y asesoramiento deportivo a tu disposición.",
        howTitle: "¿Cómo interactuar?",
        how1: "Pregunta por resultados de ligas europeas",
        how2: "Consulta análisis de rendimiento de jugadores",
        how3: "Pide consejos de entrenamiento táctico",
        start: "COMENZAR AHORA"
      },
      login: {
        title: "Acceso Jessica AI",
        subtitle: "Introduce tus credenciales de vestuario",
        email: "Email",
        password: "Contraseña",
        button: "ACCEDER",
        back: "Volver al campo de juego"
      },
      chat: {
        nav: {
          voice: "JESSICA VOICE",
          engine: "Neural Engine Activo",
          help: "ASISTENCIA",
          logout: "SALIR"
        },
        status: {
          speaking: "Jessica está hablando...",
          listening: "Escuchando...",
          waiting: "Esperando voz...",
          connecting: "Conectando..."
        },
        transcription: {
          title: "Transcripción",
          subtitle: "Registro de voz a texto",
          generating: "Generando respuesta...",
          clear: "Limpiar historial",
          user: "Usuario"
        },
        mic: {
          inactive: "TOCA PARA ACTIVAR EL MICRÓFONO",
          active: "TOCA PARA DESACTIVAR",
          connecting: "CONECTANDO..."
        },
        footer: {
          rights: "© 2026 JESSICA SPORTS",
          version: "VOICE ENGINE v4.1",
          ready: "MICRÓFONO LISTO"
        }
      }
    },
    en: {
      title: "Before starting",
      subtitle: "Keep the following recommendations in mind",
      mic: "Microphone Permission",
      micDesc: "Accept microphone access when the browser requests it.",
      quiet: "Quiet Environment",
      quietDesc: "Use the application in a place without background noise for better accuracy.",
      wifi: "Stable Connection",
      wifiDesc: "Make sure you have a good internet connection before starting.",
      speak: "Speak clearly and slowly",
      speakDesc: "Speak clearly and at a natural pace for better results.",
      button: "Understood, start",
      landing: {
        badge: "Your Sports Assistant v.2.0",
        greeting: "Hello, I am",
        name: "Jessica.",
        description: "I have access to all the information in the football world in real time. Tactical analysis, global statistics, and sports coaching at your disposal.",
        howTitle: "How to interact?",
        how1: "Ask for European league results",
        how2: "Consult player performance analysis",
        how3: "Ask for tactical training advice",
        start: "START NOW"
      },
      login: {
        title: "Jessica AI Access",
        subtitle: "Enter your locker room credentials",
        email: "Email",
        password: "Password",
        button: "ACCESS",
        back: "Back to the field"
      },
      chat: {
        nav: {
          voice: "JESSICA VOICE",
          engine: "Neural Engine Active",
          help: "ASSISTANCE",
          logout: "EXIT"
        },
        status: {
          speaking: "Jessica is speaking...",
          listening: "Listening...",
          waiting: "Waiting for voice...",
          connecting: "Connecting..."
        },
        transcription: {
          title: "Transcription",
          subtitle: "Voice to text record",
          generating: "Generating response...",
          clear: "Clear history",
          user: "User"
        },
        mic: {
          inactive: "TAP TO ACTIVATE THE MICROPHONE",
          active: "TAP TO DEACTIVATE",
          connecting: "CONNECTING..."
        },
        footer: {
          rights: "© 2026 JESSICA SPORTS",
          version: "VOICE ENGINE v4.1",
          ready: "MICROPHONE READY"
        }
      }
    }
  };

  const t = translations[lang];



  const handleStartFromModal = async () => {
    setShowHelpModal(false);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      console.warn('[Mic] Permiso denegado — el micrófono no estará disponible');
    }
    if (user && state !== 'chat') {
      setState('chat');
      if (messages.length === 0) {
        setMessages([{
          id: '1',
          role: 'assistant',
          content: lang === 'es'
            ? '¡Hola! Soy Jessica, tu asistente personal en el mundo del fútbol. ¿En qué puedo ayudarte hoy?'
            : 'Hello! I am Jessica, your personal football assistant. How can I help you today?',
          timestamp: new Date()
        }]);
      }
    }
  };

  const handleLogout = async () => {
    await fetch('/auth/logout', { method: 'POST' });
    setUser(null);
    setMessages([]);
    setState('landing');
  };

  const getStatusText = () => {
    if (wsStatus === 'connecting') return t.chat.status.connecting;
    if (isJessicaSpeaking) return t.chat.status.speaking;
    if (isStreaming) return t.chat.status.listening;
    return t.chat.status.waiting;
  };

  const centralText = currentTranscript || (messages.length > 0 ? messages[messages.length - 1].content : t.chat.status.waiting);

  return (
    <div className="min-h-screen bg-dark-bg text-slate-200 flex flex-col font-sans selection:bg-cyan-500/30 overflow-hidden relative">
      <div className="bg-blob top-[-10%] left-[-10%] w-[40%] h-[40%] bg-cyan-500" />
      <div className="bg-blob bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-600" />

      <div className="fixed top-6 right-6 z-[50] flex items-center gap-2">
        <button
          onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
          className="group flex items-center gap-2 px-3 py-1.5 glass-panel border-white/10 rounded-xl text-[10px] font-bold text-slate-400 hover:border-cyan-500/50 hover:text-white transition-all active:scale-95 shadow-xl backdrop-blur-xl"
        >
          <span className={lang === 'en' ? 'text-cyan-400' : ''}>EN</span>
          <span className="text-white/10">|</span>
          <span className={lang === 'es' ? 'text-cyan-400' : ''}>ES</span>
        </button>
      </div>

      <AnimatePresence mode="wait">
        {state === 'landing' && (
          <motion.div
            key="landing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col relative z-10 w-full"
          >
            <nav className="h-20 md:h-28 flex items-center justify-center relative z-20 w-full">
              <div className="flex flex-col items-center group">
                <img
                  src={jessicaLogo}
                  alt="Jessica AI Logo"
                  className="max-h-12 md:max-h-16 w-auto brightness-0 invert opacity-60 group-hover:opacity-100 transition-all duration-700 cursor-pointer"
                />
                <span className="text-[8px] font-black text-slate-600 tracking-[0.6em] uppercase mt-2 leading-none">POWERED</span>
              </div>
            </nav>

            <div className="flex-1 flex flex-col md:flex-row items-center justify-center p-6 gap-12 max-w-6xl mx-auto w-full">
              <div className="flex-1 space-y-8 text-center md:text-left py-10 md:py-0">
                <div className="space-y-4">
                  <p className="text-cyan-400 font-mono text-[10px] md:text-xs tracking-widest uppercase">{t.landing.badge}</p>
                  <h1 className="text-6xl sm:text-7xl md:text-9xl font-normal italic leading-[0.9] font-mold text-white uppercase tracking-tight">
                    {t.landing.greeting} <br/>
                    <span className="text-cyan-500">{t.landing.name}</span>
                  </h1>
                </div>
                <p className="text-lg md:text-xl text-slate-400 leading-relaxed max-w-lg mx-auto md:mx-0">
                  {t.landing.description}
                </p>

                <div className="glass-panel p-5 md:p-6 rounded-3xl border-white/5 space-y-4 max-w-md mx-auto md:mx-0">
                  <h3 className="text-xs font-bold text-white mb-2 uppercase tracking-wider">{t.landing.howTitle}</h3>
                  <ul className="text-xs text-slate-400 space-y-3">
                    <li className="flex items-center gap-3">
                      <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full" />
                      {t.landing.how1}
                    </li>
                    <li className="flex items-center gap-3">
                      <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full" />
                      {t.landing.how2}
                    </li>
                    <li className="flex items-center gap-3">
                      <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full" />
                      {t.landing.how3}
                    </li>
                  </ul>
                </div>
              </div>

              <div className="flex-1 relative block flex flex-col items-center">
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 1 }}
                  className="relative cursor-pointer group"
                >
                  <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-full blur opacity-25 group-hover:opacity-50 transition-opacity"></div>
                  <div className="relative rounded-[4rem] overflow-hidden border-2 border-white/10 shadow-2xl aspect-[3/4] max-w-sm mx-auto">
                    <img
                      src={JESSICA_FULL}
                      alt="Jessica Full"
                      className="w-full h-full object-cover object-top grayscale-[20%] hover:grayscale-0 transition-all duration-700"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-dark-bg/80 via-transparent to-transparent" />
                    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-[80%]">
                      <AudioWave isPlaying={false} />
                    </div>
                  </div>
                </motion.div>

                <button
                  id="btn-start"
                  onClick={() => setState('chat')}
                  className="mt-6 md:mt-8 w-full sm:w-auto px-12 py-5 bg-cyan-500 text-black rounded-xl font-mold text-2xl tracking-wider flex items-center justify-center gap-3 transition-all hover:bg-cyan-400 hover:scale-[1.05] shadow-[0_0_30px_rgba(6,182,212,0.3)] active:scale-95"
                >
                  {t.landing.start}
                  <ChevronRight size={24} />
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {state !== 'landing' && state !== 'chat' && (
          <motion.div
            key="login"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="flex-1 flex items-center justify-center p-4 md:p-6 relative z-10"
          >
            <div className="w-full max-w-md glass-panel p-8 md:p-10 rounded-[2rem] md:rounded-[2.5rem] shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 blur-3xl -mr-16 -mt-16" />

              <div className="text-center mb-8 md:mb-10 relative">
                <div className="flex flex-col items-center mb-6">
                  <img
                    src={jessicaLogo}
                    alt="Jessica AI Logo"
                    className="max-h-12 w-auto brightness-0 invert opacity-80"
                  />
                  <span className="text-[8px] font-black text-slate-500 tracking-[0.5em] uppercase mt-2 leading-none">POWERED</span>
                </div>
                <h2 className="text-2xl md:text-3xl font-display font-bold text-white tracking-tight">{t.login.title}</h2>
              </div>

              <button
                onClick={() => (window.location.href = '/auth/google')}
                className="w-full py-4 bg-white text-black rounded-2xl font-bold flex items-center justify-center gap-3 transition-all hover:bg-slate-200 active:scale-[0.98] mt-4 shadow-xl"
              >
                {t.login.button}
                <ArrowRight size={20} />
              </button>

              <button
                onClick={() => setState('landing')}
                className="w-full mt-8 text-slate-500 text-xs font-bold uppercase tracking-widest hover:text-cyan-400 transition-colors"
              >
                {t.landing.start}
              </button>
            </div>
          </motion.div>
        )}

        {state === 'chat' && (
          <motion.div
            key="chat"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col h-screen max-w-6xl mx-auto w-full bg-dark-bg relative overflow-hidden"
          >
              <nav className="h-20 md:h-24 flex items-center justify-between px-6 md:px-12 relative z-20 bg-dark-bg/40 backdrop-blur-xl border-b border-white/5">
                <div className="flex-1 flex items-center gap-4">
                  {user?.picture ? (
                    <img
                      src={user.picture}
                      alt={user.name}
                      className="w-10 h-10 rounded-xl object-cover ring-2 ring-cyan-500/30"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-10 h-10 bg-cyan-500 rounded-xl flex items-center justify-center font-bold text-black text-xl shadow-[0_0_15px_rgba(6,182,212,0.3)]">
                      {user?.name?.charAt(0) || 'J'}
                    </div>
                  )}
                  <div className="hidden sm:block">
                    <h3 className="font-bold text-lg text-white tracking-widest font-mold uppercase">{t.chat.nav.voice}</h3>
                    <p className="text-[9px] text-cyan-400/60 font-mono tracking-[0.3em] uppercase italic">
                      {user?.name || t.chat.nav.engine}
                    </p>
                  </div>
                </div>

              <div className="hidden lg:flex flex-1 justify-center items-center">
                <div className="flex flex-col items-center">
                  <img
                    src="/src/assets/images/regenerated_image_1778642997714.png"
                    alt="Jessica AI Logo"
                    className="max-h-10 w-auto brightness-0 invert opacity-60 hover:opacity-100 transition-all duration-500 cursor-pointer"
                  />
                  <span className="text-[7px] font-black text-slate-600 tracking-[0.4em] uppercase mt-1 leading-none">POWERED</span>
                </div>
              </div>

              <div className="flex-1 flex items-center justify-end gap-4">
                <button
                  onClick={() => setShowHelpModal(true)}
                  className="flex items-center gap-2 text-[10px] font-bold text-slate-400 hover:text-white transition-colors py-2 px-4 rounded-xl border border-white/5"
                >
                  <HelpCircle size={14} />
                  {t.chat.nav.help}
                </button>
                <button
                  onClick={handleLogout}
                  className="bg-white/5 px-6 py-2.5 rounded-full text-[10px] font-bold text-white hover:bg-white/10 transition-all border border-white/10"
                >
                  {t.chat.nav.logout}
                </button>
              </div>
            </nav>

            <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-12 relative">
              <div className="relative group mb-12">
                <motion.div
                  animate={isJessicaSpeaking ? { scale: [1, 1.1, 1], opacity: [0.1, 0.3, 0.1] } : {}}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="absolute -inset-10 bg-cyan-500 rounded-full blur-3xl opacity-10"
                />

                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="relative w-64 h-64 md:w-80 md:h-80 rounded-full overflow-hidden border-4 border-white/10 shadow-[0_0_50px_rgba(34,211,238,0.2)]"
                >
                  <div className="absolute inset-0 flex items-center justify-center opacity-[0.03] pointer-events-none rotate-12">
                    <img src={jessicaLogo} alt="" className="w-48 brightness-0 invert" />
                  </div>

                  <img
                    src={JESSICA_FACE}
                    alt="Jessica AI"
                    className={`w-full h-full object-cover object-top transition-all duration-1000 ${isJessicaSpeaking ? 'scale-110 brightness-110' : 'grayscale-[30%]'}`}
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-cyan-500/20 via-transparent to-transparent pointer-events-none" />
                </motion.div>

                <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 px-6 py-2 glass-panel rounded-full border border-white/10 flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${isJessicaSpeaking || isStreaming ? 'bg-cyan-400 animate-pulse' : 'bg-slate-600'}`} />
                  <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">
                    {getStatusText()}
                  </span>
                </div>
                {wsError && (
                  <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 text-[9px] text-red-400 font-mono whitespace-nowrap">
                    {wsError}
                  </div>
                )}
              </div>

              <div className="w-full max-w-2xl mb-12">
                <AudioWave isPlaying={isStreaming || isJessicaSpeaking} />
              </div>

              <AnimatePresence>
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="max-w-xl text-center mb-12"
                >
                  <p ref={scrollRef} className="text-xl md:text-2xl font-serif italic text-white/90 leading-relaxed shadow-sm max-h-[6rem] md:max-h-[7.5rem] overflow-y-auto scrollbar-hide">
                    {centralText}
                  </p>
                </motion.div>
              </AnimatePresence>

              <div className="flex items-center gap-8 relative z-20">
                <div className="flex flex-col items-center gap-3">
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={toggleMic}
                    disabled={wsStatus === 'connecting'}
                    className={`w-20 h-20 md:w-24 md:h-24 rounded-full flex items-center justify-center transition-all ${
                      isStreaming
                        ? 'bg-slate-800 text-red-400 border-2 border-red-400/50'
                        : wsStatus !== 'ready'
                          ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                          : 'bg-cyan-500 text-black'
                    }`}
                  >
                    {isStreaming ? <MicOff size={32} /> : <Mic size={32} />}
                  </motion.button>
                  <span className="text-[9px] text-slate-500 font-mono uppercase tracking-widest text-center leading-relaxed">
                    {wsStatus !== 'ready'
                      ? t.chat.mic.connecting
                      : isStreaming
                        ? t.chat.mic.active
                        : t.chat.mic.inactive}
                  </span>
                </div>

                <button
                  onClick={() => setShowTranscription(!showTranscription)}
                  className={`p-4 rounded-2xl transition-all ${
                    showTranscription
                      ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/20'
                      : 'glass-panel border-white/5 text-slate-400 hover:text-white'
                  }`}
                >
                  <FileAudio size={24} />
                </button>
              </div>
            </div>

            <footer className="h-16 px-12 flex items-center justify-between text-[10px] text-slate-600 uppercase tracking-[0.4em] border-t border-white/5 relative z-20">
              <div className="flex gap-4">
                <span>{t.chat.footer.rights}</span>
                <span className="text-cyan-500/40">●</span>
                <span>{t.chat.footer.version}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-cyan-500 rounded-full animate-pulse" />
                <span>{t.chat.footer.ready}</span>
              </div>
            </footer>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showHelpModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowHelpModal(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-[2.5rem] overflow-hidden shadow-2xl"
            >
              <div className="p-8 md:p-12">
                <div className="flex justify-between items-start mb-8">
                  <div>
                    <h2 className="text-2xl font-bold text-black font-mold tracking-tight uppercase">{t.title}</h2>
                    <p className="text-sm text-slate-500 font-mono mt-1">{t.subtitle}</p>
                  </div>
                </div>

                <div className="space-y-8">
                  <div className="flex gap-6">
                    <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-400 shrink-0">
                      <Mic size={24} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-black uppercase tracking-wider mb-1">{t.mic}</h4>
                      <p className="text-sm text-slate-500 leading-relaxed">{t.micDesc}</p>
                    </div>
                  </div>

                  <div className="flex gap-6">
                    <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-400 shrink-0">
                      <VolumeX size={24} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-black uppercase tracking-wider mb-1">{t.quiet}</h4>
                      <p className="text-sm text-slate-500 leading-relaxed">{t.quietDesc}</p>
                    </div>
                  </div>

                  <div className="flex gap-6">
                    <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-blue-500 shrink-0">
                      <Wifi size={24} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-black uppercase tracking-wider mb-1">{t.wifi}</h4>
                      <p className="text-sm text-slate-500 leading-relaxed">{t.wifiDesc}</p>
                    </div>
                  </div>

                  <div className="flex gap-6 border-b border-slate-50 pb-8">
                    <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-purple-400 shrink-0">
                      <MessageSquare size={24} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-black uppercase tracking-wider mb-1">{t.speak}</h4>
                      <p className="text-sm text-slate-500 leading-relaxed">{t.speakDesc}</p>
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleStartFromModal}
                  className="w-full mt-10 py-5 bg-[#111111] text-white rounded-2xl font-bold font-mold text-xl tracking-wider transition-all hover:bg-black active:scale-95 shadow-xl"
                >
                  {t.button}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showTranscription && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowTranscription(false)}
              className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm lg:hidden"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 h-full w-full max-w-md bg-dark-bg/95 backdrop-blur-2xl border-l border-white/10 z-[70] flex flex-col shadow-2xl"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div>
                    <h3 className="text-lg font-bold text-white font-mold uppercase tracking-widest leading-none">{t.chat.transcription.title}</h3>
                    <p className="text-[10px] text-cyan-400 font-mono mt-1">{t.chat.transcription.subtitle}</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowTranscription(false)}
                  className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl transition-all text-white border border-white/10 active:scale-95 group"
                >
                  <X size={18} className="group-hover:rotate-90 transition-transform duration-300" />
                </button>
              </div>

              <div
                ref={transcriptScrollRef}
                className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide"
              >
                {messages.map((m) => (
                  <div key={m.id} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] font-bold uppercase tracking-widest ${m.role === 'user' ? 'text-cyan-400' : 'text-slate-400'}`}>
                        {m.role === 'user' ? (user?.email?.split('@')[0] || t.chat.transcription.user) : 'Jessica AI'}
                      </span>
                      <span className="text-[8px] text-slate-600 font-mono">
                        {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className={`text-sm leading-relaxed ${m.role === 'user' ? 'text-white' : 'text-slate-400 font-serif italic'}`}>
                      {m.content}
                    </p>
                  </div>
                ))}
                {currentTranscript && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Jessica AI</span>
                      <span className="text-[8px] text-slate-600 font-mono">Transcribiendo...</span>
                    </div>
                    <p className="text-sm leading-relaxed text-slate-400 font-serif italic">
                      {currentTranscript}
                    </p>
                  </div>
                )}
              </div>

              <div className="p-6 border-t border-white/5">
                <button
                  onClick={() => setMessages([])}
                  className="w-full py-3 border border-white/5 rounded-xl text-[10px] font-bold text-slate-500 hover:text-white hover:border-white/10 transition-all uppercase tracking-widest"
                >
                  {t.chat.transcription.clear}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
