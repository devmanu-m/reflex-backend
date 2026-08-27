-- RETAILERS: the shops using Reflex (created first — users references this table)
CREATE TABLE retailers (
  id SERIAL PRIMARY KEY,
  shop_name VARCHAR(100) NOT NULL,
  location VARCHAR(200)
);

-- USERS: everyone who logs into Reflex, with a role that determines what they can do
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('retailer_staff', 'dispatcher', 'rider')),
  retailer_id INTEGER REFERENCES retailers(id)
);

-- DELIVERY_REQUESTS: the core record — one row per delivery
CREATE TABLE delivery_requests (
  id SERIAL PRIMARY KEY,
  retailer_id INTEGER NOT NULL REFERENCES retailers(id),
  customer_name VARCHAR(100) NOT NULL,
  customer_phone VARCHAR(20) NOT NULL,
  address VARCHAR(200) NOT NULL,
  item_description VARCHAR(200) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'assigned', 'picked_up', 'delivered', 'cancelled')),
  assigned_rider_id INTEGER REFERENCES users(id),
  qr_token VARCHAR(64) UNIQUE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- STATUS_EVENTS: the permanent audit log — one new row per status change, never overwritten
CREATE TABLE status_events (
  id SERIAL PRIMARY KEY,
  delivery_id INTEGER NOT NULL REFERENCES delivery_requests(id),
  status VARCHAR(20) NOT NULL,
  changed_by_user_id INTEGER REFERENCES users(id),
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  note VARCHAR(200)
);

