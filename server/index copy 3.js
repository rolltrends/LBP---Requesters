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

// ... (keep your existing requires and initial setup)

const sessions = {};
const SESSION_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

// 🧾 Audit Logger
async function logAudit(username, actionId, action, module) {
  try {
    await prisma.auditLog.create({
      data: { username, actionId, action, module }
    });
  } catch (err) {
    console.error('❌ Failed to log audit:', err.message);
  }
}

// ✅ Middleware to check session
function requireSession(req, res, next) {
  const sessionId = req.headers['x-session-id'];
  const session = sessions[sessionId];
  if (!session || session.expiresAt < Date.now()) {
    return res.status(401).json({ error: 'Session expired or invalid' });
  }
  req.session = session;
  next();
}

// 📜 Get Audit Logs
app.get('/audit_logs', requireSession, async (req, res) => {
  const { username, module } = req.query;

  try {
    const logs = await prisma.auditLog.findMany({
      where: {
        ...(username && { username }),
        ...(module && { module }),
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    await logAudit(req.session.username, 'VIEW_AUDIT_LOGS', 'Viewed audit logs', 'Audit');

    res.json(logs);
  } catch (err) {
    console.error('❌ Error fetching audit logs:', err.message);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

// 🔑 Login
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const client = ldap.createClient({ url: 'ldap://ldap.forumsys.com:389' });
  const dn = `uid=${username},dc=example,dc=com`;

  client.bind(dn, password, async (err) => {
    if (err) return res.status(401).json({ error: 'Invalid credentials' });

    try {
      const sessionId = Math.random().toString(36).substr(2);
      const expiresAt = Date.now() + SESSION_EXPIRY_MS;
      sessions[sessionId] = { username, expiresAt };

      await logAudit(username, 'LOGIN', 'Logged in successfully', 'Auth');

      const client_id = process.env.SDP_CLIENT_ID;
      const redirect_uri = process.env.SDP_REDIRECT_URI;
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

// 🔍 Search Requesters
app.get('/requesters', requireSession, async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'Search term is required' });

  try {
    const response = await axios.get('http://localhost:5050/lbp/requesters', {
      params: { search: name },
    });

    await logAudit(req.session.username, 'SEARCH_REQUESTER', `Searched for: ${name}`, 'Requester');

    res.json(response.data);
  } catch (error) {
    console.error('Search failed:', error.message);
    res.status(500).json({ error: 'Search failed', details: error.message });
  }
});

// 🚀 Push Requester to SDP
app.post('/push_requester', requireSession, async (req, res) => {
  try {
    const requester = req.body;
    const token = global.ZOHO_ACCESS_TOKEN;

    if (!token) return res.status(401).json({ error: 'No Zoho access token. Please authenticate via OAuth.' });

    const payload = {
      requester: {
        name: `${requester.first_name} ${requester.last_name}`,
        first_name: requester.first_name,
        last_name: requester.last_name,
        email_id: requester.email_id,
        phone: requester.phone_num,
        mobile: requester.mobile,
        employee_id: requester.employee_id,
        job_title: requester.job_title,
        description: requester.description
      }
    };

    const url = process.env.SDP_ENV_URL + `/api/v3/requesters?input_data=${encodeURIComponent(JSON.stringify(payload))}`;
    const response = await axios.post(url, {}, {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/vnd.manageengine.sdp.v3+json'
      }
    });

    await logAudit(req.session.username, 'PUSH_REQUESTER', `Pushed requester ${requester.email_id}`, 'Requester');

    res.json({ success: true, sdp_response: response.data });
  } catch (err) {
    console.error('Push failed:', err.message);
    res.status(500).json({ error: 'Push failed', details: err.message });
  }
});
