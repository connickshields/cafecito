-- Create enum type for order status
CREATE TYPE order_status AS ENUM ('pending', 'in_progress', 'completed', 'cancelled');

-- Create table for menu items
CREATE TABLE items (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    size INTEGER DEFAULT NULL,
    available BOOLEAN NOT NULL DEFAULT true,
    allows_milk_choice BOOLEAN NOT NULL DEFAULT true,
    allows_customizations BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create table for milk options
CREATE TABLE milk_options (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    available BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create table for customization options
CREATE TABLE customization_options (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL, -- e.g., 'syrup', 'topping'
    available BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create table for orders
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    customer_name VARCHAR(100) NOT NULL,
    status order_status DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create table for order items (allows multiple items per order)
CREATE TABLE order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id),
    item_id INTEGER REFERENCES items(id),
    milk_option_id INTEGER REFERENCES milk_options(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create table for order item customizations
CREATE TABLE order_item_customizations (
    id SERIAL PRIMARY KEY,
    order_item_id INTEGER REFERENCES order_items(id),
    customization_option_id INTEGER REFERENCES customization_options(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add some sample data
INSERT INTO items (name, description, available, allows_milk_choice, allows_customizations) VALUES
('Espresso', 'Double shot of espresso', true, false, false),
('Americano', '(8oz) Double espresso with hot water', true, false, false),
('Cortado', '(4oz) Double espresso with steamed milk', true, false, false),
('Cappuccino', '(8oz) Double espresso with equal parts steamed milk and foam', true, true, true),
('Flat White', '(8oz) Double espresso with steamed milk', true, true, true),
('Latte', '(12oz) Double espresso with steamed milk', true, true, true),
('Matcha Latte', '(12oz) Hand-whisked Japanese matcha with steamed milk', true, true, false),
('Mocha', '(12oz) Espresso with steamed milk and chocolate', false, true, true);

INSERT INTO milk_options (name, available) VALUES
('Whole', true),
('Oat', true),
('Almond', true),
('Soy', false);

INSERT INTO customization_options (name, type, available) VALUES
('Vanilla Syrup', 'syrup', true),
('Caramel Syrup', 'syrup', true),
('Hazelnut Syrup', 'syrup', false),
('Whipped Cream', 'topping', false),
('Cinnamon', 'topping', false),
('Extra Shot', 'coffee', false);

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers to automatically update the updated_at column
CREATE TRIGGER update_items_modtime
    BEFORE UPDATE ON items
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

CREATE TRIGGER update_milk_options_modtime
    BEFORE UPDATE ON milk_options
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

CREATE TRIGGER update_customization_options_modtime
    BEFORE UPDATE ON customization_options
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

CREATE TRIGGER update_orders_modtime
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

CREATE TRIGGER update_order_items_modtime
    BEFORE UPDATE ON order_items
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

CREATE TRIGGER update_order_item_customizations_modtime
    BEFORE UPDATE ON order_item_customizations
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();