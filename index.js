const speech = require('@google-cloud/speech');
const {Storage} = require('@google-cloud/storage');
const storage = new Storage();
const bucket = storage.bucket(process.env.BUCKET);
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  secure: true, // true for 465, false for other ports
  auth: {
    user: process.env.USER,
    pass: process.env.PASS
  }
});

const ffmpeg = require('fluent-ffmpeg');

exports.helloGCSGeneric = (data, context) => {
  const file = data;

  if (file.contentType === 'audio/flac') {
    return false;
  }

  const remoteWriteStream = bucket.file(file.name.replace('.mp3', '.flac'))
    .createWriteStream({
      metadata: {
        metadata: file.metadata,
        contentType: 'audio/flac',
      },
    });

  const remoteReadStream = bucket.file(file.name).createReadStream();
  ffmpeg()
    .input(remoteReadStream)
    .outputFormat('flac')
    .outputOptions('-ac 1')
    .outputOptions('-ar 16000')
    .outputOptions('-sample_fmt s16')
    .on('start', (cmdLine) => {
      console.log('Started ffmpeg with command:', cmdLine);
    })
    .on('end', () => {
      console.log('Successfully re-encoded video.');

      const payload = {
        config: {
          encoding: 'FLAC',
          sampleRateHertz: 16000,
          languageCode: 'ja-JP'
        },
        audio: {
          uri: `gs://${file.bucket}/${file.name.replace('.mp3', '.flac')}`
        }
      }

      const speechClient = new speech.SpeechClient();
      speechClient.longRunningRecognize(payload).then(data => {
        const res = data[0];
        return res.promise();
      }).then(data => {
        const toEmail = file.name.replace('.mp3', '');
        console.log(`Email: ${toEmail}`);

        const res = data[0];
        const transcription = res.results.map(result => result.alternatives[0].transcript).join('\n');
        const mailOptions = {
          from: process.env.USER,
          to: toEmail,
          subject: '議事録',
          text: transcription,
        };

        transporter.sendMail(mailOptions, (error, info) => {
          console.log(error || info);
        })
      });
      callback();
    })
    .on('error', (err, stdout, stderr) => {
      console.error('An error occured during encoding', err.message);
      console.error('stdout:', stdout);
      console.error('stderr:', stderr);
      callback(err);
    })
    .pipe(remoteWriteStream, { end: true });
};
