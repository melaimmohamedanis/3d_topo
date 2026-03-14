import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';

export const VideoRecordingHelper = () => {
  const { gl } = useThree();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunks = useRef<Blob[]>([]);

  useEffect(() => {
    // Attach the toggle function to the window
    // We pass a callback so the outside UI knows when state changes
    (window as any).toggleVideoRecording = (onStateChange?: (isRecording: boolean) => void) => {
      
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
        // --- START RECORDING ---
        recordedChunks.current = [];
        
        // Grab the stream directly from R3F's canvas rendering engine
     // Inside your VideoRecordingHelper component:

// Grab the stream (crank up to 60 FPS if you want it buttery smooth)
const stream = gl.domElement.captureStream(60); 

const options = { 
  mimeType: 'video/webm; codecs=vp9',
  // Crank the bitrate up to 10 Mbps (10,000,000) or even 20 Mbps for crystal clear HD
  videoBitsPerSecond: 15000000 
};

let recorder: MediaRecorder;

try {
  recorder = new MediaRecorder(stream, options);
} catch (e) {
  // Fallback if the browser doesn't like the specific codec/bitrate combo
  recorder = new MediaRecorder(stream, { videoBitsPerSecond: 15000000 }); 
}

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) recordedChunks.current.push(e.data);
        };

        recorder.onstop = () => {
          const blob = new Blob(recordedChunks.current, { type: 'video/webm' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `3d-animation-record-${new Date().getTime()}.webm`;
          a.click();
          URL.revokeObjectURL(url);
        };

        recorder.start();
        mediaRecorderRef.current = recorder;
        
        // Tell the UI we are recording
        if (onStateChange) onStateChange(true); 

      } else {
        // --- STOP RECORDING ---
        mediaRecorderRef.current.stop();
        
        // Tell the UI we stopped
        if (onStateChange) onStateChange(false);
      }
    };

    // Cleanup to prevent memory leaks if the canvas unmounts while recording
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      delete (window as any).toggleVideoRecording;
    };
  }, [gl]);

  return null; // Invisible component
};