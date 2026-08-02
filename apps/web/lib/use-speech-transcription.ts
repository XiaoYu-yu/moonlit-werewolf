'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { transcribeAudio } from './live-api';

const MAX_RECORDING_MS = 55_000;

function chooseMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4')) return 'm4a';
  return 'webm';
}

export function useSpeechTranscription(enabled: boolean) {
  const mountedRef = useRef(true);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timeoutRef = useRef<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [transcriptRevision, setTranscriptRevision] = useState(0);
  const [status, setStatus] = useState<string>();

  const releaseStream = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') recorder.stop();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const recorder = recorderRef.current;
      if (recorder?.state === 'recording') recorder.stop();
      recorderRef.current = null;
      releaseStream();
    };
  }, [releaseStream]);

  const toggle = useCallback(async () => {
    if (!enabled) {
      setStatus('本地演示不上传语音，请切换到实时房间使用转写。');
      return;
    }
    if (recording) {
      stop();
      return;
    }
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('当前浏览器不支持网页录音。');
      return;
    }

    setStatus(undefined);
    setTranscript('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const mimeType = chooseMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });
      recorder.addEventListener(
        'stop',
        () => {
          const finalMime = recorder.mimeType || mimeType || 'audio/webm';
          const audio = new Blob(chunksRef.current, { type: finalMime });
          recorderRef.current = null;
          chunksRef.current = [];
          if (!mountedRef.current) {
            releaseStream();
            return;
          }
          setRecording(false);
          releaseStream();
          if (audio.size === 0) {
            setStatus('没有录到有效语音，请重试。');
            return;
          }
          setTranscribing(true);
          setStatus('正在转写语音…');
          void transcribeAudio(audio, `speech.${extensionForMime(finalMime)}`)
            .then((result) => {
              if (!mountedRef.current) return;
              const text = result.text.trim();
              if (!text) {
                setStatus('未识别到清晰语音。');
                return;
              }
              setTranscript(text);
              setTranscriptRevision((value) => value + 1);
              setStatus('语音已转成文字，请确认后发送。');
            })
            .catch((error: unknown) => {
              if (!mountedRef.current) return;
              setStatus(error instanceof Error ? error.message : '语音转写失败，请稍后重试。');
            })
            .finally(() => {
              if (mountedRef.current) setTranscribing(false);
            });
        },
        { once: true },
      );

      recorder.start(250);
      setRecording(true);
      setStatus('正在录音，再次轻触结束。');
      timeoutRef.current = window.setTimeout(stop, MAX_RECORDING_MS);
    } catch (error) {
      releaseStream();
      if (!mountedRef.current) return;
      setRecording(false);
      setStatus(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? '未获得麦克风权限，请在浏览器设置中允许。'
          : '无法启动麦克风录音。',
      );
    }
  }, [enabled, recording, releaseStream, stop]);

  return {
    recording,
    transcribing,
    transcript,
    transcriptRevision,
    status,
    toggle,
  };
}
