
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { CameraIcon, CameraOffIcon, MicIcon, MicOffIcon, ScreenShareIcon, StopScreenShareIcon, CopyIcon, RefreshIcon } from './components/icons';

// STUN server configuration
const servers = {
    iceServers: [
        {
            urls: ['stun:stun.l.google.com:19302'],
        },
    ],
    iceCandidatePoolSize: 10,
};

// --- Helper Components (defined outside the main component to prevent re-renders) ---

interface VideoPlayerProps {
  stream: MediaStream | null;
  label: string;
  muted?: boolean;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ stream, label, muted = false }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden shadow-lg relative aspect-video flex items-center justify-center">
      <video ref={videoRef} autoPlay playsInline muted={muted} className="w-full h-full object-cover"></video>
      <div className="absolute top-2 left-2 bg-black bg-opacity-60 text-white text-xs px-2 py-1 rounded-md font-semibold">
        {label}
      </div>
      {!stream && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500">
           <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M15 10l4.55a1 1 0 011.45.89V18a1 1 0 01-1.45.89L15 15M4 10h6.586a1 1 0 01.707.293l3.414 3.414a1 1 0 010 1.414l-3.414 3.414a1 1 0 01-.707.293H4a1 1 0 01-1-1V11a1 1 0 011-1z"></path></svg>
        </div>
      )}
    </div>
  );
};

interface ControlButtonProps {
    onClick: () => void;
    disabled?: boolean;
    active?: boolean;
    children: React.ReactNode;
    className?: string;
}

const ControlButton: React.FC<ControlButtonProps> = ({ onClick, disabled, active, children, className = ''}) => {
    const baseClasses = 'flex items-center justify-center px-4 py-2 rounded-md font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed';
    const activeClasses = active ? 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500' : 'bg-indigo-600 hover:bg-indigo-700 text-white focus:ring-indigo-500';
    return <button onClick={onClick} disabled={disabled} className={`${baseClasses} ${activeClasses} ${className}`}>{children}</button>;
};

// --- Main Application Component ---

