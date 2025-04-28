import { exec } from 'child_process';

export default function checkFFmpeg() {
  return new Promise((resolve, reject) => {
    exec('ffmpeg -version', (error) => {
      if (error) {
        console.error('FFmpeg is not installed or not in PATH. Video recording will not work.');
        reject(error);
      } else {
        console.log('FFmpeg is installed and available.');
        resolve();
      }
    });
  });
}