const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const ldap = require('ldapjs');
const axios = require('axios');
require('dotenv').config();

const app = express();
const prisma = new PrismaClient();

app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json());

// 🔐 Get Zoho SDP Access Token
async function getSdpAccessToken() {
  const { data } = await axios.post(
    'https://accounts.zoho.com/oauth/v2/token',
    new URLSearchParams({
      refresh_token: process.env.SDP_REFRESH_TOKEN,
      client_id: process.env.SDP_CLIENT_ID,
      client_secret: process.env.SDP_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  if (!data.access_token) throw new Error('Access token not returned');
  return data.access_token;
}


// Add this route to handle Zoho OAuth redirect and token exchange
app.get('/redirect_uri', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.status(400).send('❌ No authorization code received.');
  }

  try {
    // 🎟️ Exchange authorization code for access and refresh tokens
    const tokenResponse = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
      params: {
        code,
        client_id: process.env.SDP_CLIENT_ID,
        client_secret: process.env.SDP_CLIENT_SECRET,
        redirect_uri: process.env.SDP_REDIRECT_URI, // must match the one used during login
        grant_type: 'authorization_code',
      },
    });

    const { access_token, expires_in, refresh_token } = tokenResponse.data;

    // ✅ Log token info (for development)
    console.log('\n✅ Access Token:', access_token);
    console.log('⏳ Expires in:', expires_in + ' seconds');
    console.log('🔁 Refresh Token:', refresh_token || 'Not available for this scope');

    // 📌 Optional: Store token in memory (replace with DB or session storage in production)
    global.ZOHO_ACCESS_TOKEN = access_token;
    global.ZOHO_REFRESH_TOKEN = refresh_token;

    // ✅ Redirect user back to frontend UI (e.g., homepage or requester search)
    res.redirect('http://localhost:3000/requester_search'); // Change this to your frontend route
    // Note: Ensure this URL matches your frontend's route for handling successful login
    // You can change above to: res.redirect('http://localhost:3000/requesters');
  } catch (error) {
    // ❌ If token exchange fails, show a user-friendly error page
    console.error('❌ Token exchange failed:', error.response?.data || error.message);
    res.status(500).send('<h2>❌ Token exchange failed. Please check the server logs.</h2>');
  }
});
// 🔑 Login
// Simple in-memory session store (for demo; use Redis or DB in production)
const sessions = {};
const SESSION_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const client = ldap.createClient({ url: 'ldap://ldap.forumsys.com:389' });
  const dn = `uid=${username},dc=example,dc=com`;

  client.bind(dn, password, async (err) => {
    if (err) return res.status(401).json({ error: 'Invalid credentials' });

    try {
      // Generate a simple session token (use JWT or uuid in production)
      const sessionId = Math.random().toString(36).substr(2);
      const expiresAt = Date.now() + SESSION_EXPIRY_MS;
      sessions[sessionId] = { username, expiresAt };

      // Instead of fetching Zoho token, send OAuth URL to frontend
      const client_id = process.env.SDP_CLIENT_ID;
      const redirect_uri = process.env.SDP_REDIRECT_URI; // e.g., http://localhost:3000/redirect_uri
      const scope = 'SDPOnDemand.users.ALL';
      const auth_url = `https://accounts.zoho.com/oauth/v2/auth?` +
        `scope=${encodeURIComponent(scope)}&` +
        `client_id=${client_id}&` +
        `response_type=code&` +
        `access_type=offline&` +
        `redirect_uri=${encodeURIComponent(redirect_uri)}&` +
        `prompt=consent`;

      res.json({
        message: 'LDAP login successful. Proceed to Zoho OAuth.',
        username,
        session_id: sessionId,
        expires_at: expiresAt,
        zoho_oauth_url: auth_url
      });
    } finally {
      client.unbind();
    }
  });
});

// Middleware example to check session (use in protected routes)
function requireSession(req, res, next) {
  const sessionId = req.headers['x-session-id'];
  const session = sessions[sessionId];
  if (!session || session.expiresAt < Date.now()) {
    return res.status(401).json({ error: 'Session expired or invalid' });
  }
  req.session = session;
  next();
}

// 🔍 Search Requesters (using mock or direct DB)
app.get('/requesters', async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'Missing search term' });

  try {
    const results = await prisma.requester.findMany({
      where: {
        OR: [
          { first_name: { contains: name } },
          { last_name: { contains: name } },
          { email_id: { contains: name } },
          { phone_num: { contains: name } },
        ]
      },
      take: 10,
    });
    res.json(results);
  } catch (error) {
    console.error('Search failed:', error.message);
    res.status(500).json({ error: 'Search failed', details: error.message });
  }
});

// 🚀 Push Requester to SDP
app.post('/push/requester/:id', async (req, res) => {
  try {
    const requester = await prisma.requester.findUnique({
      where: { id: parseInt(req.params.id) }
    });

    if (!requester) return res.status(404).json({ error: 'Requester not found' });

    const token = await getSdpAccessToken();

    const payload = {
      requesters: {
        name: `${requester.first_name} ${requester.last_name}`,
        email_id: requester.email_id,
        phone: requester.phone_num,
        mobile: requester.mobile,
        employee_id: requester.employee_id,
        job_title: requester.job_title,
        description: requester.description
      }
    };

    const url = `https://sdpondemand.manageengine.com/api/v3/requesters?input_data=${encodeURIComponent(JSON.stringify(payload))}`;

    const response = await axios.post(url, {}, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` }
    });

    res.json({ success: true, sdp_response: response.data });
  } catch (err) {
    console.error('Push failed:', err.message);
    res.status(500).json({ error: 'Push failed', details: err.message });
  }
});

// ✅ Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
