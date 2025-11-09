const { Deepgram } = require('@deepgram/sdk');
const deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY);

async function transcribeAudioStream(audioStream) {
  return deepgram.transcription.live({
    punctuate: true,
    language: 'en-US',
  }, audioStream);
}

module.exports = { transcribeAudioStream };
