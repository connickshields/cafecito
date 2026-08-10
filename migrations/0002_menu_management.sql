-- Menu management: display order, archival, per-item applicability, and
-- customization type labels.
--
-- Additive only. D1 migrations run BEFORE the new Worker deploys, so every
-- statement here has to leave the currently-deployed Worker working.

ALTER TABLE items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE milk_options ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customization_options ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- Backfill each row to its current alphabetical position, so the customer
-- menu is unchanged the moment this deploys.
UPDATE items SET sort_order =
  (SELECT COUNT(*) FROM items AS other WHERE other.name < items.name);
UPDATE milk_options SET sort_order =
  (SELECT COUNT(*) FROM milk_options AS other WHERE other.name < milk_options.name);
UPDATE customization_options SET sort_order =
  (SELECT COUNT(*) FROM customization_options AS other
    WHERE other.name < customization_options.name);

-- Nothing is ever hard-deleted: order_items holds a foreign key into items,
-- and analytics reads drink names through that join, so a delete would
-- rewrite history. Archiving hides a row from the menu and keeps it readable.
ALTER TABLE items ADD COLUMN archived INTEGER NOT NULL DEFAULT 0
  CHECK (archived IN (0,1));
ALTER TABLE milk_options ADD COLUMN archived INTEGER NOT NULL DEFAULT 0
  CHECK (archived IN (0,1));
ALTER TABLE customization_options ADD COLUMN archived INTEGER NOT NULL DEFAULT 0
  CHECK (archived IN (0,1));

-- Per-item applicability, replacing items.allows_milk_choice and
-- items.allows_customizations. Those were all-or-nothing: Matcha Latte could
-- not offer milk without also offering Extra Shot.
CREATE TABLE item_milk_options (
    item_id        INTEGER NOT NULL REFERENCES items(id),
    milk_option_id INTEGER NOT NULL REFERENCES milk_options(id),
    PRIMARY KEY (item_id, milk_option_id)
);

CREATE TABLE item_customization_options (
    item_id                 INTEGER NOT NULL REFERENCES items(id),
    customization_option_id INTEGER NOT NULL REFERENCES customization_options(id),
    PRIMARY KEY (item_id, customization_option_id)
);

-- Reproduces today's behaviour exactly: the three drinks that took no milk
-- get no links, the five that did get all four.
INSERT INTO item_milk_options (item_id, milk_option_id)
SELECT i.id, m.id FROM items i CROSS JOIN milk_options m
 WHERE i.allows_milk_choice = 1;

INSERT INTO item_customization_options (item_id, customization_option_id)
SELECT i.id, c.id FROM items i CROSS JOIN customization_options c
 WHERE i.allows_customizations = 1;

-- customization_options.type was written by the seed and read by nothing. It
-- now groups the customization picker. This migration does a one-time cleanup
-- of legacy lowercase slugs. Naive pluralization would render 'coffee' as
-- "Coffees"; a hard-coded enum would break the first time a new type is
-- invented. Neither problem exists if the barista simply types the heading
-- they want.
UPDATE customization_options SET type = 'Syrups'   WHERE LOWER(type) IN ('syrup','syrups');
UPDATE customization_options SET type = 'Toppings' WHERE LOWER(type) IN ('topping','toppings');
UPDATE customization_options SET type = 'Coffee'   WHERE LOWER(type) IN ('coffee','coffees');

-- Anything this migration does not recognise still becomes a customer-facing
-- heading verbatim, so capitalise it rather than shipping a lowercase slug to
-- the menu. One-time cleanup only: from here on the barista types the heading
-- they want and it is stored exactly as typed.
UPDATE customization_options
   SET type = UPPER(SUBSTR(type, 1, 1)) || SUBSTR(type, 2)
 WHERE type <> UPPER(SUBSTR(type, 1, 1)) || SUBSTR(type, 2);

-- items.allows_milk_choice and items.allows_customizations are superseded by
-- the join tables above and are no longer read. They are deliberately NOT
-- dropped here: migrations run before the new Worker, so for the seconds
-- between the two the still-deployed old Worker would SELECT * and find them
-- missing, serving every drink with no milk picker to live customers. Drop
-- them in a later, separate deploy if ever.
