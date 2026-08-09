-- Cafecito baseline schema for D1 (SQLite).
-- Ported from the Supabase schema.sql / rls.sql / functions.sql trio.
-- Timestamps are explicit ISO-8601 UTC so Safari's Date parser accepts them.

CREATE TABLE items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    size INTEGER DEFAULT NULL,
    available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1)),
    allows_milk_choice INTEGER NOT NULL DEFAULT 1 CHECK (allows_milk_choice IN (0,1)),
    allows_customizations INTEGER NOT NULL DEFAULT 1 CHECK (allows_customizations IN (0,1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE milk_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE customization_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- customer_id is the value carried in the signed cookie. There is no users
-- table: identity is per-browser and disposable, exactly as anonymous
-- Supabase auth was.
-- submission_id is client-generated. It lets the order rows be inserted in a
-- single batch (children address the parent by token, not by unknown
-- autoincrement id) and makes retried submits idempotent.
CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    submission_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','in_progress','completed','cancelled')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- id is a Worker-generated UUID so customization rows can reference it inside
-- the same batch. It is never exposed to the client.
CREATE TABLE order_items (
    id TEXT PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    item_id INTEGER NOT NULL REFERENCES items(id),
    milk_option_id INTEGER REFERENCES milk_options(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE order_item_customizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_item_id TEXT NOT NULL REFERENCES order_items(id),
    customization_option_id INTEGER NOT NULL REFERENCES customization_options(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- D1 bills by rows read; the 5s barista poll would otherwise full-scan.
CREATE INDEX idx_orders_status_created ON orders(status, created_at);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_oic_order_item ON order_item_customizations(order_item_id);

-- orders.updated_at is the completion timestamp the drain-rate calculation
-- depends on. Triggers make it impossible to forget in a code path.
-- SQLite's recursive_triggers defaults to off, so these do not re-fire.
CREATE TRIGGER items_updated_at AFTER UPDATE ON items
BEGIN
    UPDATE items SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER milk_options_updated_at AFTER UPDATE ON milk_options
BEGIN
    UPDATE milk_options SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER customization_options_updated_at AFTER UPDATE ON customization_options
BEGIN
    UPDATE customization_options SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER orders_updated_at AFTER UPDATE ON orders
BEGIN
    UPDATE orders SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER order_items_updated_at AFTER UPDATE ON order_items
BEGIN
    UPDATE order_items SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = NEW.id;
END;

-- Menu seed, carried over from schema.sql.
INSERT INTO items (name, description, available, allows_milk_choice, allows_customizations) VALUES
('Espresso', 'Double shot of espresso', 1, 0, 0),
('Americano', '(8oz) Double espresso with hot water', 1, 0, 0),
('Cortado', '(4oz) Double espresso with steamed milk', 1, 0, 0),
('Cappuccino', '(8oz) Double espresso with equal parts steamed milk and foam', 1, 1, 1),
('Flat White', '(8oz) Double espresso with steamed milk', 1, 1, 1),
('Latte', '(12oz) Double espresso with steamed milk', 1, 1, 1),
('Matcha Latte', '(12oz) Hand-whisked Japanese matcha with steamed milk', 1, 1, 0),
('Mocha', '(12oz) Espresso with steamed milk and chocolate', 0, 1, 1);

INSERT INTO milk_options (name, available) VALUES
('Whole', 1), ('Oat', 1), ('Almond', 1), ('Soy', 0);

INSERT INTO customization_options (name, type, available) VALUES
('Vanilla Syrup', 'syrup', 1),
('Caramel Syrup', 'syrup', 1),
('Hazelnut Syrup', 'syrup', 0),
('Whipped Cream', 'topping', 0),
('Cinnamon', 'topping', 0),
('Extra Shot', 'coffee', 0);
