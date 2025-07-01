const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

// ✅ GET /lbp/requester?id=1 — fetch single requester by ID
app.get('/lbp/requester', async (req, res) => {
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Missing requester ID' });
  }

  try {
    const requester = await prisma.requester.findUnique({
      where: { id: parseInt(id) },
    });

    if (!requester) {
      return res.status(404).json({ error: 'Requester not found' });
    }

    res.json(requester);
  } catch (error) {
    console.error('❌ Error fetching requester:', error.message, error.stack);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ GET /lbp/requesters?search=keyword — search across fields
app.get('/lbp/requesters', async (req, res) => {
  const { search } = req.query;

  if (!search || search.trim() === '') {
    return res.status(400).json({ error: 'Search query is required' });
  }

  try {
    const results = await prisma.requester.findMany({
      where: {
        OR: [
          { first_name: { contains: search, mode: 'insensitive' } },
          { last_name: { contains: search, mode: 'insensitive' } },
          { email_id: { contains: search, mode: 'insensitive' } },
          { phone: { not: null, contains: search, mode: 'insensitive' } },
          { mobile: { not: null, contains: search, mode: 'insensitive' } },
          { employee_id: { contains: search, mode: 'insensitive' } },
          { job_title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      },
      take: 10,
    });

    res.json(results);
  } catch (err) {
    console.error('❌ Error searching requesters:', err.message, err.stack);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ Server startup
const PORT = 5050;
app.listen(PORT, () => {
  console.log(`🚀 Mock API listening on http://localhost:${PORT}`);
});
