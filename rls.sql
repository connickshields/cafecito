-- Enable RLS on all tables
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE milk_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE customization_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_item_customizations ENABLE ROW LEVEL SECURITY;

-- Items: Allow read access to all, full access to non-anonymous users
CREATE POLICY "Allow read access to available items" ON items
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY "Allow full access to non-anonymous users" ON items
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS FALSE)
  WITH CHECK ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS FALSE);

-- Milk options: Allow read access to all, full access to non-anonymous users
CREATE POLICY "Allow read access to available milk options" ON milk_options
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY "Allow full access to non-anonymous users" ON milk_options
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS FALSE)
  WITH CHECK ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS FALSE);

-- Customization options: Allow read access to all, full access to non-anonymous users
CREATE POLICY "Allow read access to available customization options" ON customization_options
  FOR SELECT
  TO authenticated
  USING (true);
CREATE POLICY "Allow full access to non-anonymous users" ON customization_options
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS FALSE)
  WITH CHECK ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS FALSE);

-- Orders: Allow insert for all, select own orders, update pending orders, and full access to non-anonymous users
CREATE POLICY "Allow insert for all users" ON orders
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow users to view their own orders" ON orders
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Allow users to update their pending orders" ON orders
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id AND status = 'pending')
  WITH CHECK (status = 'cancelled');

CREATE POLICY "Allow full access to non-anonymous users" ON orders
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS FALSE)
  WITH CHECK ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS FALSE);

-- Order items: Allow insert for all, select own order items, and full access to non-anonymous users
CREATE POLICY "Allow insert for all users" ON order_items
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow users to view their own order items" ON order_items
  FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM orders WHERE orders.id = order_items.order_id AND orders.user_id = auth.uid()));

CREATE POLICY "Allow full access to non-anonymous users" ON order_items
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS FALSE)
  WITH CHECK ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS FALSE);

-- Order item customizations: Allow insert for all, select own order item customizations, and full access to non-anonymous users
CREATE POLICY "Allow insert for all users" ON order_item_customizations
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow users to view their own order item customizations" ON order_item_customizations
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 
    FROM order_items 
    JOIN orders ON order_items.order_id = orders.id 
    WHERE order_items.id = order_item_customizations.order_item_id 
    AND orders.user_id = auth.uid()
  ));

CREATE POLICY "Allow full access to non-anonymous users" ON order_item_customizations
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS FALSE)
  WITH CHECK ((SELECT (auth.jwt()->>'is_anonymous')::boolean) IS FALSE);