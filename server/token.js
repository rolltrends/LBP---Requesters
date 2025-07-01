const express = require('express');
const axios = require('axios');
const { exec } = require('child_process'); // ✅ No need for open

const app = express();
const port = 3005;

// ==== Replace with your actual Zoho credentials ====
const client_id = '1000.BUMQ784FBBFSLG679SKNQKWS937M6U';
const client_secret = '3d9e3edbe3e9262ac273f610d619bcfec791c66bc9';
const redirect_uri = 'http://localhost:3000/redirect_uri';
const scope = 'SDPOnDemand.users.ALL';
// ===================================================



const auth_url = `https://accounts.zoho.com/oauth/v2/auth?` +
  `scope=${encodeURIComponent(scope)}&` +
  `client_id=${client_id}&` +
  `response_type=code&` +
  `access_type=offline&` +
  `redirect_uri=${encodeURIComponent(redirect_uri)}&` +
  `prompt=consent`;

app.get('/redirect_uri', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send('❌ No authorization code received.');
  }

  try {
    const tokenResponse = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
      params: {
        code,
        client_id,
        client_secret,
        redirect_uri,
        grant_type: 'authorization_code',
      },
    });

    const { access_token, expires_in, refresh_token } = tokenResponse.data;

    console.log('\n✅ Access Token:', access_token);
    console.log('⏳ Expires in:', expires_in + ' seconds');
    console.log('🔁 Refresh Token:', refresh_token || 'Not available for this scope');

    res.send('<h2>✅ Access token received. You can now close this tab.</h2>');
  } catch (error) {
    console.error('❌ Token exchange failed:', error.response?.data || error.message);
    res.status(500).send('<h2>❌ Token exchange failed. Check the console.</h2>');
  }
});

app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
  console.log('🔗 Opening your browser to begin authentication...\n');

  // ✅ Native browser launcher
  const openInBrowser = process.platform === 'win32'
    ? `start "" "${auth_url}"`
    : process.platform === 'darwin'
    ? `open "${auth_url}"`
    : `xdg-open "${auth_url}"`;

  exec(openInBrowser, (err) => {
    if (err) {
      console.log('❌ Failed to open browser. Copy & paste this URL manually:\n' + auth_url);
    }
  });
});
