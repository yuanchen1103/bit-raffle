const fs = require('fs');
const Hapi = require('hapi');
const path = require('path');
const Boom = require('boom');
const color = require('color');
const ext = require('commander');
const jsonwebtoken = require('jsonwebtoken');
const shortId = require('shortid');
const fetch = require('isomorphic-fetch')
// const request = require('request');

// The developer rig uses self-signed certificates.  Node doesn't accept them
// by default.  Do not use this in production.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Use verbose logging during development.  Set this to false for production.
const verboseLogging = true;
const verboseLog = verboseLogging ? console.log.bind(console) : () => { };

// Service state variables
const initialColor = color('#6441A4');      // set initial color; bleedPurple
const bearerPrefix = 'Bearer ';             // HTTP authorization headers have this prefix
const colorWheelRotation = 30;
const channelColors = {};

const gambles = {};
const coinData = {};

const STRINGS = {
  secretEnv: usingValue('secret'),
  clientIdEnv: usingValue('client-id'),
  serverStarted: 'Server running at %s',
  secretMissing: missingValue('secret', 'EXT_SECRET'),
  clientIdMissing: missingValue('client ID', 'EXT_CLIENT_ID'),
  cyclingColor: 'Cycling color for c:%s on behalf of u:%s',
  sendColor: 'Sending color %s to c:%s',
  invalidAuthHeader: 'Invalid authorization header',
  invalidJwt: 'Invalid JWT'
};

ext.
  version(require('../package.json').version).
  option('-s, --secret <secret>', 'Extension secret').
  option('-c, --client-id <client_id>', 'Extension client ID').
  parse(process.argv);

const secret = Buffer.from(getOption('secret', 'ENV_SECRET'), 'base64');
const clientId = getOption('clientId', 'ENV_CLIENT_ID');
const TWITCH_API_BASE='https://api.twitch.tv/extensions'

const serverOptions = {
  host: 'localhost',
  port: 8081,
  routes: {
    cors: {
      origin: ['*']
    }
  }
};
const serverPathRoot = path.resolve(__dirname, '..', 'conf', 'server');
if (fs.existsSync(serverPathRoot + '.crt') && fs.existsSync(serverPathRoot + '.key')) {
  serverOptions.tls = {
    // If you need a certificate, execute "npm run cert".
    cert: fs.readFileSync(serverPathRoot + '.crt'),
    key: fs.readFileSync(serverPathRoot + '.key')
  };
}
const server = new Hapi.Server(serverOptions);

(async () => {
  server.route({
    method: 'POST',
    path: '/color/cycle',
    handler: colorCycleHandler
  });

  // Handle a new viewer requesting the color.
  server.route({
    method: 'GET',
    path: '/color/query',
    handler: colorQueryHandler
  });

  server.route({
    method: 'POST',
    path: '/gamble/start',
    handler: gambleStartHandler
  });

  server.route({
    method: 'GET',
    path: '/gamble/query',
    handler: gambleQueryHandler
  });

  server.route({
    method: 'POST',
    path: '/gamble/end',
    handler: gambleEndHandler
  });

  server.route({
    method: 'POST',
    path: '/gamble/vote',
    handler: gambleVoteHandler
  });

  // Start the server.
  await server.start();
  console.log(STRINGS.serverStarted, server.info.uri);
})();

function usingValue (name) {
  return `Using environment variable for ${name}`;
}

function missingValue (name, variable) {
  const option = name.charAt(0);
  return `Extension ${name} required.\nUse argument "-${option} <${name}>" or environment variable "${variable}".`;
}

// Get options from the command line or the environment.
function getOption (optionName, environmentName) {
  const option = (() => {
    if (ext[optionName]) {
      return ext[optionName];
    } else if (process.env[environmentName]) {
      console.log(STRINGS[optionName + 'Env']);
      return process.env[environmentName];
    }
    console.log(STRINGS[optionName + 'Missing']);
    process.exit(1);
  })();
  console.log(`Using "${option}" for ${optionName}`);
  return option;
}

// Verify the header and the enclosed JWT.
function verifyAndDecode (header) {
  if (header.startsWith(bearerPrefix)) {
    try {
      const token = header.substring(bearerPrefix.length);
      return jsonwebtoken.verify(token, secret, { algorithms: ['HS256'] });
    }
    catch (ex) {
      throw Boom.unauthorized(STRINGS.invalidJwt);
    }
  }
  throw Boom.unauthorized(STRINGS.invalidAuthHeader);
}

