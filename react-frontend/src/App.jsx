import React, { useRef, useState } from 'react';

function App() {
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState([]);
  const [aslGloss, setAslGloss] = useState('');
  const [aslMode, setAslMode] = useState(false);
  const [error, setError] = useState('');
  const wsRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);

  const stopAudioProcessor = () => {
    if (processorRef.current) processorRef.current.disconnect();
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
    }
  };

  const startRecording = async () => {
    setTranscript([]);
    setAslGloss(''); // Clear previous ASL gloss
    setError('');
    
    wsRef.current = new WebSocket('ws://localhost:3001');
    
    wsRef.current.onmessage = (event) => {
      console.log('[WS MESSAGE]', event.data);
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'aslGloss') {
          console.log('[ASL GLOSS RECEIVED]', data.gloss);
          setAslGloss(data.gloss);
          return;
        }
        if (typeof data === 'object' && data.type) return;
      } catch {
        setTranscript((prev) => [...prev, event.data]);
      }
    };
    
    wsRef.current.onopen = async () => {
      console.log('[WS OPEN] Connection established');
      console.log('[WS OPEN] Current ASL mode state:', aslMode);
      
      // Send ASL mode toggle immediately after connection opens
      const aslMessage = JSON.stringify({ type: 'aslMode', enabled: aslMode });
      console.log('[WS OPEN] Sending message:', aslMessage);
      wsRef.current.send(aslMessage);
      
      try {
        mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        setError('Microphone access denied. Please allow microphone permissions.');
        wsRef.current.close();
        return;
      }
      
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000
      });
      
      const source = audioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
      processorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);
      source.connect(processorRef.current);
      processorRef.current.connect(audioContextRef.current.destination);
      
      processorRef.current.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== 1) return;

        const input = e.inputBuffer.getChannelData(0);
        const samples = resampleTo16k(input, audioContextRef.current.sampleRate);
        const int16Buffer = floatTo16BitPCM(samples);
        wsRef.current.send(int16Buffer.buffer);
      };
    };
    
    wsRef.current.onclose = () => {
      stopAudioProcessor();
      setRecording(false);
      setError('WebSocket connection closed. Please restart recording.');
    };
    
    setRecording(true);
  };

  const stopRecording = () => {
    setRecording(false);
    stopAudioProcessor();
    if (wsRef.current) wsRef.current.close();
  };

  // Update ASL mode and notify backend
  const handleASLModeChange = (e) => {
    const newMode = e.target.checked;
    setAslMode(newMode);
    console.log('[ASL MODE CHANGED]', newMode);
    
    if (wsRef.current && wsRef.current.readyState === 1) {
      console.log('[SENDING ASL MODE UPDATE]', newMode);
      wsRef.current.send(JSON.stringify({ type: 'aslMode', enabled: newMode }));
    }
  };

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', maxWidth: 800, margin: '50px auto', padding: 20 }}>
      <h1>🎤 Live Transcription Demo</h1>
      <label style={{ display: 'block', marginBottom: 10 }}>
        <input
          type="checkbox"
          checked={aslMode}
          onChange={handleASLModeChange}
          disabled={recording} // Disable changes during recording
          style={{ marginRight: 8 }}
        />
        ASL Transcription {aslMode && '(Enabled)'}
      </label>
      <button onClick={recording ? stopRecording : startRecording} style={{ padding: '12px 24px', fontSize: 16 }}>
        {recording ? 'Stop Recording' : 'Start Recording'}
      </button>
      {error && <div style={{ color: 'red', marginTop: 10 }}>{error}</div>}
      <div style={{ marginTop: 20, padding: 15, background: '#f9f9f9', border: '1px solid #ddd', minHeight: 200, borderRadius: 5, fontFamily: 'monospace' }}>
        <strong>Transcript:</strong>
        <div>
          {transcript.length === 0
            ? 'Transcript will appear here...'
            : transcript.map((line, idx) => <div key={idx}>{line}</div>)}
        </div>
      </div>
      {aslMode && (
        <div style={{ marginTop: 20, padding: 15, background: '#e6f7ff', border: '1px solid #8ecae6', minHeight: 100, borderRadius: 5, fontFamily: 'monospace' }}>
          <strong>ASL Gloss:</strong>
          <div>{aslGloss || 'ASL gloss will appear here after a pause...'}</div>
        </div>
      )}
    </div>
  );
}

export default App;

// Convert Float32 to Int16
function floatTo16BitPCM(float32Array) {
  const buffer = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    buffer[i] = Math.max(-32768, Math.min(32767, float32Array[i] * 32767));
  }
  return buffer;
}

// Simple linear resampling from current sample rate to 16kHz
function resampleTo16k(buffer, originalRate) {
  if (originalRate === 16000) return buffer;
  const ratio = originalRate / 16000;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    result[i] = buffer[Math.floor(i * ratio)] || 0;
  }
  return result;
}