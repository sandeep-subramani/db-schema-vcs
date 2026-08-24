-- Clean Postgres DDL, entirely inside what this app models.
-- Expect the preview to report every table and column imported and
-- an empty skip list.

CREATE TABLE customers (
    id            serial PRIMARY KEY,
    email         varchar(255) NOT NULL UNIQUE,
    full_name     varchar(120) NOT NULL,
    signed_up_at  timestamptz NOT NULL
);

CREATE TABLE categories (
    id     serial PRIMARY KEY,
    slug   varchar(60) NOT NULL UNIQUE,
    title  varchar(120) NOT NULL
);

CREATE TABLE products (
    id            serial PRIMARY KEY,
    sku           varchar(40) NOT NULL UNIQUE,
    name          varchar(200) NOT NULL,
    description   text,
    price         numeric NOT NULL,
    weight_grams  integer,
    category_id   integer NOT NULL REFERENCES categories(id),
    discontinued  boolean NOT NULL
);

CREATE TABLE orders (
    id             bigserial PRIMARY KEY,
    customer_id    integer NOT NULL REFERENCES customers(id),
    placed_at      timestamptz NOT NULL,
    shipped_on     date,
    tracking_code  varchar(64)
);

CREATE TABLE order_lines (
    order_id    bigint NOT NULL,
    product_id  integer NOT NULL,
    quantity    smallint NOT NULL,
    unit_price  numeric NOT NULL,
    PRIMARY KEY (order_id, product_id),
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);