function gambleStartHandler (req) {
  const { channel_id: channelId, opaque_user_id: opaqueUserId } = verifyAndDecode(req.headers.authorization);
  const { options } = req.payload;

  // const gambleId = `gamble-${shortid.generate()}
  const gambleId = `gamble`;

  gambles[gambleId] = options;
  verboseLog(gambleId, gambles[gambleId]);

  return gambleId
}

function sendMsgToChatRoom (channelId, message) {
  let token = jsonwebtoken.sign({
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
    user_id: '29398066',
    role: 'external',
  }, secret)
  verboseLog('generate dynamic token: ', token)

  return fetch(`${TWITCH_API_BASE}/${clientId}/0.0.1/channels/${channelId}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Client-ID': clientId,
    },
    body: JSON.stringify({
      text: message
    })
  }).then(data => data.json()).then(resp => {
    verboseLog(resp)
    return Promise.resolve(resp)
  })
}

function gambleQueryHandler (req) {
  // Verify all requests.
  const { channel_id: channelId, opaque_user_id: opaqueUserId } = verifyAndDecode(req.headers.authorization);
  const gambleId = `gamble`;

  const options = gambles[gambleId];

  verboseLog(gambleId, options);

  return options;
}

function gambleEndHandler (req) {
  // Verify all requests.
  const { channel_id: channelId, opaque_user_id: opaqueUserId } = verifyAndDecode(req.headers.authorization);
  const { index } = req.payload;

  const gambleId = 'gamble';

  const totalVoters = gambles[gambleId].reduce((number, { voters }) => {
    return voters ? number + voters.length : number;
  }, 0);

  gambles[gambleId][index].result = true;

  const coins = Math.floor(totalVoters / (gambles[gambleId][index].voters || []).length)

  for (let i = 0; i < (gambles[gambleId][index].voters || []).length; i++) {
    if (!coinData[gambles[gambleId][index].voters[i]]) {
      coinData[gambles[gambleId][index].voters[i]] = 0;
    }
    coinData[gambles[gambleId][index].voters[i]] += coins;
  }

  verboseLog(gambleId, gambles[gambleId]);

  let winners = gambles[gambleId][index].voters || []

  let msg = `恭喜: ${winners.join(', ')}獲得了${(Number.isNaN(coins) ? 0 : coins)}個bits`
  return sendMsgToChatRoom(channelId, msg).then(resp => {
    return {
      coins,
      winners
    }
  })
}

function gambleVoteHandler (req) {
  // Verify all requests.
  const { channel_id: channelId, opaque_user_id: opaqueUserId } = verifyAndDecode(req.headers.authorization);
  const { index, userId } = req.payload;

  const gambleId = 'gamble';

  gambles[gambleId][index].number = (gambles[gambleId][index].number || 0) + 1;
  if (!gambles[gambleId][index].voter) gambles[gambleId][index].voter = [];
  gambles[gambleId][index].voter.push(userId);

  verboseLog(gambleId, gambles[gambleId]);

  return gambleId;
}

function colorCycleHandler (req) {
  // Verify all requests.
  const payload = verifyAndDecode(req.headers.authorization);
  const { channel_id: channelId, opaque_user_id: opaqueUserId } = payload;

  // Store the color for the channel.
  let currentColor = channelColors[channelId] || initialColor;

  // Rotate the color as if on a color wheel.
  verboseLog(STRINGS.cyclingColor, channelId, opaqueUserId);
  currentColor = color(currentColor).rotate(colorWheelRotation).hex();

  // Save the new color for the channel.
  channelColors[channelId] = currentColor;

  return currentColor;
}

function colorQueryHandler (req) {
  // Verify all requests.
  const payload = verifyAndDecode(req.headers.authorization);

  // Get the color for the channel from the payload and return it.
  const { channel_id: channelId, opaque_user_id: opaqueUserId } = payload;
  const currentColor = color(channelColors[channelId] || initialColor).hex();
  verboseLog(STRINGS.sendColor, currentColor, opaqueUserId);
  return currentColor;
}
