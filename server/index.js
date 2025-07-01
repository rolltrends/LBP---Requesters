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
      client_id: process.env.SDP_CLIENT_ID,
      client_secret: process.env.SDP_CLIENT_SECRET,
      grant_type: 'client_credentials',
      scope: 'SDPOnDemand.users.ALL'
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  if (!data.access_token) throw new Error('Access token not returned');
  return data.access_token;
}

// 🔑 Login
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const client = ldap.createClient({ url: 'ldap://ldap.forumsys.com:389' });
  const dn = `uid=${username},dc=example,dc=com`;

  client.bind(dn, password, async (err) => {
    if (err) return res.status(401).json({ error: 'Invalid credentials' });

    try {
      const token = await getSdpAccessToken();
      res.json({ message: 'Login successful', access_token: token, username });
    } catch (tokenErr) {
      res.json({ message: 'Login succeeded (token fetch failed)', username });
    } finally {
      client.unbind();
    }
  });
});

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
