CREATE SCHEMA IF NOT EXISTS askdata_import;
GRANT ALL PRIVILEGES ON askdata_import.* TO 'askdata'@'%';

CREATE TABLE fct_orders (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_date DATE NOT NULL,
  customer_id BIGINT NOT NULL,
  region VARCHAR(64) NOT NULL,
  amount DECIMAL(18, 2) NOT NULL
);
