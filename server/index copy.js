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

// 🔐 SDP token generator helper function
async function getSdpAccessToken() {
  const { data } = await axios.post(
    'https://accounts.zoho.com/oauth/v2/token',
    new URLSearchParams({
      refresh_token: process.env.SDP_REFRESH_TOKEN,
      client_id: process.env.SDP_CLIENT_ID,
      client_secret: process.env.SDP_CLIENT_SECRET,
      grant_type: 'refresh_token',
      redirect_uri: process.env.SDP_REDIRECT_URI || '',
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  if (!data.access_token) {
    throw new Error('Access token not returned by SDP');
  }

  return data.access_token;
}

// 📥 Generate SDP access token (external endpoint)
app.post('/sdp/token', async (req, res) => {
  try {
    const token = await getSdpAccessToken();
    console.log('🎟️ SDP Access Token:', token);
    res.json({ access_token: token });
  } catch (err) {
    console.error('❌ Token fetch error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Token fetch failed', details: err.response?.data || err.message });
  }
});

// 👤 LDAP login with token fetch
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const client = ldap.createClient({ url: 'ldap://ldap.forumsys.com:389' });
  const dn = `uid=${username},dc=example,dc=com`;

  client.bind(dn, password, async (err) => {
    if (err) {
      console.error('❌ LDAP login failed:', err.message);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log('✅ LDAP login successful for', username);
    client.unbind();

    try {
      const token = await getSdpAccessToken();
      console.log('🎟️ SDP Token after login:', token);
      res.json({
        message: 'Login successful',
        access_token: token,
        username,
      });
    } catch (tokenErr) {
      console.error('⚠️ Failed to get SDP token:', tokenErr.message);
      res.json({
        message: 'Login successful (but failed to get token)',
        username,
      });
    }
  });
});

// 🔎 SQL search by name/email/phone using Prisma
app.get('/requesters', async (req, res) => {
  const { name } = req.query;

  if (!name) {
    return res.status(400).json({ error: 'Search term is required' });
  }

  try {
    const results = await prisma.requester.findMany({
      where: {
        OR: [
          { first_name: { contains: name } },
          { last_name: { contains: name } },
          { email_id: { contains: name } },
          { phone_num: { contains: name } },
        ],
      },
      take: 10,
    });

    res.json(results);
  } catch (error) {
    console.error('❌ Prisma search error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// 🚀 Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