export default function App() {
    const peerConnection = useRef<RTCPeerConnection | null>(null);
    
    // Media stream states
    const [localCamStream, setLocalCamStream] = useState<MediaStream | null>(null);
    const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
    const [remoteCamStream, setRemoteCamStream] = useState<MediaStream | null>(null);
    const [remoteScreenStream, setRemoteScreenStream] = useState<MediaStream | null>(null);

    // Track sender refs
    const localCamSender = useRef<RTCRtpSender | null>(null);
    const localMicSender = useRef<RTCRtpSender | null>(null);
    const localScreenSender = useRef<RTCRtpSender | null>(null);

    // UI state
    const [offerSdp, setOfferSdp] = useState('');
    const [answerSdp, setAnswerSdp] = useState('');
    const [connectionState, setConnectionState] = useState<RTCIceConnectionState>('new');
    const [statusText, setStatusText] = useState('Ready to connect.');
    const [micMuted, setMicMuted] = useState(false);
    const [camHidden, setCamHidden] = useState(false);
    const [localIceCandidates, setLocalIceCandidates] = useState<RTCIceCandidate[]>([]);
    const [remoteIceCandidates, setRemoteIceCandidates] = useState('');
    const [isCameraStarting, setIsCameraStarting] = useState(false);
    const [isScreenStarting, setIsScreenStarting] = useState(false);


    const initializePeerConnection = useCallback(() => {
        setStatusText('Initializing...');
        const pc = new RTCPeerConnection(servers);
        
        pc.oniceconnectionstatechange = () => {
            setConnectionState(pc.iceConnectionState);
            setStatusText(`ICE Connection State: ${pc.iceConnectionState}`);
        };

        // Listen for local ICE candidates on the local RTCPeerConnection
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                setLocalIceCandidates(prev => [...prev, event.candidate]);
            }
        };

        pc.ontrack = (event) => {
            const track = event.track;
            const stream = event.streams[0];
            if (!stream) return;

            // Heuristic to differentiate camera from screen share.
            if (track.kind === 'audio' || (stream.getAudioTracks().length > 0 && stream.getVideoTracks().length > 0)) {
                 setRemoteCamStream(prev => {
                    const newStream = prev || new MediaStream();
                    if (!newStream.getTrackById(track.id)) {
                        newStream.addTrack(track);
                    }
                    return newStream;
                });
            } else if (track.kind === 'video') {
                 setRemoteScreenStream(prev => {
                    const newStream = prev || new MediaStream();
                     if (!newStream.getTrackById(track.id)) {
                        newStream.addTrack(track);
                    }
                    return newStream;
                });
            }
        };

        peerConnection.current = pc;
        setStatusText('Ready to connect.');
    }, []);

    useEffect(() => {
        initializePeerConnection();
        return () => {
            peerConnection.current?.close();
            localCamStream?.getTracks().forEach(track => track.stop());
            localScreenStream?.getTracks().forEach(track => track.stop());
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initializePeerConnection]);

    // --- Media Controls ---

    const startCamera = async () => {
        if (isCameraStarting) return;
        setIsCameraStarting(true);
        setStatusText('Requesting camera access...');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            setLocalCamStream(stream);
            
            const videoTrack = stream.getVideoTracks()[0];
            const audioTrack = stream.getAudioTracks()[0];
            
            if (peerConnection.current) {
                if (localCamSender.current) peerConnection.current.removeTrack(localCamSender.current);
                if (localMicSender.current) peerConnection.current.removeTrack(localMicSender.current);
                localCamSender.current = peerConnection.current.addTrack(videoTrack, stream);
                localMicSender.current = peerConnection.current.addTrack(audioTrack, stream);
            }
            setStatusText('Camera started.');
        } catch (error) {
            console.error("Error starting camera:", error);
            setStatusText('Failed to start camera.');
        } finally {
            setIsCameraStarting(false);
        }
    };

    const stopCamera = () => {
        localCamStream?.getTracks().forEach(track => track.stop());
        setLocalCamStream(null);
        if (peerConnection.current) {
            if (localCamSender.current) {
                peerConnection.current.removeTrack(localCamSender.current);
                localCamSender.current = null;
            }
            if (localMicSender.current) {
                peerConnection.current.removeTrack(localMicSender.current);
                localMicSender.current = null;
            }
        }
        setMicMuted(false);
        setCamHidden(false);
        setStatusText('Camera stopped.');
    };

    const toggleMic = () => {
        if (!localCamStream) return;
        localCamStream.getAudioTracks().forEach(track => {
            track.enabled = !track.enabled;
        });
        setMicMuted(prev => !prev);
    };

    const toggleVideo = () => {
        if (!localCamStream) return;
        localCamStream.getVideoTracks().forEach(track => {
            track.enabled = !track.enabled;
        });
        setCamHidden(prev => !prev);
    };

    const startScreenShare = async () => {
        if (isScreenStarting) return;
        setIsScreenStarting(true);
        setStatusText('Requesting screen access...');
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            setLocalScreenStream(stream);

            const videoTrack = stream.getVideoTracks()[0];
            // Handle when user clicks the browser's "Stop sharing" button
            videoTrack.onended = () => stopScreenShare();

            if (peerConnection.current) {
                 if (localScreenSender.current) peerConnection.current.removeTrack(localScreenSender.current);
                localScreenSender.current = peerConnection.current.addTrack(videoTrack, stream);
            }
            setStatusText('Screen sharing started.');
        } catch (error) {
            console.error("Error starting screen share:", error);
            setStatusText('Failed to start screen share.');
        } finally {
            setIsScreenStarting(false);
        }
    };

    const stopScreenShare = () => {
        localScreenStream?.getTracks().forEach(track => track.stop());
        setLocalScreenStream(null);
        if (peerConnection.current && localScreenSender.current) {
            peerConnection.current.removeTrack(localScreenSender.current);
            localScreenSender.current = null;
        }
        setStatusText('Screen sharing stopped.');
    };

    // --- Signaling ---

    const createOffer = async () => {
        if (!peerConnection.current) return;
        try {
            setLocalIceCandidates([]);
            const offer = await peerConnection.current.createOffer();
            await peerConnection.current.setLocalDescription(offer);
            
            await new Promise<void>(resolve => {
                if (peerConnection.current?.iceGatheringState === 'complete') {
                    resolve();
                } else {
                    const checkState = () => {
                        if (peerConnection.current?.iceGatheringState === 'complete') {
                            peerConnection.current.removeEventListener('icegatheringstatechange', checkState);
                            resolve();
                        }
                    };
                    peerConnection.current.addEventListener('icegatheringstatechange', checkState);
                }
            });

            setOfferSdp(JSON.stringify(peerConnection.current.localDescription));
            setStatusText('Offer created. Copy and send to peer.');
        } catch (error) {
            console.error("Error creating offer:", error);
            setStatusText('Failed to create offer.');
        }
    };

    const createAnswer = async () => {
        if (!peerConnection.current || !offerSdp.trim()) {
            setStatusText('Error: Paste the offer from the other peer first.');
            return;
        };
        try {
            setLocalIceCandidates([]);
            const offer = JSON.parse(offerSdp);
            await peerConnection.current.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await peerConnection.current.createAnswer();
            await peerConnection.current.setLocalDescription(answer);

            await new Promise<void>(resolve => {
                if (peerConnection.current?.iceGatheringState === 'complete') {
                    resolve();
                } else {
                    const checkState = () => {
                        if (peerConnection.current?.iceGatheringState === 'complete') {
                            peerConnection.current.removeEventListener('icegatheringstatechange', checkState);
                            resolve();
                        }
                    };
                    peerConnection.current.addEventListener('icegatheringstatechange', checkState);
                }
            });

            setAnswerSdp(JSON.stringify(peerConnection.current.localDescription));
            setStatusText('Answer created. Copy and send back to the first peer.');
        } catch (error) {
            console.error("Error creating answer:", error);
            setStatusText('Failed to create answer. Invalid offer SDP?');
        }
    };

    const acceptAnswer = async () => {
        if (!peerConnection.current || !answerSdp.trim()) {
            setStatusText('Error: Paste the answer from the other peer first.');
            return;
        }
        try {
            const answer = JSON.parse(answerSdp);
            await peerConnection.current.setRemoteDescription(new RTCSessionDescription(answer));
            setStatusText('Answer accepted. Connection should establish.');
        } catch (error) {
            console.error("Error accepting answer:", error);
            setStatusText('Failed to accept answer. Invalid answer SDP?');
        }
    };

    const addRemoteCandidates = async () => {
        if (!peerConnection.current || !remoteIceCandidates.trim()) {
            setStatusText('Error: Paste remote ICE candidates first.');
            return;
        }
        try {
            const candidates = JSON.parse(remoteIceCandidates);
            if (Array.isArray(candidates)) {
                for (const candidate of candidates) {
                    if(candidate){
                       await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
                    }
                }
                setStatusText('Remote ICE candidates added.');
            } else {
                setStatusText('Error: Candidates must be a JSON array.');
            }
        } catch (error) {
            console.error("Error adding remote ICE candidates:", error);
            setStatusText('Failed to add candidates. Invalid JSON?');
        }
    };
    
    const resetConnection = () => {
        setStatusText('Resetting connection...');
        stopCamera();
        stopScreenShare();

        if (peerConnection.current) {
            peerConnection.current.close();
        }

        setRemoteCamStream(null);
        setRemoteScreenStream(null);
        setOfferSdp('');
        setAnswerSdp('');
        setConnectionState('new');
        setLocalIceCandidates([]);
        setRemoteIceCandidates('');

        initializePeerConnection();
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setStatusText('Copied to clipboard!');
            setTimeout(() => setStatusText(`ICE Connection State: ${connectionState}`), 2000);
        }, () => {
            setStatusText('Failed to copy.');
        });
    };

    return (
        <div className="min-h-screen bg-gray-900 text-white p-4 sm:p-6 lg:p-8">
            <div className="max-w-7xl mx-auto">
                <header className="text-center mb-8">
                    <h1 className="text-4xl font-bold text-indigo-400">DualView Connect</h1>
                    <p className="text-gray-400 mt-2">Peer-to-Peer Video & Screen Sharing via Manual SDP Exchange</p>
                </header>

                <main>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                        {/* Local Streams */}
                        <div className="space-y-4">
                            <h2 className="text-xl font-semibold text-gray-300 border-b-2 border-gray-700 pb-2">Local Streams</h2>
                            <VideoPlayer stream={localCamStream} label="Your Camera" muted={true} />
                            <VideoPlayer stream={localScreenStream} label="Your Screen" muted={true} />
                        </div>
                        {/* Remote Streams */}
                        <div className="space-y-4">
                            <h2 className="text-xl font-semibold text-gray-300 border-b-2 border-gray-700 pb-2">Remote Streams</h2>
                            <VideoPlayer stream={remoteCamStream} label="Remote Camera" />
                            <VideoPlayer stream={remoteScreenStream} label="Remote Screen" />
                        </div>
                    </div>

                    {/* Controls */}
                    <div className="bg-gray-800 p-6 rounded-lg shadow-xl">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {/* Media Controls */}
                            <div className="space-y-4">
                                <h3 className="text-lg font-semibold text-gray-300">Media Controls</h3>
                                <div className="flex flex-wrap gap-3">
                                    {!localCamStream ? (
                                        <ControlButton onClick={startCamera} disabled={isCameraStarting}><CameraIcon /> {isCameraStarting ? 'Starting...' : 'Start Camera'}</ControlButton>
                                    ) : (
                                        <>
                                            <ControlButton onClick={toggleVideo} active={camHidden}>{camHidden ? <CameraOffIcon /> : <CameraIcon />}{camHidden ? 'Show Video' : 'Hide Video'}</ControlButton>
                                            <ControlButton onClick={toggleMic} active={micMuted}>{micMuted ? <MicOffIcon /> : <MicIcon />}{micMuted ? 'Unmute' : 'Mute'}</ControlButton>
                                            <ControlButton onClick={stopCamera} active={true}><CameraOffIcon /> Stop Camera</ControlButton>
                                        </>
                                    )}
                                     {!localScreenStream ? (
                                        <ControlButton onClick={startScreenShare} disabled={isScreenStarting}><ScreenShareIcon /> {isScreenStarting ? 'Sharing...' : 'Share Screen'}</ControlButton>
                                    ) : (
                                        <ControlButton onClick={stopScreenShare} active={true}><StopScreenShareIcon /> Stop Sharing</ControlButton>
                                    )}
                                     <ControlButton onClick={resetConnection} className="bg-gray-600 hover:bg-gray-700 focus:ring-gray-500"><RefreshIcon /> Reset</ControlButton>
                                </div>
                            </div>
                            {/* Signaling Controls */}
                            <div className="space-y-4">
                                <h3 className="text-lg font-semibold text-gray-300">Connection (Manual SDP Exchange)</h3>
                                <div className="space-y-3">
                                    <div>
                                        <label htmlFor="offer-sdp" className="block text-sm font-medium text-gray-400 mb-1">1. Create & Copy Offer / Paste Remote Offer</label>
                                        <textarea id="offer-sdp" value={offerSdp} onChange={(e) => setOfferSdp(e.target.value)} rows={3} className="w-full bg-gray-900 text-gray-300 rounded-md border border-gray-600 focus:ring-indigo-500 focus:border-indigo-500 text-xs p-2"></textarea>

                                        <div className="flex gap-2 mt-2">
                                            <button onClick={createOffer} className="text-sm bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded-md">Create Offer</button>
                                            <button onClick={() => copyToClipboard(offerSdp)} disabled={!offerSdp} className="text-sm bg-gray-600 hover:bg-gray-700 px-3 py-1 rounded-md flex items-center disabled:opacity-50">Copy<CopyIcon /></button>
                                        </div>
                                    </div>
                                    <div>
                                        <label htmlFor="answer-sdp" className="block text-sm font-medium text-gray-400 mb-1">2. Create & Copy Answer / Paste Remote Answer</label>
                                        <textarea id="answer-sdp" value={answerSdp} onChange={(e) => setAnswerSdp(e.target.value)} rows={3} className="w-full bg-gray-900 text-gray-300 rounded-md border border-gray-600 focus:ring-indigo-500 focus:border-indigo-500 text-xs p-2"></textarea>
                                        <div className="flex gap-2 mt-2">
                                            <button onClick={createAnswer} className="text-sm bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded-md">Create Answer</button>
                                            <button onClick={acceptAnswer} className="text-sm bg-green-600 hover:bg-green-700 px-3 py-1 rounded-md">Accept Answer</button>
                                            <button onClick={() => copyToClipboard(answerSdp)} disabled={!answerSdp} className="text-sm bg-gray-600 hover:bg-gray-700 px-3 py-1 rounded-md flex items-center disabled:opacity-50">Copy<CopyIcon/></button>
                                        </div>
                                    </div>
                                    <hr className="border-gray-600"/>
                                    <div>
                                        <h4 className="text-md font-semibold text-gray-300 mb-2">3. ICE Candidates (Advanced)</h4>
                                        <label htmlFor="local-ice" className="block text-sm font-medium text-gray-400 mb-1">Local Candidates (Automatically Gathered)</label>
                                        <textarea id="local-ice" readOnly value={JSON.stringify(localIceCandidates, null, 2)} rows={3} className="w-full bg-gray-900 text-gray-300 rounded-md border border-gray-600 focus:ring-indigo-500 focus:border-indigo-500 text-xs p-2"></textarea>
                                        <div className="flex gap-2 mt-2">
                                           <button onClick={() => copyToClipboard(JSON.stringify(localIceCandidates))} disabled={localIceCandidates.length === 0} className="text-sm bg-gray-600 hover:bg-gray-700 px-3 py-1 rounded-md flex items-center disabled:opacity-50">Copy Candidates<CopyIcon/></button>
                                        </div>
                                    </div>
                                     <div>
                                        <label htmlFor="remote-ice" className="block text-sm font-medium text-gray-400 mb-1">Paste Remote Candidates</label>
                                        <textarea id="remote-ice" value={remoteIceCandidates} onChange={(e) => setRemoteIceCandidates(e.target.value)} rows={3} className="w-full bg-gray-900 text-gray-300 rounded-md border border-gray-600 focus:ring-indigo-500 focus:border-indigo-500 text-xs p-2"></textarea>
                                        <div className="flex gap-2 mt-2">
                                           <button onClick={addRemoteCandidates} disabled={!remoteIceCandidates.trim()} className="text-sm bg-green-600 hover:bg-green-700 px-3 py-1 rounded-md disabled:opacity-50">Add Candidates</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </main>

                <footer className="mt-8 text-center">
                    <div className="bg-gray-800 inline-block px-4 py-2 rounded-lg">
                        <p className="text-gray-300 text-sm">
                            <span className="font-semibold">Status:</span> {statusText}
                        </p>
                    </div>
                </footer>
            </div>
        </div>
    );
}
