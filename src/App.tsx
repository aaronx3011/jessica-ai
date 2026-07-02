import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
    HelpCircle,
    MessageSquare,
    FileAudio,
    Mic,
    MicOff,
    VolumeX,
    Wifi,
    X
} from 'lucide-react';
import { Message, AppState } from './types';
import { AudioWave } from './components/AudioWave';
import veraPortrait from './assets/images/vera-portrait.png'
import veraLogo from './assets/images/regenerated_image_1778642997714.png'
import {
    connect,
    sendAudioChunk,
    getWebSocketUrl,
} from './services/websocketService';
import {
    startMicCapture,
    stopMicCapture,
    createPlaybackContext,
    playAudioFragment,
    stopPlayback,
    muteOutput,
    unmuteOutput,
    AudioCaptureHandle,
} from './services/audioService';

const VERA_FULL = veraPortrait;
const VERA_FACE = veraPortrait;

export default function App() {
    const [state, setState] = useState<AppState>('chat');
    const [messages, setMessages] = useState<Message[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [isVeraSpeaking, setIsVeraSpeaking] = useState(false);
    const [currentTranscript, setCurrentTranscript] = useState('');
    const [showHelpModal, setShowHelpModal] = useState(false);
    const [showTranscription, setShowTranscription] = useState(false);
    const [lang, setLang] = useState<'es' | 'en'>('es');

    const [wsStatus, setWsStatus] = useState<'disconnected' | 'connecting' | 'ready'>('disconnected');
    const [wsError, setWsError] = useState('');
    const [isNoisy, setIsNoisy] = useState(false);
    const [micLevel, setMicLevel] = useState(0);

    const wsRef = useRef<WebSocket | null>(null);
    const micHandleRef = useRef<AudioCaptureHandle | null>(null);
    const playbackCtxRef = useRef<AudioContext | null>(null);
    const nextStartTimeRef = useRef<number>(0);
    const transcriptRef = useRef('');
    const isVeraSpeakingRef = useRef(false);
    const scrollRef = useRef<HTMLParagraphElement>(null);
    const transcriptScrollRef = useRef<HTMLDivElement>(null);
    const wsClosedByError = useRef(false);
    const lastInterruptRef = useRef(0);

    function interruptVera() {
        const now = Date.now();
        if (now - lastInterruptRef.current < 1500) return;
        lastInterruptRef.current = now;
        muteOutput();
        stopPlayback();
        nextStartTimeRef.current = 0;
    }

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
                setIsVeraSpeaking(true);
                isVeraSpeakingRef.current = true;
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
                unmuteOutput();
                setIsVeraSpeaking(false);
                isVeraSpeakingRef.current = false;
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
            setIsVeraSpeaking(false);
            setCurrentTranscript('');
            transcriptRef.current = '';
            nextStartTimeRef.current = 0;
            setWsStatus('disconnected');
        };
    }, [state]);

    useEffect(() => {
        setMessages([{
            id: '1',
            role: 'assistant',
            content: lang === 'es'
                ? '¡Hola! Soy Vera, co-presentadora de Quinto Vector. ¿Sobre qué tema te gustaría hablar hoy?'
                : 'Hello! I am Vera, co-host of Quinto Vector. What topic would you like to discuss today?',
            timestamp: new Date()
        }]);
    }, []);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isVeraSpeaking, currentTranscript]);

    useEffect(() => {
        if (transcriptScrollRef.current) {
            transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight;
        }
    }, [messages, currentTranscript]);

    const toggleMic = async () => {
        if (isStreaming) {
            if (micHandleRef.current) {
                stopMicCapture(micHandleRef.current);
                micHandleRef.current = null;
            }
            setIsStreaming(false);
            setIsNoisy(false);
            return;
        }

        if (!wsRef.current || wsStatus !== 'ready') return;

        if (!playbackCtxRef.current) {
            playbackCtxRef.current = await createPlaybackContext();
        } else if (playbackCtxRef.current.state === 'suspended') {
            await playbackCtxRef.current.resume();
        }

        try {
            const handle = await startMicCapture(
                (base64) => {
                    if (wsRef.current) {
                        sendAudioChunk(wsRef.current, base64);
                    }
                },
                (noisy) => setIsNoisy(noisy),
                (rms) => setMicLevel(rms),
                () => {
                    if (isVeraSpeakingRef.current) interruptVera();
                },
                0.025
            );
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
            chat: {
                nav: {
                    voice: "VERA VOICE",
                    engine: "Neural Engine Activo",
                    help: "ASISTENCIA",
                },
                status: {
                    speaking: "Vera está hablando...",
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
                    inactive: "INICIAR CONVERSACIÓN",
                    active: "FINALIZAR",
                    connecting: "CONECTANDO..."
                },
                footer: {
                    rights: "© 2026 QUINTO VECTOR",
                    version: "VOICE ENGINE v1.2 ★",
                    ready: "SIEMPRE ESCUCHANDO"
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
            chat: {
                nav: {
                    voice: "VERA VOICE",
                    engine: "Neural Engine Active",
                    help: "ASSISTANCE",
                },
                status: {
                    speaking: "Vera is speaking...",
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
                    inactive: "START CONVERSATION",
                    active: "END",
                    connecting: "CONNECTING..."
                },
                footer: {
                    rights: "© 2026 QUINTO VECTOR",
                    version: "VOICE ENGINE v1.2 ★",
                    ready: "ALWAYS LISTENING"
                }
            }
        }
    };

    const t = translations[lang];


    const getStatusText = () => {
        if (wsStatus === 'connecting') return t.chat.status.connecting;
        if (isVeraSpeaking) return t.chat.status.speaking;
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
                                <div className="w-10 h-10 bg-cyan-500 rounded-xl flex items-center justify-center font-bold text-black text-xl shadow-[0_0_15px_rgba(6,182,212,0.3)]">
                                    J
                                </div>
                                <div className="hidden sm:block">
                                    <h3 className="font-bold text-lg text-white tracking-widest font-mold uppercase">{t.chat.nav.voice}</h3>
                                    <p className="text-[9px] text-cyan-400/60 font-mono tracking-[0.3em] uppercase italic">
                                        {t.chat.nav.engine}
                                    </p>
                                </div>
                            </div>

                            <div className="hidden lg:flex flex-1 justify-center items-center">
                                <div className="flex flex-col items-center group">
                                    <img
                                        src={veraLogo}
                                        alt="Vera AI Logo"
                                        className="max-h-10 w-auto brightness-0 invert opacity-60 group-hover:opacity-100 transition-all duration-500 cursor-pointer"
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
                            </div>
                        </nav>

                        <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-12 relative">
                            <div className="relative group mb-12">
                                <motion.div
                                    animate={isVeraSpeaking ? { scale: [1, 1.1, 1], opacity: [0.1, 0.3, 0.1] } : {}}
                                    transition={{ duration: 2, repeat: Infinity }}
                                    className="absolute -inset-10 bg-cyan-500 rounded-full blur-3xl opacity-10"
                                />

                                <motion.div
                                    initial={{ scale: 0.9, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    className="relative w-64 h-64 md:w-80 md:h-80 rounded-full overflow-hidden border-4 border-white/10 shadow-[0_0_50px_rgba(34,211,238,0.2)]"
                                >
                                    <div className="absolute inset-0 flex items-center justify-center opacity-[0.03] pointer-events-none rotate-12">
                                        <img src={veraLogo} alt="" className="w-48 brightness-0 invert" />
                                    </div>

                                    <img
                                        src={VERA_FACE}
                                        alt="Vera AI"
                                        className={`w-full h-full object-cover object-top transition-all duration-1000 ${isVeraSpeaking ? 'scale-110 brightness-110' : 'grayscale-[30%]'}`}
                                        referrerPolicy="no-referrer"
                                    />
                                    <div className="absolute inset-0 bg-gradient-to-t from-cyan-500/20 via-transparent to-transparent pointer-events-none" />
                                </motion.div>

                                <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 px-6 py-2 glass-panel rounded-full border border-white/10 flex items-center gap-3">
                                    <div className={`w-2 h-2 rounded-full ${isVeraSpeaking || isStreaming ? 'bg-cyan-400 animate-pulse' : 'bg-slate-600'}`} />
                                    <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">
                                        {getStatusText()}
                                    </span>
                                </div>
                                <div className="absolute -bottom-14 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full flex items-center gap-2 whitespace-nowrap transition-all duration-300"
                                    style={{
                                        backgroundColor: isNoisy ? 'rgba(251, 191, 36, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                                        borderColor: isNoisy ? 'rgba(251, 191, 36, 0.4)' : 'rgba(255, 255, 255, 0.05)',
                                        borderWidth: 1,
                                    }}
                                >
                                    {isStreaming ? (
                                        <>
                                            <span className={`w-1.5 h-1.5 rounded-full ${isNoisy ? 'bg-amber-400 animate-ping' : 'bg-cyan-500'}`} />
                                            <span className={`text-[9px] font-bold uppercase tracking-widest ${isNoisy ? 'text-amber-300' : 'text-cyan-400'}`}>
                                                {isNoisy ? '⚠ NOISE' : 'NOISE OK'}
                                            </span>
                                            <span className={`text-[9px] font-mono ${isNoisy ? 'text-amber-400' : 'text-slate-500'}`}>
                                                {(micLevel * 10000).toFixed(0)}
                                            </span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                                            <span className="text-[9px] font-mono text-slate-600 uppercase tracking-widest">NOISE --</span>
                                        </>
                                    )}
                                </div>
                                {wsError && (
                                    <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 text-[9px] text-red-400 font-mono whitespace-nowrap">
                                        {wsError}
                                    </div>
                                )}
                            </div>

                            <div className="w-full max-w-2xl mb-12">
                                <AudioWave isPlaying={isStreaming || isVeraSpeaking} />
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
                                        className={`w-20 h-20 md:w-24 md:h-24 rounded-full flex items-center justify-center transition-all ${isStreaming
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
                                    {isStreaming && (
                                        <div className="flex flex-col items-center gap-1.5 mt-2 w-full max-w-[140px]">
                                            <div className="flex items-center gap-2 w-full">
                                                <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full rounded-full transition-all duration-150"
                                                        style={{
                                                            width: `${Math.min(100, Math.round(micLevel * 8000))}%`,
                                                            backgroundColor: isNoisy ? '#f59e0b' : '#06b6d4'
                                                        }}
                                                    />
                                                </div>
                                                <span className="text-[8px] text-slate-500 font-mono w-8 text-right">
                                                    {(micLevel * 1000).toFixed(0)}
                                                </span>
                                            </div>
                                            <span className={`text-[10px] font-bold font-mono tracking-wider px-2 py-0.5 rounded-full border transition-all ${isNoisy
                                                    ? 'text-amber-300 bg-amber-500/10 border-amber-500/30'
                                                    : 'text-cyan-400 bg-cyan-500/5 border-cyan-500/20'
                                                }`}>
                                                {isNoisy ? `⚠ ${(micLevel * 10000).toFixed(0)}` : `${(micLevel * 10000).toFixed(0)}`}
                                            </span>
                                        </div>
                                    )}
                                </div>

                                <button
                                    onClick={() => setShowTranscription(!showTranscription)}
                                    className={`p-4 rounded-2xl transition-all ${showTranscription
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
                                    onClick={() => {
                                        setShowHelpModal(false);
                                        navigator.mediaDevices.getUserMedia({ audio: true, video: false }).catch(() => {});
                                    }}
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
                                                {m.role === 'user' ? t.chat.transcription.user : 'Vera AI'}
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
                                            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Vera AI</span>
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
