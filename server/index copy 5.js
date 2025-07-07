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

const sessions = {};
const SESSION_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

// 🧾 Audit Logger
async function logAudit({username, module, action, old_value = '', new_value = ''}) {
  try {
    await prisma.AuditTrail.create({
      data: { 
        username, 
        module, 
        action, 
        old_value, 
        new_value
      }
    });
  } catch (err) {
    console.error('❌ Failed to log audit:', err.message);
  }
}

// ✅ Middleware to check session
function requireSession(req, res, next) {
  const sessionId = req.headers['x-session-id'];
  const session = sessions[sessionId];
  if (!session) {
    console.log('Session not found:', sessionId);
    return res.status(401).json({ error: 'Session expired or invalid' });
  }
  if (session.expiresAt < Date.now()) {
    console.log('Session expired:', sessionId);
    return res.status(401).json({ error: 'Session expired or invalid' });
  }
  req.session = session;
  next();
}

// // 🧾 Audit Logger
// async function logAudit(username, action, module) {
//   try {
//     await prisma.AuditTrail.create({
//       data: { user, action, module, old_value, new_value }
//     });
//   } catch (err) {
//     console.error('❌ Failed to log audit:', err.message);
//   }
// }

// 📜 Get Audit Logs
app.get('/audit_logs', requireSession, async (req, res) => {
  const { username, module } = req.query;

  try {
    const logs = await prisma.AuditTrail.findMany({
      where: {
        ...(username && { username }),
        ...(module && { module }),
      },
      orderBy: { timestamp: 'desc' },
      take: 100
    });

    await logAudit({
      username: req.session.username,
      module: 'Audit',
      action: 'VIEW_AUDIT_LOGS',
      old_value: '',
      new_value: 'Viewed audit logs'
    });

    res.json(logs);
  } catch (err) {
    console.error('❌ Error fetching audit logs:', err.message);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});


// Add this route to handle Zoho OAuth redirect and token exchange
app.get('/redirect_uri', async (req, res) => {
  // const { code } = req.query;
  const { code, state } = req.query;
  const sessionId = state;
  const session = sessions[sessionId];
  const username = session?.username;


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

    await logAudit({
      username,
      module: 'ZOHO_OAUTH',
      action: 'ZOHO Access Token Generated',
      old_value: '',
      new_value: `Zoho token received. Expires in ${expires_in} seconds`
    });

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
app.post('/login', (req, res) => {
  
  const { username, password } = req.body;
  const client = ldap.createClient({ url: process.env.LDAP_URL, port: process.env.LDAP_PORT });
  const ldap_ou = process.env.LDAP_OU || 'scientists'; // Default to 'scientists' if not set
  // const dn = `uid=${username},${ldap_ou},dc=example,dc=com`;
  const dn = `uid=${username},dc=example,dc=com`;
  console.log('🔍 Attempting LDAP bind with DN:', dn);
  client.on('error', err => {
    console.error('LDAP client error:', err.message);
  });
  console.log("test")

  client.bind(dn, password, async (err) => {
    
    if (err) return res.status(401).json({ error: 'Unauthorized Access Denied!' });
      console.error('❌ LDAP bind failed:', err.message);
    try {
      // Generate a simple session token (use JWT or uuid in production)
      const sessionId = Math.random().toString(36).substr(2);
      const expiresAt = Date.now() + SESSION_EXPIRY_MS;
      sessions[sessionId] = { username, expiresAt };

      // data: { username, actionId, module, action, old_value, new_value }
      await logAudit({
        username,
        module: 'AUTHENTICATION',
        action: 'LOGGED IN',
        old_value: '',
        new_value: 'Technician logged in successfully'
      });
      // console.log(logAudit({
      //   username,
      //   module: 'Technician logged in',
      //   action: 'LOGIN',
      //   old_value: '',
      //   new_value: ''
      // }));
      // Instead of fetching Zoho token, send OAuth URL to frontend
      const client_id = process.env.SDP_CLIENT_ID;
      const redirect_uri = process.env.SDP_REDIRECT_URI; // e.g., http://localhost:3000/redirect_uri
      const scope = 'SDPOnDemand.users.ALL';
      // const auth_url = `https://accounts.zoho.com/oauth/v2/auth?` +
      //   `scope=${encodeURIComponent(scope)}&` +
      //   `client_id=${client_id}&` +
      //   `response_type=code&` +
      //   `access_type=offline&` +
      //   `redirect_uri=${encodeURIComponent(redirect_uri)}&` +
      //   `prompt=consent`;
      const auth_url = `https://accounts.zoho.com/oauth/v2/auth?` +
        `scope=${encodeURIComponent(scope)}&` +
        `client_id=${client_id}&` +
        `response_type=code&` +
        `access_type=offline&` +
        `redirect_uri=${encodeURIComponent(redirect_uri)}&` +  // unchanged
        `prompt=consent&` +
        `state=${sessionId}`; // ✅ pass session ID via state


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


app.post('/logout', requireSession, async (req, res) => {
  const sessionId = req.headers['x-session-id'];
  const username = req.session.username;

  if (sessionId && sessions[sessionId]) {
    // ✅ Log before deleting the session
    await logAudit({
      username,
      module: 'AUTHENTICATION',
      action: 'LOGOUT',
      old_value: '',
      new_value: 'Technician logged out successfully'
    });

    delete sessions[sessionId];
  }

  res.json({ message: 'Logged out successfully' });
});



// // 🔍 Search Requesters (fetch from mock-app)
// app.get('/requesters', requireSession, async (req, res) => {
//   const { search } = req.query;
//   if (!search || search.trim() === '') {
//     return res.status(400).json({ error: 'Search query is required' });
//   }

//   try {
//     // Step 1: Search from local SQLite (Prisma)
//     const localResults = await prisma.Requester.findMany({
//       where: {
//         OR: [
//           { name: { contains: search } },
//           { first_name: { contains: search } },
//           { last_name: { contains: search } },
//           { email_id: { contains: search } },
//           { phone_num: { contains: search } },
//           { mobile: { contains: search } },
//           { employee_id: { contains: search } },
//           { job_title: { contains: search } },
//           { gender: { contains: search } },
//           { description: { contains: search } },
//         ]
//       }
//     });

//     // 👉 Add source tag
//     const localTagged = localResults.map(user => ({ ...user, source: 'local' }));

//     // Step 2: Search from external API
//     const externalResponse = await axios.get('http://localhost:5050/lbp/requesters', {
//       params: { search: search },
//     });
//     const externalRaw = externalResponse.data || [];
//     const externalTagged = externalRaw.map(user => ({ ...user, source: 'external' }));

//     // Step 3: Combine both results (keep all)
//     const combined = [...localTagged, ...externalTagged];

//     // Step 4: Deduplicate by email_id (keep external if already in local)
//     const deduped = Object.values(
//       combined.reduce((acc, curr) => {
//         acc[curr.email_id] = acc[curr.email_id] && acc[curr.email_id].source === 'local'
//           ? acc[curr.email_id]
//           : curr;
//         return acc;
//       }, {})
//     );

//     // Step 5: Log the audit
//     await logAudit({
//       username: req.session.username,
//       module: 'Requester',
//       action: 'SEARCH',
//       old_value: '',
//       new_value: `Searched for: ${search}`
//     });

//     res.json(deduped);

//   } catch (error) {
//     console.error('❌ Search error:', error.message);
//     res.status(500).json({ error: 'Failed to search requesters', detail: error.message });
//   }
// });

// 🔍 Search Requesters (external only + check against local)
app.get('/requesters', requireSession, async (req, res) => {
  const { search } = req.query;
  if (!search || search.trim() === '') {
    return res.status(400).json({ error: 'Search query is required' });
  }

  try {
    // 1. Get external data
    const externalResponse = await axios.get('http://localhost:5050/lbp/requesters', {
      params: { search }
    });

    const externalRaw = externalResponse.data || [];

    // 2. Get all local users (to compare with external)
    const localUsers = await prisma.Requester.findMany();

    // 3. Attach matching local user to each external record
    const enriched = externalRaw.map(ext => {
      const match = localUsers.find(loc =>
        (loc.email_id && loc.email_id === ext.email_id)
        // (loc.employee_id && loc.employee_id === ext.employee_id)
      );
      return { ...ext, source: 'external', localMatch: match || null };
    });

    // 📝 Audit log
    await logAudit({
      username: req.session.username,
      module: 'Requester',
      action: 'SEARCH_EXTERNAL',
      old_value: '',
      new_value: `Searched external: ${search}`
    });

    res.json(enriched);

  } catch (error) {
    console.error('❌ External search error:', error.message);
    res.status(500).json({ error: 'Failed to search external requesters', detail: error.message });
  }
});


// 🚀 Push Requester to SDP
app.post('/add_requester', requireSession, async (req, res) => {
  try {
    // Use the payload sent from the frontend (selected user in app.js)
    const requester = req.body;

    // Use the global ZOHO_ACCESS_TOKEN
    const token = global.ZOHO_ACCESS_TOKEN;
    if (!token) {
      console.error('❌ No Zoho access token found. Make sure to complete the OAuth flow at /redirect_uri.');
      return res.status(401).json({ error: 'No Zoho access token. Please authenticate via OAuth by logging in and completing the authorization process.' });
    }

    // Capitalize the first letter of gender if present
    let gender = requester.gender;
    if (typeof gender === 'string' && gender.length > 0) {
      gender = gender.toLowerCase();
      gender = gender.charAt(0).toUpperCase() + gender.slice(1);
    }

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
        description: requester.description,
        udf_fields: {
          udf_char1: gender,
          udf_char2: null,
        }
      }
    };
    console.log('Adding requester to SDP:', payload);
    const url = process.env.SDP_ENV_URL + `/api/v3/requesters?input_data=${encodeURIComponent(JSON.stringify(payload))}`;
    console.log('SDP URL:', url);
    const response = await axios.post(url, {}, {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/vnd.manageengine.sdp.v3+json'
      }
    });

    // Store the response in the sqlite database (Prisma)
    // You need to have a model in your Prisma schema, e.g. SdpPushLog
    await prisma.Requester.create({
      data: {
        requester_id: response.data.requester.id,
        name: response.data.requester.name,
        first_name: response.data.requester.first_name,
        last_name: response.data.requester.last_name, 
        email_id: response.data.requester.email_id,
        phone_num: response.data.requester.phone,
        mobile: response.data.requester.mobile,
        employee_id: response.data.requester.employee_id,
        job_title: response.data.requester.job_title,
        description: response.data.requester.description,
        gender: response.data.requester.udf_fields?.udf_char1 || null,
        created_date: new Date(response.data.requester.created_time?.display_value) // Assuming created_time is in the response
      }
    });

    await logAudit({
      username: req.session.username,
      module: 'ADD Requester',
      action: 'New Requester Added',
      old_value: '',
      new_value: `Added requester ${requester.data}`
    });
  //  console.log(logAudit({
  //     username: req.session.username,
  //     module: 'ADD Requester',
  //     action: 'New Requester Added',
  //     old_value: '',
  //     new_value: `Pushed requester ${payload}`
  //   }));

    // Respond with the SDP response
    res.json({ success: true, sdp_response: response.data });
  } catch (err) {
    console.error('❌ Add requester error:', err.response?.data || err.message);

    res.status(500).json({
      error: 'Failed to add requester',
      detail: err.response?.data || err.message,
    });
  }
});

// 📝 Update Requester in SDP
app.put('/update_requester/:id', requireSession, async (req, res) => {
  try {
    const requesterId = req.params.id;
    const updates = req.body;
    const token = global.ZOHO_ACCESS_TOKEN;

    if (!token) {
      return res.status(401).json({
        error: 'No Zoho access token',
        detail: 'OAuth token missing or expired. Please re-authenticate.',
      });
    }

    const payload = {
      requester: {
        name: `${updates.first_name} ${updates.last_name}`,
        first_name: updates.first_name,
        last_name: updates.last_name,
        email_id: updates.email_id,
        phone: updates.phone_num,
        mobile: updates.mobile,
        employee_id: updates.employee_id,
        job_title: updates.job_title,
        description: updates.description,
        udf_fields: {
          udf_char1: updates.gender || null,
          udf_char2: null,
        }
      }
    };

    const url = `${process.env.SDP_ENV_URL}/api/v3/requesters/${requesterId}?input_data=${encodeURIComponent(JSON.stringify(payload))}`;

    const response = await axios.put(url, {}, {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/vnd.manageengine.sdp.v3+json'
      }
    });

    // ✅ Update local database as well
    await prisma.Requester.update({
      where: { requester_id: requesterId },
      data: {
        name: `${updates.first_name} ${updates.last_name}`,
        first_name: updates.first_name,
        last_name: updates.last_name,
        email_id: updates.email_id,
        phone_num: updates.phone_num,
        mobile: updates.mobile,
        employee_id: updates.employee_id,
        job_title: updates.job_title,
        description: updates.description,
        gender: updates.gender || null,
      },
    });

    await logAudit({
      username: req.session.username,
      module: 'UPDATE Requester',
      action: 'UPDATE',
      old_value: '',
      new_value: `Updated requester ID ${requesterId}`
    });

    res.json({ success: true, sdp_response: response.data });

  } catch (err) {
    console.error('❌ Update requester error:', err.response?.data || err.message);
    res.status(500).json({
      error: 'Failed to update requester',
      detail: err.response?.data || err.message,
    });
  }
});




// async function printAllAuditLogs() {
//   try {
//     const logs = await prisma.AuditTrail.findMany({ orderBy: { createdAt: 'desc' } });
//     console.log('\n=== All Audit Logs ===');
//     logs.forEach(log => {
//       console.log(`[${log.createdAt}] ${log.username} | ${log.actionId} | ${log.action} | ${log.module}`);
//     });
//     console.log('======================\n');
//   } catch (err) {
//     console.error('❌ Failed to fetch audit logs:', err.message);
//   }
// }

// ✅ Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
// printAllAuditLogs().catch(err => console.error('❌ Error printing audit logs:', err.message));