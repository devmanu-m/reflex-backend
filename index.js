// index.js — the entry point of your backend

// Load environment variables from .env (your DB password, etc.)
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const http = require('http');
const { Server } = require('socket.io');

// Create the Express app — this is your actual backend program
const app = express();

// Create HTTP server so Express and Socket.IO can run together
const server = http.createServer(app);

// Create the Socket.IO server
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

app.use(cors());
app.use(express.json());

// Set up a connection pool to PostgreSQL, using the values from .env
const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
});

// A simple test route — confirms the server itself is running
app.get('/', (req, res) => {
  res.send('Reflex backend is running');
});

// A test route that confirms the database connection works
app.get('/test-db', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      message: 'Database connected',
      time: result.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Database connection failed'
    });
  }
});

// CREATE a new delivery request — retailer staff use this
app.post('/deliveries', async (req, res) => {
  const {
    retailer_id,
    customer_name,
    customer_phone,
    address,
    item_description
  } = req.body;

  // Basic validation — refuse the request if anything required is missing
  if (
    !retailer_id ||
    !customer_name ||
    !customer_phone ||
    !address ||
    !item_description
  ) {
    return res.status(400).json({
      error: 'Missing required fields'
    });
  }

  // Generate a unique QR token for this delivery
  const qr_token = require('crypto').randomUUID();

  try {
    const result = await pool.query(
      `INSERT INTO delivery_requests
        (
          retailer_id,
          customer_name,
          customer_phone,
          address,
          item_description,
          status,
          qr_token
        )
       VALUES ($1, $2, $3, $4, $5, 'requested', $6)
       RETURNING *`,
      [
        retailer_id,
        customer_name,
        customer_phone,
        address,
        item_description,
        qr_token
      ]
    );

    const newDelivery = result.rows[0];

    // Log this as the very first status event
    await pool.query(
      `INSERT INTO status_events
        (delivery_id, status, note)
       VALUES ($1, 'requested', 'Delivery request created')`,
      [newDelivery.id]
    );

    // Broadcast the newly created delivery to all connected clients
    io.emit('statusUpdated', newDelivery);

    res.status(201).json(newDelivery);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Failed to create delivery request'
    });
  }
});

// LIST all delivery requests — the dispatcher board uses this
app.get('/deliveries', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM delivery_requests ORDER BY created_at DESC`
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Failed to fetch deliveries'
    });
  }
});

// ASSIGN a rider to a delivery — the dispatcher uses this
app.patch('/deliveries/:id/assign', async (req, res) => {
  const { id } = req.params;
  const { rider_id } = req.body;

  if (!rider_id) {
    return res.status(400).json({
      error: 'rider_id is required'
    });
  }

  try {
    const result = await pool.query(
      `UPDATE delivery_requests
       SET assigned_rider_id = $1,
           status = 'assigned'
       WHERE id = $2
       RETURNING *`,
      [rider_id, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Delivery not found'
      });
    }

    const updatedDelivery = result.rows[0];

    // Log this assignment as a new status event
    await pool.query(
      `INSERT INTO status_events
        (
          delivery_id,
          status,
          changed_by_user_id,
          note
        )
       VALUES ($1, 'assigned', NULL, 'Rider assigned by dispatcher')`,
      [updatedDelivery.id]
    );

    // Broadcast the assignment update to all connected clients
    io.emit('statusUpdated', updatedDelivery);

    res.json(updatedDelivery);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Failed to assign rider'
    });
  }
});

// UPDATE a delivery's status — used by both QR scans (pickup and delivery)
app.patch('/deliveries/:id/status', async (req, res) => {
  const { id } = req.params;
  const {
    status,
    changed_by_user_id,
    note
  } = req.body;

  const validStatuses = [
    'requested',
    'assigned',
    'picked_up',
    'delivered',
    'cancelled'
  ];

  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({
      error: 'Invalid or missing status'
    });
  }

  try {
    const result = await pool.query(
      `UPDATE delivery_requests
       SET status = $1
       WHERE id = $2
       RETURNING *`,
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Delivery not found'
      });
    }

    const updatedDelivery = result.rows[0];

    // Log this status change as its own permanent event
    await pool.query(
      `INSERT INTO status_events
        (
          delivery_id,
          status,
          changed_by_user_id,
          note
        )
       VALUES ($1, $2, $3, $4)`,
      [
        updatedDelivery.id,
        status,
        changed_by_user_id || null,
        note || null
      ]
    );

    // Broadcast the status update to all connected clients
    io.emit('statusUpdated', updatedDelivery);

    res.json(updatedDelivery);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Failed to update status'
    });
  }
});

// Port configuration
const PORT = process.env.PORT || 5000;

// Start the HTTP + Express + Socket.IO server
server.listen(PORT, () => {
  console.log(`Reflex backend listening on port ${PORT}`);
});
