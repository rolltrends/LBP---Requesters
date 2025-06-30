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

// 🔐 Generate SDP Access Token using client_credentials
async function getSdpAccessToken() {
  const params = new URLSearchParams({
    client_id: process.env.SDP_CLIENT_ID,
    client_secret: process.env.SDP_CLIENT_SECRET,
    grant_type: 'authorization_code',
    scope: 'SDPOnDemand.users.ALL',
    content_type: 'application/json',

  });

  const { data } = await axios.post('https://accounts.zoho.com/oauth/v2/token', params, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',

    },
  });

  if (!data.access_token) {
    throw new Error('Access token not returned');
  }

  return data.access_token;
}

// 📥 Exposed endpoint to generate SDP token (optional for external use)
app.post('/sdp/token', async (req, res) => {
  try {
    const token = await getSdpAccessToken();
    console.log('🎟️ SDP Access Token:', token);
    res.json({ access_token: token });
  } catch (err) {
    console.error('❌ SDP token fetch failed:', err.response?.data || err.message);
    res.status(500).json({
      error: 'Failed to fetch SDP access token',
      details: err.response?.data || err.message,
    });
  }
});

// 👤 LDAP Login with token fetch
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const client = ldap.createClient({ url: 'ldap://ldap.forumsys.com:389' });
  const dn = `uid=${username},dc=example,dc=com`;

  client.bind(dn, password, async (err) => {
    if (err) {
      console.error('❌ LDAP login failed:', err.message);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log('✅ LDAP login successful:', username);
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
      console.error('⚠️ Token fetch failed after login:', tokenErr.message);
      res.json({
        message: 'Login successful (token unavailable)',
        username,
      });
    }
  });
});

// 🔍 Search requesters in SQL DB using Prisma
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

// 🚀 Start Express server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
});
