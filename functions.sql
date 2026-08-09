-- Customer-facing database functions. Apply after schema.sql and rls.sql.

-- Aggregate queue numbers for customers. SECURITY DEFINER so it can see all
-- orders internally while returning only bare aggregates; RLS stays strict.
-- With p_order_id: drinks/orders ahead of that order (queue position).
-- Without: the whole active queue (pre-order banner).
CREATE OR REPLACE FUNCTION get_queue_stats(p_order_id integer DEFAULT NULL)
RETURNS TABLE (
    drinks_ahead integer,
    active_orders integer,
    est_mins_per_drink numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    SELECT COALESCE(SUM(oi.quantity), 0)::int, COUNT(DISTINCT o.id)::int
      INTO drinks_ahead, active_orders
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
     WHERE o.status IN ('pending', 'in_progress')
       AND (p_order_id IS NULL
            OR o.created_at < (SELECT created_at FROM orders WHERE id = p_order_id));

    -- Drain rate (throughput): over the last 5 completed orders within 90
    -- minutes, drinks completed after the earliest completion divided by the
    -- minutes between first and last completion. NULL when < 3 completions
    -- or the span is under 60 seconds (guards a zero denominator).
    WITH recent AS (
        SELECT o.id,
               o.updated_at,
               (SELECT COALESCE(SUM(quantity), 0)
                  FROM order_items oi WHERE oi.order_id = o.id) AS drinks
          FROM orders o
         WHERE o.status = 'completed'
           AND o.updated_at > now() - interval '90 minutes'
         ORDER BY o.updated_at DESC
         LIMIT 5
    ),
    ordered AS (
        SELECT drinks,
               ROW_NUMBER() OVER (ORDER BY updated_at ASC) AS rn,
               COUNT(*)     OVER () AS n,
               MIN(updated_at) OVER () AS first_t,
               MAX(updated_at) OVER () AS last_t
          FROM recent
    )
    SELECT CASE
               WHEN MAX(n) IS NULL OR MAX(n) < 3 THEN NULL
               WHEN EXTRACT(EPOCH FROM (MAX(last_t) - MAX(first_t))) < 60 THEN NULL
               ELSE (EXTRACT(EPOCH FROM (MAX(last_t) - MAX(first_t))) / 60.0)
                    / NULLIF(SUM(drinks) FILTER (WHERE rn > 1), 0)
           END
      INTO est_mins_per_drink
      FROM ordered;

    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION get_queue_stats(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_queue_stats(integer) TO authenticated;

-- Atomic order creation: order + items + customizations in one transaction.
-- SECURITY INVOKER: existing insert policies already permit these writes.
-- user_id always comes from auth.uid(), never from the client.
CREATE OR REPLACE FUNCTION create_order(p_customer_name text, p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_order_id integer;
    v_item jsonb;
    v_order_item_id integer;
BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Order must contain at least one item';
    END IF;

    INSERT INTO orders (user_id, customer_name, status)
    VALUES (auth.uid(), p_customer_name, 'pending')
    RETURNING id INTO v_order_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        IF v_item->>'item_id' IS NULL THEN
            RAISE EXCEPTION 'Order item missing item_id';
        END IF;

        INSERT INTO order_items (order_id, item_id, milk_option_id, quantity)
        VALUES (
            v_order_id,
            (v_item->>'item_id')::int,
            (v_item->>'milk_option_id')::int,
            GREATEST(COALESCE((v_item->>'quantity')::int, 1), 1)
        )
        RETURNING id INTO v_order_item_id;

        INSERT INTO order_item_customizations (order_item_id, customization_option_id)
        SELECT v_order_item_id, c.value::int
          FROM jsonb_array_elements_text(
                   COALESCE(v_item->'customization_option_ids', '[]'::jsonb)) c;
    END LOOP;

    RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION create_order(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_order(text, jsonb) TO authenticated;
